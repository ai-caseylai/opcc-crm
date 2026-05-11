import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware, auditorMiddleware } from '../middleware/auth';

const bookkeeping = new Hono<{ Bindings: Bindings; Variables: Variables }>();
bookkeeping.use('*', authMiddleware);

bookkeeping.get('/entries', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = (page - 1) * limit;
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');

  let query = 'SELECT * FROM journal_entries WHERE user_id = ?';
  const params: any[] = [user.id];
  if (startDate) { query += ' AND entry_date >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND entry_date <= ?'; params.push(endDate); }
  query += ' ORDER BY entry_date DESC, created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all();
  return c.json({ data: rows.results, page, limit });
});

bookkeeping.get('/entries/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const entry = await db.prepare('SELECT * FROM journal_entries WHERE id = ? AND user_id = ?').bind(c.req.param('id'), user.id).first();
  if (!entry) return c.json({ error: 'Entry not found' }, 404);
  const lines = await db.prepare('SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY sort_order').bind(c.req.param('id')).all();
  return c.json({ ...entry, lines: lines.results });
});

const lineSchema = z.object({
  account_code: z.string().min(1), account_name: z.string().min(1),
  description: z.string().optional(), debit: z.number().optional(), credit: z.number().optional(),
});

const entrySchema = z.object({
  entry_number: z.string().min(1), entry_date: z.string(), description: z.string().min(1),
  reference_type: z.string().optional(), reference_id: z.string().optional(), lines: z.array(lineSchema).min(2),
});

bookkeeping.post('/entries', zValidator('json', entrySchema), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `je-${uuidv4().slice(0, 8)}`;

  const totalDebit = data.lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = data.lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.001) return c.json({ error: 'Debits must equal credits' }, 400);

  await db.prepare(
    'INSERT INTO journal_entries (id, user_id, entry_number, entry_date, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, data.entry_number, data.entry_date, data.description, data.reference_type || null, data.reference_id || null).run();

  for (let i = 0; i < data.lines.length; i++) {
    const line = data.lines[i];
    await db.prepare(
      'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(`jl-${uuidv4().slice(0, 8)}`, id, line.account_code, line.account_name, line.description || null, line.debit || 0, line.credit || 0, i).run();
  }

  const entry = await db.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(id).first();
  const lines = await db.prepare('SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY sort_order').bind(id).all();
  return c.json({ ...entry, lines: lines.results }, 201);
});

bookkeeping.get('/accounts', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare('SELECT * FROM accounts WHERE user_id = ? AND is_active = 1 ORDER BY account_code').bind(user.id).all();
  return c.json({ data: rows.results });
});

bookkeeping.get('/trial-balance', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const asOf = c.req.query('as_of') || new Date().toISOString().split('T')[0];
  const rows = await db.prepare(
    `SELECT jl.account_code, jl.account_name, a.account_type, SUM(jl.debit) as total_debit, SUM(jl.credit) as total_credit
     FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
     LEFT JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date <= ? GROUP BY jl.account_code, jl.account_name ORDER BY jl.account_code`
  ).bind(user.id, asOf).all();
  return c.json({ data: rows.results, as_of: asOf });
});

bookkeeping.get('/export', auditorMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const startDate = c.req.query('start_date') || '2000-01-01';
  const endDate = c.req.query('end_date') || '2099-12-31';
  const format = c.req.query('format') || 'json';

  const entries = await db.prepare(
    `SELECT je.*, jl.account_code, jl.account_name, jl.description as line_description, jl.debit, jl.credit
     FROM journal_entries je JOIN journal_lines jl ON je.id = jl.entry_id
     WHERE je.user_id = ? AND je.entry_date >= ? AND je.entry_date <= ?
     ORDER BY je.entry_date, je.entry_number, jl.sort_order`
  ).bind(user.id, startDate, endDate).all();

  if (format === 'csv') {
    let csv = 'Entry Date,Entry Number,Description,Account Code,Account Name,Line Description,Debit,Credit\n';
    for (const row of entries.results as any[]) {
      csv += `"${row.entry_date}","${row.entry_number}","${row.description}","${row.account_code}","${row.account_name}","${row.line_description || ''}",${row.debit},${row.credit}\n`;
    }
    return c.text(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=bookkeeping-export.csv' });
  }
  return c.json({ data: entries.results, period: { start: startDate, end: endDate } });
});

bookkeeping.get('/income-statement', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const startDate = c.req.query('start_date') || '2000-01-01';
  const endDate = c.req.query('end_date') || new Date().toISOString().split('T')[0];

  // Try journal entries first
  const revenue = await db.prepare(
    `SELECT COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as amount FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
     WHERE je.user_id = ? AND je.entry_date >= ? AND je.entry_date <= ? AND jl.account_code LIKE '4%'`
  ).bind(user.id, startDate, endDate).first<{ amount: number }>();

  const expenses = await db.prepare(
    `SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as amount FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
     WHERE je.user_id = ? AND je.entry_date >= ? AND je.entry_date <= ? AND jl.account_code LIKE '5%'`
  ).bind(user.id, startDate, endDate).first<{ amount: number }>();

  // If journal entries exist, use them
  if ((revenue?.amount || 0) > 0 || (expenses?.amount || 0) > 0) {
    const netIncome = (revenue?.amount || 0) - (expenses?.amount || 0);
    return c.json({ revenue: revenue?.amount || 0, expenses: expenses?.amount || 0, net_income: netIncome, source: 'journal', period: { start: startDate, end: endDate } });
  }

  // Fallback: use bank transactions (deposits ≈ income, withdrawals ≈ expenses)
  const bankRevenue = await db.prepare(
    `SELECT COALESCE(SUM(deposit_amount), 0) as amount FROM bank_transactions WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ?`
  ).bind(user.id, startDate, endDate).first<{ amount: number }>();

  const bankExpenses = await db.prepare(
    `SELECT COALESCE(SUM(withdrawal_amount), 0) as amount FROM bank_transactions WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ?`
  ).bind(user.id, startDate, endDate).first<{ amount: number }>();

  const netIncome = (bankRevenue?.amount || 0) - (bankExpenses?.amount || 0);
  return c.json({ revenue: bankRevenue?.amount || 0, expenses: bankExpenses?.amount || 0, net_income: netIncome, source: 'bank', period: { start: startDate, end: endDate } });
});

export { bookkeeping as bookkeepingRoutes };
