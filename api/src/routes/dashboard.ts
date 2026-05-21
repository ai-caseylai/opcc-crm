import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const dashboard = new Hono<{ Bindings: Bindings; Variables: Variables }>();
dashboard.use('*', authMiddleware);

dashboard.get('/', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.slice(0, 7) + '-01';

  // Cash balance (GL bank accounts)
  const cashBalance = await db.prepare(
    `SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as balance
     FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
     WHERE je.user_id = ? AND jl.account_code LIKE '111%'`
  ).bind(tenantId).first<{ balance: number }>();

  // Accounts Receivable
  const arBalance = await db.prepare(
    `SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as balance
     FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
     WHERE je.user_id = ? AND jl.account_code LIKE '112%'`
  ).bind(tenantId).first<{ balance: number }>();

  // Accounts Payable
  const apBalance = await db.prepare(
    `SELECT COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as balance
     FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
     WHERE je.user_id = ? AND jl.account_code LIKE '211%'`
  ).bind(tenantId).first<{ balance: number }>();

  // Revenue MTD
  const revenueMTD = await db.prepare(
    `SELECT COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as amount FROM journal_lines jl
     JOIN journal_entries je ON jl.entry_id = je.id
     JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date >= ? AND a.account_type = 'revenue'`
  ).bind(tenantId, monthStart).first<{ amount: number }>();

  // Expenses MTD
  const expensesMTD = await db.prepare(
    `SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as amount FROM journal_lines jl
     JOIN journal_entries je ON jl.entry_id = je.id
     JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date >= ? AND a.account_type = 'expense'`
  ).bind(tenantId, monthStart).first<{ amount: number }>();

  // Unmatched bank transactions count
  const unmatchedCount = await db.prepare(
    "SELECT COUNT(*) as cnt FROM bank_transactions WHERE user_id = ? AND account_code IS NULL"
  ).bind(tenantId).first<{ cnt: number }>();

  // Recent journal entries
  const recentEntries = await db.prepare(
    `SELECT je.id, je.entry_number, je.entry_date, je.description, je.status,
     SUM(jl.debit) as total_debit, SUM(jl.credit) as total_credit
     FROM journal_entries je LEFT JOIN journal_lines jl ON je.id = jl.entry_id
     WHERE je.user_id = ? GROUP BY je.id ORDER BY je.created_at DESC LIMIT 5`
  ).bind(tenantId).all();

  // Compliance deadlines (next 30 days)
  const upcomingCompliance = await db.prepare(
    `SELECT mc.status, ct.title_zh, ct.title_en, cd.date_value
     FROM member_compliance mc
     JOIN compliance_templates ct ON mc.template_id = ct.id
     LEFT JOIN compliance_dates cd ON cd.user_id = mc.user_id AND cd.date_type = ct.deadline_field
     WHERE mc.user_id = ? AND mc.status = 'pending'
     ORDER BY cd.date_value LIMIT 5`
  ).bind(tenantId).all();

  // Fixed assets summary
  const assetSummary = await db.prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(cost),0) as total_cost,
     COALESCE(SUM(accumulated_depreciation),0) as total_acc_depn, COALESCE(SUM(net_book_value),0) as total_nbv
     FROM fixed_assets WHERE user_id = ? AND is_active = 1`
  ).bind(tenantId).first<{ count: number; total_cost: number; total_acc_depn: number; total_nbv: number }>();

  const netIncomeMTD = (revenueMTD?.amount || 0) - (expensesMTD?.amount || 0);

  // Check if journal entries exist; if not, fallback to bank data for cash balance
  const jeCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM journal_entries WHERE user_id = ?'
  ).bind(tenantId).first<{ cnt: number }>();
  const source = (jeCount?.cnt || 0) > 0 ? 'journal' : 'bank';

  let cashBal = cashBalance?.balance || 0;
  if (source === 'bank') {
    const bankCash = await db.prepare(
      `SELECT COALESCE(SUM(deposit_amount) - SUM(withdrawal_amount), 0) as balance
       FROM bank_transactions WHERE user_id = ?`
    ).bind(tenantId).first<{ balance: number }>();
    cashBal = bankCash?.balance || 0;
  }

  return c.json({
    cash_balance: cashBal,
    ar_balance: arBalance?.balance || 0,
    ap_balance: apBalance?.balance || 0,
    revenue_mtd: revenueMTD?.amount || 0,
    expenses_mtd: expensesMTD?.amount || 0,
    net_income_mtd: netIncomeMTD,
    unmatched_transactions: unmatchedCount?.cnt || 0,
    fixed_assets: assetSummary,
    recent_entries: recentEntries.results,
    upcoming_compliance: upcomingCompliance.results,
    as_of: today,
    source,
  });
});

export { dashboard as dashboardRoutes };
