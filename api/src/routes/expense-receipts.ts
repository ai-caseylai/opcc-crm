import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { verify as jwtVerify } from 'jsonwebtoken';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const expenses = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Download file (token-protected) ──
// Supports: Authorization header OR ?token=jwt_query_param
expenses.get('/:id/file', async (c) => {
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
    'SELECT file_data, file_type, file_name, user_id FROM expense_receipts WHERE id = ?'
  ).bind(c.req.param('id')).first<{ file_data: string; file_type: string; file_name: string; user_id: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== userId) return c.json({ error: 'Not found' }, 404);

  const base64 = row.file_data.replace(/^data:.*?;base64,/, '');
  const binary = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
  return new Response(binary, {
    headers: {
      'Content-Type': row.file_type || 'image/png',
      'Content-Disposition': `inline; filename="${row.file_name || 'receipt'}"`,
    },
  });
});

expenses.use('*', authMiddleware);

// ── List ──
expenses.get('/', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const category = c.req.query('category') || '';
  const year = c.req.query('year') || '';
  let q = 'SELECT id, file_name, vendor_name, amount, expense_date, category, description, payment_method, ocr_text, status, created_at FROM expense_receipts WHERE user_id = ?';
  const p: any[] = [user.id];
  if (category) { q += ' AND category = ?'; p.push(category); }
  if (year) { q += " AND expense_date LIKE ?"; p.push(`${year}%`); }
  q += ' ORDER BY expense_date DESC';
  const rows = await c.env.DB.prepare(q).bind(...p).all();
  return c.json({ data: rows.results });
});

// ── Get single ──
expenses.get('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const row = await c.env.DB.prepare('SELECT * FROM expense_receipts WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

// ── Upload ──
expenses.post('/upload', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json();
  const { file_name, file_type, file_data, vendor_name, amount, expense_date, category, description, payment_method } = body;

  if (!file_data) return c.json({ error: 'file_data required (base64)' }, 400);

  const id = `ex-${uuidv4().slice(0, 8)}`;
  let ocrText = '';
  let ocrAmount: number | null = null;
  let ocrVendor = '';
  let ocrDate = '';

  // OCR via Workers AI
  if (c.env.AI) {
    try {
      const cleanBase64 = file_data.replace(/^data:.*?;base64,/, '');
      const aiResponse = await c.env.AI.run('@cf/unum/uform-gen2-qwen-500m', {
        prompt: 'Extract all text from this receipt/invoice. Return: Vendor/Store Name, Total Amount, Date, Payment Method.',
        image: cleanBase64,
      });
      ocrText = (aiResponse as any)?.description || '';

      const amtMatch = ocrText.match(/(?:Total|Amount|總額|金額|合計)[^\d]*(\d[\d,]*\.?\d*)/i);
      if (amtMatch) ocrAmount = parseFloat(amtMatch[1].replace(/,/g, ''));

      const vendorMatch = ocrText.match(/(?:Vendor|Store|商戶|店名)[:\s]+(.+)/i);
      if (vendorMatch) ocrVendor = vendorMatch[1].trim();

      const dateMatch = ocrText.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}/);
      if (dateMatch) ocrDate = dateMatch[0];
    } catch { /* OCR unavailable */ }
  }

  if (!ocrText && file_name) {
    ocrText = `File: ${file_name} | Vendor: ${vendor_name || 'N/A'} | Amount: ${amount || 'N/A'}`;
  }

  await db.prepare(
    `INSERT INTO expense_receipts (id, user_id, file_name, file_type, file_data, vendor_name, amount, expense_date, category, description, payment_method, ocr_text)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, user.id, file_name || null, file_type || 'image/png', file_data,
    vendor_name || ocrVendor || null, amount || ocrAmount || null, expense_date || ocrDate || null,
    category || null, description || null, payment_method || null, ocrText).run();

  const row = await db.prepare('SELECT id, file_name, vendor_name, amount, expense_date, category, description, payment_method, ocr_text, status, created_at FROM expense_receipts WHERE id = ?').bind(id).first();
  return c.json({ ...row, ocr_used: c.env.AI ? !!ocrText && ocrText.length > 20 : false }, 201);
});


// ── Delete ──
expenses.delete('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const existing = await c.env.DB.prepare('SELECT id FROM expense_receipts WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM expense_receipts WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).run();
  return c.json({ success: true });
});

export { expenses as expenseReceiptRoutes };
