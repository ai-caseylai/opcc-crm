import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { verify as jwtVerify } from 'jsonwebtoken';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const docs = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Download file (token-protected) ──
// Supports: Authorization header OR ?token=jwt_query_param
docs.get('/:id/file', async (c) => {
  let userId: string | null = null;
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwtVerify(auth.slice(7), c.env.JWT_SECRET || 'dev-secret-change-me') as { id: string };
      userId = payload.id;
    } catch {}
  }
  if (!userId) {
    const token = c.req.query('token');
    if (token) {
      try {
        const payload = jwtVerify(token, c.env.JWT_SECRET || 'dev-secret-change-me') as { id: string };
        userId = payload.id;
      } catch {}
    }
  }
  if (!userId) return c.json({ error: 'Authentication required' }, 401);

  const row = await c.env.DB.prepare(
    'SELECT file_data, file_type, file_name, user_id FROM documents WHERE id = ?'
  ).bind(c.req.param('id')).first<{ file_data: string; file_type: string; file_name: string; user_id: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== userId) return c.json({ error: 'Not found' }, 404);

  const base64 = row.file_data.replace(/^data:image\/\w+;base64,/, '');
  const binary = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
  return new Response(binary, {
    headers: {
      'Content-Type': row.file_type || 'image/png',
      'Content-Disposition': `inline; filename="${row.file_name || 'document'}"`,
    },
  });
});

docs.use('*', authMiddleware);

// ── List documents ──
docs.get('/', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const docType = c.req.query('type') || '';
  let q = 'SELECT id, doc_type, doc_year, file_name, file_type, br_number, company_name_ocr, issue_date, expiry_date, status, ocr_text, created_at FROM documents WHERE user_id = ?';
  const p: any[] = [user.id];
  if (docType) { q += ' AND doc_type = ?'; p.push(docType); }
  q += ' ORDER BY doc_year DESC, created_at DESC';
  const rows = await c.env.DB.prepare(q).bind(...p).all();
  return c.json({ data: rows.results });
});

// ── Get single document (with file data) ──
docs.get('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const row = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

// ── Upload document ──
docs.post('/upload', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json();
  const { doc_type, doc_year, file_name, file_type, file_data } = body;

  if (!doc_type || !file_data) return c.json({ error: 'doc_type and file_data required' }, 400);
  if (!['br', 'ci', 'ei', 'ec', 'tc', 'rl'].includes(doc_type)) return c.json({ error: 'doc_type must be br, ci, ei, ec, tc, or rl' }, 400);

  const id = `doc-${uuidv4().slice(0, 8)}`;

  // OCR: extract text from base64 image
  let ocrText = '';
  let brNumber = '';
  let companyOcr = '';
  let issueDate = '';
  let expiryDate = '';

  let ocrSuccess = false;

  // OCR via Cloudflare Workers AI
  if (c.env.AI && ['br', 'ci', 'ei', 'ec'].includes(doc_type)) {
    try {
      const cleanBase64 = file_data.replace(/^data:image\/\w+;base64,/, '');
      const aiResponse = await c.env.AI.run('@cf/unum/uform-gen2-qwen-500m', {
        prompt: 'Extract all text from this Hong Kong Business Registration Certificate. Return: BR Number, Company Name, Issue Date (DD/MM/YYYY), Expiry Date (DD/MM/YYYY).',
        image: cleanBase64,
      });
      const rawText = (aiResponse as any)?.description || '';
      if (rawText && rawText.length > 10) {
        ocrSuccess = true;
        ocrText = rawText;
        // Parse BR number pattern: 12345678-000-12-34-5
        const brMatch = rawText.match(/\d{8}-\d{3}(-\d{2}){2}-\d/);
        if (brMatch) brNumber = brMatch[0];
        // Parse company name (line after "Name" or "Company")
        const nameMatch = rawText.match(/(?:Name|Company)[:\s]+(.+)/i);
        if (nameMatch) companyOcr = nameMatch[1].trim();
        // Parse dates
        const dateMatches = rawText.match(/\d{2}[-/]\d{2}[-/]\d{4}/g);
        if (dateMatches && dateMatches.length >= 2) {
          issueDate = dateMatches[0];
          expiryDate = dateMatches[1];
        }
      }
    } catch (e) { /* AI call failed, continue without OCR */ }
  }

  // Fallback if no OCR result
  if (!ocrSuccess && file_name) {
    ocrText = `File: ${file_name} | Type: ${doc_type} | Year: ${doc_year || 'N/A'}`;
  }

  await db.prepare(
    `INSERT INTO documents (id, user_id, doc_type, doc_year, file_name, file_type, file_data, ocr_text, br_number, company_name_ocr, issue_date, expiry_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, user.id, doc_type, doc_year || null, file_name || null, file_type || 'image/png',
    file_data, ocrText, brNumber, companyOcr, issueDate, expiryDate).run();

  const row = await db.prepare('SELECT id, doc_type, doc_year, file_name, br_number, company_name_ocr, issue_date, expiry_date, ocr_text, status, created_at FROM documents WHERE id = ?').bind(id).first();
  return c.json({ ...row, ocr_used: ocrSuccess }, 201);
});

// ── Update document metadata ──
docs.patch('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json();
  const id = c.req.param('id');

  const existing = await db.prepare('SELECT id FROM documents WHERE id = ? AND user_id = ?').bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const sets: string[] = []; const params: any[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (['br_number','company_name_ocr','issue_date','expiry_date','doc_year','status'].includes(k)) {
      sets.push(`${k} = ?`); params.push(v);
    }
  }
  if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(id, tenantId);

  await db.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  const row = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first();
  return c.json(row);
});

// ── Delete document ──
docs.delete('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const existing = await c.env.DB.prepare('SELECT id FROM documents WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).run();
  return c.json({ success: true });
});


export { docs as documentRoutes };
