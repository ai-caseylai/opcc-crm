import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { verify as jwtVerify } from 'jsonwebtoken';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const bank = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Download file (token-protected) ──
// Supports: Authorization header OR ?token=jwt_query_param
bank.get('/:id/file', async (c) => {
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
    'SELECT file_data, r2_key, file_type, file_name, user_id FROM bank_statements WHERE id = ?'
  ).bind(c.req.param('id')).first<{ file_data: string; r2_key: string | null; file_type: string; file_name: string; user_id: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== userId) return c.json({ error: 'Not found' }, 404);

  if (row.r2_key && c.env.FILE_BUCKET) {
    const obj = await c.env.FILE_BUCKET.get(row.r2_key);
    if (obj) {
      return new Response(obj.body, {
        headers: {
          'Content-Type': row.file_type || 'application/pdf',
          'Content-Disposition': `inline; filename="${row.file_name || 'statement'}"`,
        },
      });
    }
  }

  if (row.file_data) {
    const base64 = row.file_data.replace(/^data:.*?;base64,/, '');
    const binary = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
    return new Response(binary, {
      headers: {
        'Content-Type': row.file_type || 'application/pdf',
        'Content-Disposition': `inline; filename="${row.file_name || 'statement'}"`,
      },
    });
  }

  return c.json({ error: 'File data not available' }, 404);
});

bank.use('*', authMiddleware);

// ── List ──
bank.get('/', async (c) => {
  const user = c.get('user');
  const year = c.req.query('year') || '';
  let q = `SELECT id, file_name, bank_name, account_number, branch, currency, account_type,
           statement_year, statement_month, period_start, period_end,
           opening_balance, closing_balance, page_count, ocr_text, status, created_at
           FROM bank_statements WHERE user_id = ?`;
  const p: any[] = [user.id];
  if (year) { q += ' AND statement_year = ?'; p.push(parseInt(year)); }
  q += ' ORDER BY statement_year DESC, statement_month DESC';
  const rows = await c.env.DB.prepare(q).bind(...p).all();
  return c.json({ data: rows.results });
});

// ── Get single (with transactions) ──
bank.get('/:id', async (c) => {
  const user = c.get('user');
  const stmt = await c.env.DB.prepare(
    `SELECT id, file_name, bank_name, account_number, branch, currency, account_type,
     statement_year, statement_month, period_start, period_end,
     opening_balance, closing_balance, page_count, ocr_text, status, created_at
     FROM bank_statements WHERE id = ? AND user_id = ?`
  ).bind(c.req.param('id'), user.id).first();
  if (!stmt) return c.json({ error: 'Not found' }, 404);

  const txs = await c.env.DB.prepare(
    `SELECT id, transaction_date, description, deposit_amount, withdrawal_amount,
     balance, account_type, reference, sort_order
     FROM bank_transactions WHERE bank_statement_id = ?
     ORDER BY sort_order`
  ).bind(c.req.param('id')).all();

  return c.json({ ...stmt, transactions: txs.results });
});

// ── Import (parsed data + transactions) ──
bank.post('/import', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json();
  const {
    r2_key, file_name, bank_name, account_number, branch, currency, account_type,
    statement_year, statement_month, period_start, period_end,
    opening_balance, closing_balance, page_count, ocr_text,
    transactions
  } = body;

  if (!r2_key) return c.json({ error: 'r2_key required' }, 400);

  const existing = await db.prepare(
    'SELECT id FROM bank_statements WHERE user_id = ? AND r2_key = ?'
  ).bind(user.id, r2_key).first();
  if (existing) return c.json({ error: 'Statement already imported', id: existing.id }, 409);

  const id = `bs-${uuidv4().slice(0, 8)}`;
  const fileName = file_name || r2_key.split('/').pop() || 'statement.pdf';

  await db.prepare(
    `INSERT INTO bank_statements (id, user_id, file_name, file_type, file_data, r2_key,
     bank_name, account_number, branch, currency, account_type,
     statement_year, statement_month, period_start, period_end,
     opening_balance, closing_balance, page_count, ocr_text)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, user.id, fileName, 'application/pdf', '', r2_key,
    bank_name || null, account_number || null, branch || null,
    currency || 'HKD', account_type || null,
    statement_year || null, statement_month || null,
    period_start || null, period_end || null,
    opening_balance ?? null, closing_balance ?? null,
    page_count || null, ocr_text || ''
  ).run();

  let txCount = 0;
  if (transactions && transactions.length > 0) {
    for (const tx of transactions) {
      const txId = `bt-${uuidv4().slice(0, 8)}`;
      await db.prepare(
        `INSERT INTO bank_transactions (id, bank_statement_id, user_id, transaction_date, description,
         deposit_amount, withdrawal_amount, balance, account_type, reference, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(txId, id, user.id, tx.transaction_date, tx.description,
        tx.deposit_amount || 0, tx.withdrawal_amount || 0, tx.balance ?? 0,
        tx.account_type || account_type || null, tx.reference || null,
        tx.sort_order || txCount
      ).run();
      txCount++;
    }
  }

  return c.json({ id, file_name: fileName, transactions_count: txCount }, 201);
});

// ── Upload (legacy base64) ──
bank.post('/upload', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json();
  const { file_name, file_type, file_data, r2_key, bank_name, account_number, branch, currency, statement_year, statement_month } = body;

  if (!file_data && !r2_key) return c.json({ error: 'file_data or r2_key required' }, 400);

  const id = `bs-${uuidv4().slice(0, 8)}`;
  let ocrText = '';
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;

  if (file_data && c.env.AI) {
    try {
      const cleanBase64 = file_data.replace(/^data:.*?;base64,/, '');
      const aiResponse = await c.env.AI.run('@cf/unum/uform-gen2-qwen-500m', {
        prompt: 'Extract all text from this bank statement. Return: Bank Name, Account Number, Statement Period, Opening Balance, Closing Balance, and list of transactions with dates and amounts.',
        image: cleanBase64,
      });
      ocrText = (aiResponse as any)?.description || '';
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
    `INSERT INTO bank_statements (id, user_id, file_name, file_type, file_data, r2_key,
     bank_name, account_number, branch, currency,
     statement_year, statement_month, opening_balance, closing_balance, ocr_text)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, user.id, file_name || null, file_type || 'application/pdf',
    file_data || '', r2_key || null,
    bank_name || null, account_number || null, branch || null,
    currency || 'HKD',
    statement_year || null, statement_month || null,
    openingBalance, closingBalance, ocrText).run();

  const row = await db.prepare(
    `SELECT id, file_name, bank_name, account_number, branch, currency,
     statement_year, statement_month, period_start, period_end,
     opening_balance, closing_balance, ocr_text, status, created_at
     FROM bank_statements WHERE id = ?`
  ).bind(id).first();
  return c.json({ ...row, ocr_used: c.env.AI ? !!ocrText && ocrText.length > 20 : false }, 201);
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
