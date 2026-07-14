import { getJwtSecret } from '../middleware/auth';
import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { verify as jwtVerify } from 'jsonwebtoken';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const expenses = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Download file (token-protected) ──
expenses.get('/:id/file', async (c) => {
  let userId: string | null = null;
  const jwt = c.req.header('Cookie')?.match(/(?:^|;\s*)token=([^;]+)/)?.[1]
    || c.req.header('Authorization')?.replace('Bearer ', '')
    || c.req.query('token');
  if (jwt) {
    try { const p = jwtVerify(jwt, getJwtSecret(c.env)) as { id: string }; userId = p.id; } catch {}
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
  const p: any[] = [tenantId];
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
  ).bind(id, tenantId, file_name || null, file_type || 'image/png', file_data,
    vendor_name || ocrVendor || null, amount || ocrAmount || null, expense_date || ocrDate || null,
    category || null, description || null, payment_method || null, ocrText).run();

  // Auto-create journal entry for the expense
  const finalAmount = amount || ocrAmount || 0;
  if (finalAmount > 0) {
    const catMap: Record<string, { code: string; name: string }> = {
      rent: { code: '62101', name: 'Office Rent 辦公室租金' },
      utilities: { code: '62201', name: 'Electricity 電費' },
      travel: { code: '64301', name: 'Local Transport 本地交通' },
      office: { code: '62401', name: 'Stationery & Printing 文具及印刷' },
      software: { code: '62303', name: 'Software Subscriptions 軟件訂閱費' },
      insurance: { code: '63301', name: 'EC Insurance 勞工保險' },
      professional: { code: '63101', name: 'Audit Fee 審計費用' },
      meals: { code: '64202', name: 'Entertainment 交際應酬費' },
      advertising: { code: '64101', name: 'Advertising 廣告費用' },
      bank: { code: '65101', name: 'Bank Service Fee 銀行手續費' },
    };
    const cat = catMap[category || ''] || { code: '66203', name: 'Miscellaneous 其他雜項' };
    const isPaid = payment_method === 'cash' || payment_method === 'bank_transfer' || !payment_method;
    const creditCode = isPaid ? '11101' : '21101';
    const creditName = isPaid ? 'Cash on Hand 庫存現金' : 'Trade Creditors 應付賬款';

    const jeId = `je-${uuidv4().slice(0, 8)}`;
    const jeNum = `JE-EXP-${id.slice(0, 8)}`;
    const jeDate = expense_date || ocrDate || new Date().toISOString().split('T')[0];
    await db.prepare(
      "INSERT INTO journal_entries (id, user_id, entry_number, entry_date, description, reference_type, reference_id, status) VALUES (?,?,?,?,?,?,?,'draft')"
    ).bind(jeId, tenantId, jeNum, jeDate, `${vendor_name || 'Expense'}: ${description || ''}`, 'expense', id).run();
    await db.prepare(
      'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, cat.code, cat.name, description || '', finalAmount, 0, 0).run();
    await db.prepare(
      'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, creditCode, creditName, description || '', 0, finalAmount, 1).run();
  }

  const row = await db.prepare('SELECT id, file_name, vendor_name, amount, expense_date, category, description, payment_method, ocr_text, status, created_at FROM expense_receipts WHERE id = ?').bind(id).first();
  return c.json({ ...row, ocr_used: c.env.AI ? !!ocrText && ocrText.length > 20 : false, journal_entry_created: finalAmount > 0 }, 201);
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
