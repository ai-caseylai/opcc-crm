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

// Balance Sheet — Assets, Liabilities, and Equity as of a date
bookkeeping.get('/balance-sheet', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const asOf = c.req.query('as_of') || new Date().toISOString().split('T')[0];

  // Get all journal lines up to as_of date
  const rows = await db.prepare(
    `SELECT jl.account_code, jl.account_name, a.account_type, SUM(jl.debit) as total_debit, SUM(jl.credit) as total_credit
     FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
     LEFT JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date <= ?
     GROUP BY jl.account_code, jl.account_name
     ORDER BY jl.account_code`
  ).bind(user.id, asOf).all();

  const jeCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM journal_entries WHERE user_id = ? AND entry_date <= ?'
  ).bind(user.id, asOf).first<{ cnt: number }>();

  if ((jeCount?.cnt || 0) > 0 && (rows.results || []).length > 0) {
    // Calculate balances: Assets/Expenses = debit - credit, Liabilities/Equity/Revenue = credit - debit
    const calcBalance = (row: any) => {
      if (row.account_type === 'asset' || row.account_type === 'expense') {
        return row.total_debit - row.total_credit;
      }
      return row.total_credit - row.total_debit;
    };

    const assets: { code: string; name: string; balance: number }[] = [];
    const liabilities: { code: string; name: string; balance: number }[] = [];
    const equity: { code: string; name: string; balance: number }[] = [];
    let totalRevenue = 0;
    let totalExpenses = 0;

    for (const row of rows.results as any[]) {
      const balance = calcBalance(row);
      const accountType = (row.account_type || '').toLowerCase();
      if (row.account_code?.startsWith('1') || accountType === 'asset') {
        assets.push({ code: row.account_code, name: row.account_name, balance });
      } else if (row.account_code?.startsWith('2') || accountType === 'liability') {
        liabilities.push({ code: row.account_code, name: row.account_name, balance });
      } else if (row.account_code?.startsWith('3') || accountType === 'equity') {
        equity.push({ code: row.account_code, name: row.account_name, balance });
      } else if (row.account_code?.startsWith('4') || accountType === 'revenue') {
        totalRevenue += balance;
      } else if (row.account_code?.startsWith('5') || accountType === 'expense') {
        totalExpenses += balance;
      }
    }

    const retainedEarnings = totalRevenue - totalExpenses;
    if (Math.abs(retainedEarnings) > 0.01) {
      equity.push({ code: '3xxx', name: 'Retained Earnings (本年度盈餘)', balance: retainedEarnings });
    }

    const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0);
    const totalEquity = equity.reduce((s, e) => s + e.balance, 0);

    return c.json({
      assets, liabilities, equity,
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
      total_equity: totalEquity,
      retained_earnings: retainedEarnings,
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      check: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      as_of: asOf,
      source: 'journal',
    });
  }

  // Fallback: estimate from bank transactions
  const bankDeposits = await db.prepare(
    `SELECT COALESCE(SUM(deposit_amount), 0) as amount FROM bank_transactions WHERE user_id = ? AND transaction_date <= ?`
  ).bind(user.id, asOf).first<{ amount: number }>();
  const bankWithdrawals = await db.prepare(
    `SELECT COALESCE(SUM(withdrawal_amount), 0) as amount FROM bank_transactions WHERE user_id = ? AND transaction_date <= ?`
  ).bind(user.id, asOf).first<{ amount: number }>();

  const cashBalance = (bankDeposits?.amount || 0) - (bankWithdrawals?.amount || 0);
  const netCash = Math.max(cashBalance, 0);
  const netDeficit = Math.max(-cashBalance, 0);

  return c.json({
    assets: [
      { code: '1101', name: 'Cash (銀行現金估算)', balance: netCash },
    ],
    liabilities: netDeficit > 0.01 ? [
      { code: '2102', name: 'Director Loan (估算)', balance: netDeficit },
    ] : [],
    equity: [
      { code: '3xxx', name: 'Retained Earnings (估算)', balance: netCash - netDeficit },
    ],
    total_assets: netCash,
    total_liabilities: netDeficit,
    total_equity: netCash - netDeficit,
    retained_earnings: netCash - netDeficit,
    total_revenue: bankDeposits?.amount || 0,
    total_expenses: bankWithdrawals?.amount || 0,
    check: true,
    as_of: asOf,
    source: 'bank',
  });
});

// General Ledger — grouped by account with running balances
bookkeeping.get('/ledger', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const startDate = c.req.query('start_date') || '2000-01-01';
  const endDate = c.req.query('end_date') || '2099-12-31';
  const filterAccount = c.req.query('account_code');

  // Check if journal entries exist
  const jeCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM journal_entries WHERE user_id = ? AND entry_date >= ? AND entry_date <= ?'
  ).bind(user.id, startDate, endDate).first<{ cnt: number }>();

  if ((jeCount?.cnt || 0) > 0) {
    // Use journal entries
    let query = `SELECT jl.account_code, jl.account_name, a.account_type, je.entry_date as date, je.description, jl.debit, jl.credit
      FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
      LEFT JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
      WHERE je.user_id = ? AND je.entry_date >= ? AND je.entry_date <= ?`;
    const params: any[] = [user.id, startDate, endDate];
    if (filterAccount) { query += ' AND jl.account_code LIKE ?'; params.push(`${filterAccount}%`); }
    query += ' ORDER BY jl.account_code, je.entry_date, jl.sort_order';
    const rows = await db.prepare(query).bind(...params).all();

    // Group by account and compute running balances
    const groups: Record<string, { account_code: string; account_name: string; account_type: string; entries: any[]; total_debit: number; total_credit: number }> = {};
    for (const row of rows.results as any[]) {
      const key = row.account_code;
      if (!groups[key]) groups[key] = { account_code: row.account_code, account_name: row.account_name, account_type: row.account_type || '', entries: [], total_debit: 0, total_credit: 0 };
      const g = groups[key];
      const lastBalance = g.entries.length > 0 ? g.entries[g.entries.length - 1].balance : 0;
      // Assets/Expenses: debit increases, credit decreases. Liabilities/Equity/Revenue: opposite.
      const isDebitNatural = row.account_type === 'asset' || row.account_type === 'expense';
      const change = isDebitNatural ? (row.debit - row.credit) : (row.credit - row.debit);
      const balance = lastBalance + change;
      g.entries.push({ date: row.date, description: row.description, debit: row.debit, credit: row.credit, balance });
      g.total_debit += row.debit;
      g.total_credit += row.credit;
    }
    return c.json({ accounts: Object.values(groups), source: 'journal', period: { start: startDate, end: endDate } });
  }

  // Fallback: bank_transactions
  const bankRows = await db.prepare(
    `SELECT bt.*, i.invoice_number, i.supplier_id, i.customer_id
     FROM bank_transactions bt LEFT JOIN invoices i ON bt.invoice_id = i.id
     WHERE bt.user_id = ? AND bt.transaction_date >= ? AND bt.transaction_date <= ?
     ORDER BY bt.transaction_date`
  ).bind(user.id, startDate, endDate).all();

  const isDirector = (desc: string) => /JOSEPH|LIN|RAYMOND|SZETO/i.test(desc);

  interface LedgerEntry { date: string; description: string; debit: number; credit: number; balance: number }
  interface AccountGroup { account_code: string; account_name: string; account_type: string; entries: LedgerEntry[]; total_debit: number; total_credit: number }
  const groups: Record<string, AccountGroup> = {};
  const ensure = (code: string, name: string, type: string) => {
    if (!groups[code]) groups[code] = { account_code: code, account_name: name, account_type: type, entries: [], total_debit: 0, total_credit: 0 };
    return groups[code];
  };
  const push = (g: AccountGroup, e: LedgerEntry) => { const last = g.entries.length > 0 ? g.entries[g.entries.length - 1].balance : 0; const isDebitNat = g.account_type === 'asset' || g.account_type === 'expense'; const change = isDebitNat ? (e.debit - e.credit) : (e.credit - e.debit); e.balance = last + change; g.entries.push(e); g.total_debit += e.debit; g.total_credit += e.credit; };

  for (const tx of bankRows.results as any[]) {
    const desc = tx.description || '';
    const invInfo = tx.invoice_number ? ` (${tx.invoice_number})` : '';
    if (tx.deposit_amount > 0) {
      // Debit Cash
      push(ensure('1101', 'Cash', 'asset'), { date: tx.transaction_date, description: desc + invInfo, debit: tx.deposit_amount, credit: 0, balance: 0 });
      // Credit revenue or Director Loan
      if (isDirector(desc)) {
        push(ensure('2102', 'Director Loan', 'liability'), { date: tx.transaction_date, description: desc, debit: 0, credit: tx.deposit_amount, balance: 0 });
      } else {
        push(ensure('4100', 'Sales Revenue', 'revenue'), { date: tx.transaction_date, description: desc + invInfo, debit: 0, credit: tx.deposit_amount, balance: 0 });
      }
    }
    if (tx.withdrawal_amount > 0) {
      const expCode = tx.supplier_id ? '5100' : '5200';
      const expName = tx.supplier_id ? 'Cost of Goods Sold' : 'Operating Expenses';
      push(ensure(expCode, expName, 'expense'), { date: tx.transaction_date, description: desc + invInfo, debit: tx.withdrawal_amount, credit: 0, balance: 0 });
      push(ensure('1101', 'Cash', 'asset'), { date: tx.transaction_date, description: desc + invInfo, debit: 0, credit: tx.withdrawal_amount, balance: 0 });
    }
  }

  if (filterAccount) {
    const filtered: Record<string, AccountGroup> = {};
    for (const [k, v] of Object.entries(groups)) {
      if (k.startsWith(filterAccount)) filtered[k] = v;
    }
    return c.json({ accounts: Object.values(filtered), source: 'bank', period: { start: startDate, end: endDate } });
  }

  return c.json({ accounts: Object.values(groups), source: 'bank', period: { start: startDate, end: endDate } });
});

// Auto-generate journal entries from bank transactions
bookkeeping.post('/auto-generate-entries', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  // Get bank transactions not yet converted to journal entries
  const existingRefs = await db.prepare(
    "SELECT reference_id FROM journal_entries WHERE user_id = ? AND reference_type = 'bank_transaction'"
  ).bind(user.id).all();
  const refSet = new Set((existingRefs.results as any[]).map(r => r.reference_id));

  const txRows = await db.prepare(
    `SELECT bt.*, i.invoice_number, i.supplier_id
     FROM bank_transactions bt LEFT JOIN invoices i ON bt.invoice_id = i.id
     WHERE bt.user_id = ? ORDER BY bt.transaction_date`
  ).bind(user.id).all();

  const isDirector = (desc: string) => /JOSEPH|LIN|RAYMOND|SZETO/i.test(desc);
  let created = 0;

  for (const tx of txRows.results as any[]) {
    if (refSet.has(tx.id)) continue;

    const desc = tx.description || '';
    const invInfo = tx.invoice_number ? ` (${tx.invoice_number})` : '';
    const entryId = `je-${uuidv4().slice(0, 8)}`;
    const entryNum = `JE-AUTO-${String(created + 1).padStart(4, '0')}`;
    const lines: { code: string; name: string; debit: number; credit: number }[] = [];

    if (tx.deposit_amount > 0) {
      lines.push({ code: '1101', name: 'Cash', debit: tx.deposit_amount, credit: 0 });
      if (isDirector(desc)) {
        lines.push({ code: '2102', name: 'Director Loan', debit: 0, credit: tx.deposit_amount });
      } else {
        lines.push({ code: '4100', name: 'Sales Revenue', debit: 0, credit: tx.deposit_amount });
      }
    }
    if (tx.withdrawal_amount > 0) {
      const expCode = tx.supplier_id ? '5100' : '5200';
      const expName = tx.supplier_id ? 'Cost of Goods Sold' : 'Operating Expenses';
      lines.push({ code: expCode, name: expName, debit: tx.withdrawal_amount, credit: 0 });
      lines.push({ code: '1101', name: 'Cash', debit: 0, credit: tx.withdrawal_amount });
    }

    if (lines.length === 0) continue;

    await db.prepare(
      'INSERT INTO journal_entries (id, user_id, entry_number, entry_date, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(entryId, user.id, entryNum, tx.transaction_date, desc + invInfo, 'bank_transaction', tx.id).run();

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await db.prepare(
        'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(`jl-${uuidv4().slice(0, 8)}`, entryId, l.code, l.name, desc + invInfo, l.debit, l.credit, i).run();
    }
    created++;
  }

  return c.json({ created, total_transactions: txRows.results.length, skipped: refSet.size });
});

export { bookkeeping as bookkeepingRoutes };
