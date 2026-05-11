import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const bank = new Hono<{ Bindings: Bindings; Variables: Variables }>();
bank.use('*', authMiddleware);

// ── List ──
bank.get('/', async (c) => {
  const user = c.get('user');
  const year = c.req.query('year') || '';
  let q = 'SELECT id, file_name, bank_name, account_number, statement_year, statement_month, period_start, period_end, opening_balance, closing_balance, ocr_text, status, created_at FROM bank_statements WHERE user_id = ?';
  const p: any[] = [user.id];
  if (year) { q += ' AND statement_year = ?'; p.push(parseInt(year)); }
  q += ' ORDER BY statement_year DESC, statement_month DESC';
  const rows = await c.env.DB.prepare(q).bind(...p).all();
  return c.json({ data: rows.results });
});

// ── Get single (with file data for download) ──
bank.get('/:id', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT * FROM bank_statements WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

// ── Upload ──
bank.post('/upload', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json();
  const { file_name, file_type, file_data, bank_name, account_number, statement_year, statement_month } = body;

  if (!file_data) return c.json({ error: 'file_data required (base64)' }, 400);

  const id = `bs-${uuidv4().slice(0, 8)}`;
  let ocrText = '';
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;

  // OCR via Workers AI
  if (c.env.AI) {
    try {
      const cleanBase64 = file_data.replace(/^data:.*?;base64,/, '');
      const aiResponse = await c.env.AI.run('@cf/unum/uform-gen2-qwen-500m', {
        prompt: 'Extract all text from this bank statement. Return: Bank Name, Account Number, Statement Period, Opening Balance, Closing Balance, and list of transactions with dates and amounts.',
        image: cleanBase64,
      });
      ocrText = (aiResponse as any)?.description || '';

      // Parse balances
      const openingMatch = ocrText.match(/(?:Opening|開戶|期初)[^\d]*(\d[\d,]*\.?\d*)/i);
      if (openingMatch) openingBalance = parseFloat(openingMatch[1].replace(/,/g, ''));
      const closingMatch = ocrText.match(/(?:Closing|結餘|期末)[^\d]*(\d[\d,]*\.?\d*)/i);
      if (closingMatch) closingBalance = parseFloat(closingMatch[1].replace(/,/g, ''));
    } catch { /* OCR unavailable */ }
  }

  if (!ocrText && file_name) {
    ocrText = `File: ${file_name} | Bank: ${bank_name || 'N/A'} | ${statement_year}-${String(statement_month || 1).padStart(2, '0')}`;
  }

  await db.prepare(
    `INSERT INTO bank_statements (id, user_id, file_name, file_type, file_data, bank_name, account_number, statement_year, statement_month, opening_balance, closing_balance, ocr_text)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, user.id, file_name || null, file_type || 'application/pdf', file_data,
    bank_name || null, account_number || null, statement_year || null, statement_month || null,
    openingBalance, closingBalance, ocrText).run();

  const row = await db.prepare('SELECT id, file_name, bank_name, account_number, statement_year, statement_month, period_start, period_end, opening_balance, closing_balance, ocr_text, status, created_at FROM bank_statements WHERE id = ?').bind(id).first();
  return c.json({ ...row, ocr_used: c.env.AI ? !!ocrText && ocrText.length > 20 : false }, 201);
});

// ── Download file ──
bank.get('/:id/file', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT file_data, file_type, file_name FROM bank_statements WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).first<{ file_data: string; file_type: string; file_name: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);

  const base64 = row.file_data.replace(/^data:.*?;base64,/, '');
  const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return new Response(binary, {
    headers: {
      'Content-Type': row.file_type || 'application/pdf',
      'Content-Disposition': `inline; filename="${row.file_name || 'statement'}"`,
    },
  });
});

// ── Delete ──
bank.delete('/:id', async (c) => {
  const user = c.get('user');
  const existing = await c.env.DB.prepare('SELECT id FROM bank_statements WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM bank_statements WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).run();
  return c.json({ success: true });
});

export { bank as bankStatementRoutes };
