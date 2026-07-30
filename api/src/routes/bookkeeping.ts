import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware, auditorMiddleware, bookkeeperMiddleware } from '../middleware/auth';

const bookkeeping = new Hono<{ Bindings: Bindings; Variables: Variables }>();
bookkeeping.use('*', authMiddleware);

// HK COA account name lookup (from coa-hk.sql template)
export const HK_COA_NAMES: Record<string, { name: string; type: string; parent: string | null }> = {
  '10000': { name: '資產 Assets', type: 'asset', parent: null },
  '11000': { name: '流動資產 Current Assets', type: 'asset', parent: '10000' },
  '12000': { name: '固定資產 Fixed Assets', type: 'asset', parent: '10000' },
  '11100': { name: '現金及銀行存款 Cash & Bank', type: 'asset', parent: '11000' },
  '11200': { name: '應收賬款及票據 AR & Notes', type: 'asset', parent: '11000' },
  '11300': { name: '其他應收款 Other Receivables', type: 'asset', parent: '11000' },
  '11400': { name: '預付及按金 Prepayments & Deposits', type: 'asset', parent: '11000' },
  '12100': { name: '物業房產 Property', type: 'asset', parent: '12000' },
  '12200': { name: '設備及器材 Equipment', type: 'asset', parent: '12000' },
  '12300': { name: '累計折舊 Accumulated Depreciation', type: 'asset', parent: '12000' },
  '11101': { name: '庫存現金 Cash on Hand', type: 'asset', parent: '11100' },
  '11102': { name: '匯豐銀行 HSBC', type: 'asset', parent: '11100' },
  '11103': { name: '其他銀行 Other Bank', type: 'asset', parent: '11100' },
  '11201': { name: '應收賬款 Trade Debtors', type: 'asset', parent: '11200' },
  '11301': { name: '應收董事款項 Director Loan to Co', type: 'asset', parent: '11300' },
  '11302': { name: '暫付款 Sundry Debtors', type: 'asset', parent: '11300' },
  '11401': { name: '預付費用 Prepayments', type: 'asset', parent: '11400' },
  '11402': { name: '租金按金 Rental Deposit', type: 'asset', parent: '11400' },
  '11403': { name: '其他按金 Other Deposits', type: 'asset', parent: '11400' },
  '12201': { name: '辦公設備 Office Equipment', type: 'asset', parent: '12200' },
  '12202': { name: '電腦設備 Computer Equipment', type: 'asset', parent: '12200' },
  '12203': { name: '汽車 Vehicles', type: 'asset', parent: '12200' },
  '12301': { name: '累計折舊-設備 Accumulated Depn-Equip', type: 'asset', parent: '12300' },
  '12302': { name: '累計折舊-電腦 Accumulated Depn-Computer', type: 'asset', parent: '12300' },
  '20000': { name: '負債 Liabilities', type: 'liability', parent: null },
  '21000': { name: '流動負債 Current Liabilities', type: 'liability', parent: '20000' },
  '22000': { name: '長期負債 Long-term Liabilities', type: 'liability', parent: '20000' },
  '21100': { name: '應付賬款及票據 AP & Notes', type: 'liability', parent: '21000' },
  '21200': { name: '其他應付款 Other Payables', type: 'liability', parent: '21000' },
  '21300': { name: '應付稅項 Tax Payable', type: 'liability', parent: '21000' },
  '21400': { name: '預收及應計 Accruals & Deferred', type: 'liability', parent: '21000' },
  '21101': { name: '應付賬款 Trade Creditors', type: 'liability', parent: '21100' },
  '21201': { name: '應付董事款項 Director Loan from Dir', type: 'liability', parent: '21200' },
  '21202': { name: '暫收款 Sundry Creditors', type: 'liability', parent: '21200' },
  '21203': { name: '應付薪金 Salary Payable', type: 'liability', parent: '21200' },
  '21204': { name: '應付強積金 MPF Payable', type: 'liability', parent: '21200' },
  '21301': { name: '應付利得稅 Profits Tax Payable', type: 'liability', parent: '21300' },
  '21401': { name: '預收收入 Deferred Revenue', type: 'liability', parent: '21400' },
  '21402': { name: '應計費用 Accrued Expenses', type: 'liability', parent: '21400' },
  '30000': { name: '資本及儲備 Equity & Reserves', type: 'equity', parent: null },
  '31000': { name: '股本及往來 Share Capital & Current', type: 'equity', parent: '30000' },
  '32000': { name: '儲備及損益 Reserves & P&L', type: 'equity', parent: '30000' },
  '31100': { name: '股本 Share Capital', type: 'equity', parent: '31000' },
  '31200': { name: '董事往來 Director Current Account', type: 'equity', parent: '31000' },
  '32100': { name: '留存盈利 Retained Earnings', type: 'equity', parent: '32000' },
  '32200': { name: '本年損益 Current Year P&L', type: 'equity', parent: '32000' },
  '31101': { name: '普通股本 Ordinary Shares', type: 'equity', parent: '31100' },
  '31201': { name: '董事往來-往來帳 Director Current A/C', type: 'equity', parent: '31200' },
  '31202': { name: '董事酬金 Director Remuneration', type: 'equity', parent: '31200' },
  '32101': { name: '上年度保留盈利 Retained Earnings b/f', type: 'equity', parent: '32100' },
  '40000': { name: '收入 Revenue', type: 'revenue', parent: null },
  '41000': { name: '營業收入 Operating Revenue', type: 'revenue', parent: '40000' },
  '42000': { name: '其他收益 Other Income', type: 'revenue', parent: '40000' },
  '41100': { name: '服務收入 Service Income', type: 'revenue', parent: '41000' },
  '41200': { name: '銷售收入 Sales Revenue', type: 'revenue', parent: '41000' },
  '41300': { name: '顧問收入 Consulting Income', type: 'revenue', parent: '41000' },
  '42100': { name: '利息及投資收入 Interest & Investment', type: 'revenue', parent: '42000' },
  '42200': { name: '非經常性收入 Non-recurring Income', type: 'revenue', parent: '42000' },
  '41101': { name: '專業服務收入 Professional Services', type: 'revenue', parent: '41100' },
  '41102': { name: '技術服務收入 Technical Services', type: 'revenue', parent: '41100' },
  '42101': { name: '銀行利息收入 Bank Interest', type: 'revenue', parent: '42100' },
  '42201': { name: '政府補貼 Government Subsidy', type: 'revenue', parent: '42200' },
  '42202': { name: '匯兌收益 Exchange Gain', type: 'revenue', parent: '42200' },
  '50000': { name: '直接成本 Direct Costs', type: 'expense', parent: null },
  '51000': { name: '服務成本 Cost of Services', type: 'expense', parent: '50000' },
  '52000': { name: '銷售成本 Cost of Sales', type: 'expense', parent: '50000' },
  '51100': { name: '外判及顧問費 Subcontractor & Consultant', type: 'expense', parent: '51000' },
  '51200': { name: '直接人工 Direct Labour', type: 'expense', parent: '51000' },
  '51101': { name: '外判工作費用 Subcontractor Fees', type: 'expense', parent: '51100' },
  '51102': { name: '專業顧問費 Professional Consultant', type: 'expense', parent: '51100' },
  '51201': { name: '項目人員薪酬 Project Staff Salary', type: 'expense', parent: '51200' },
  '60000': { name: '營運支出 Operating Expenses', type: 'expense', parent: null },
  '61000': { name: '員工支出 Staff Costs', type: 'expense', parent: '60000' },
  '62000': { name: '辦公室支出 Office Costs', type: 'expense', parent: '60000' },
  '63000': { name: '專業及合規 Professional & Compliance', type: 'expense', parent: '60000' },
  '64000': { name: '銷售及推廣 Sales & Marketing', type: 'expense', parent: '60000' },
  '65000': { name: '財務及銀行 Finance & Banking', type: 'expense', parent: '60000' },
  '66000': { name: '其他營運支出 Other Operating', type: 'expense', parent: '60000' },
  '61100': { name: '董事及管理層 Director & Management', type: 'expense', parent: '61000' },
  '61101': { name: '董事袍金 Director Fee', type: 'expense', parent: '61100' },
  '61102': { name: '管理層薪金 Management Salary', type: 'expense', parent: '61100' },
  '61200': { name: '員工薪酬 Staff Remuneration', type: 'expense', parent: '61000' },
  '61201': { name: '員工薪金 Staff Salaries', type: 'expense', parent: '61200' },
  '61202': { name: '強積金僱主供款 MPF Employer Contribution', type: 'expense', parent: '61200' },
  '61203': { name: '員工福利 Staff Benefits', type: 'expense', parent: '61200' },
  '62100': { name: '租金 Rent', type: 'expense', parent: '62000' },
  '62101': { name: '辦公室租金 Office Rent', type: 'expense', parent: '62100' },
  '62102': { name: '差餉及管理費 Rates & Management', type: 'expense', parent: '62100' },
  '62200': { name: '水電煤 Utilities', type: 'expense', parent: '62000' },
  '62201': { name: '電費 Electricity', type: 'expense', parent: '62200' },
  '62202': { name: '水費 Water', type: 'expense', parent: '62200' },
  '62300': { name: '電訊及科技 Telecom & IT', type: 'expense', parent: '62000' },
  '62301': { name: '電話及上網 Phone & Internet', type: 'expense', parent: '62300' },
  '62302': { name: '網站寄存及域名 Web Hosting & Domain', type: 'expense', parent: '62300' },
  '62303': { name: '軟件訂閱費 Software Subscriptions', type: 'expense', parent: '62300' },
  '62400': { name: '辦公雜項 Office Miscellaneous', type: 'expense', parent: '62000' },
  '62401': { name: '文具及印刷 Stationery & Printing', type: 'expense', parent: '62400' },
  '62402': { name: '茶水及清潔 Pantry & Cleaning', type: 'expense', parent: '62400' },
  '63100': { name: '專業服務 Professional Services', type: 'expense', parent: '63000' },
  '63101': { name: '審計費用 Audit Fee', type: 'expense', parent: '63100' },
  '63102': { name: '公司秘書費 Company Secretary Fee', type: 'expense', parent: '63100' },
  '63103': { name: '法律顧問費 Legal Fee', type: 'expense', parent: '63100' },
  '63200': { name: '政府規費 Government Fees', type: 'expense', parent: '63000' },
  '63201': { name: '商業登記費 BR Renewal Fee', type: 'expense', parent: '63200' },
  '63202': { name: '公司周年申報費 Annual Return Fee', type: 'expense', parent: '63200' },
  '63300': { name: '保險 Insurance', type: 'expense', parent: '63000' },
  '63301': { name: '勞工保險 EC Insurance', type: 'expense', parent: '63300' },
  '63302': { name: '專業責任保險 Professional Indemnity', type: 'expense', parent: '63300' },
  '64100': { name: '市場推廣 Marketing', type: 'expense', parent: '64000' },
  '64101': { name: '廣告費用 Advertising', type: 'expense', parent: '64100' },
  '64102': { name: '網站推廣 Website Promotion', type: 'expense', parent: '64100' },
  '64200': { name: '業務拓展 Business Development', type: 'expense', parent: '64000' },
  '64201': { name: '佣金支出 Commission Expense', type: 'expense', parent: '64200' },
  '64202': { name: '交際應酬費 Entertainment', type: 'expense', parent: '64200' },
  '64300': { name: '差旅交通 Travel & Transport', type: 'expense', parent: '64000' },
  '64301': { name: '本地交通 Local Transport', type: 'expense', parent: '64300' },
  '64302': { name: '海外差旅 Overseas Travel', type: 'expense', parent: '64300' },
  '65100': { name: '銀行費用 Bank Charges', type: 'expense', parent: '65000' },
  '65101': { name: '銀行手續費 Bank Service Fee', type: 'expense', parent: '65100' },
  '65102': { name: '貸款利息 Loan Interest', type: 'expense', parent: '65100' },
  '65200': { name: '匯兌差額 Exchange Difference', type: 'expense', parent: '65000' },
  '65201': { name: '匯兌損失 Exchange Loss', type: 'expense', parent: '65200' },
  '66100': { name: '折舊 Depreciation', type: 'expense', parent: '66000' },
  '66101': { name: '折舊-設備 Depreciation-Equipment', type: 'expense', parent: '66100' },
  '66102': { name: '折舊-電腦 Depreciation-Computer', type: 'expense', parent: '66100' },
  '66200': { name: '雜項支出 Sundry Expenses', type: 'expense', parent: '66000' },
  '66201': { name: '罰款及附加費 Penalties & Surcharges', type: 'expense', parent: '66200' },
  '66202': { name: '捐款 Donations', type: 'expense', parent: '66200' },
  '66203': { name: '其他雜項 Miscellaneous', type: 'expense', parent: '66200' },
  '80000': { name: '利得稅 Profits Tax', type: 'expense', parent: null },
  '81100': { name: '香港利得稅 HK Profits Tax', type: 'expense', parent: '80000' },
  '81101': { name: '本年度利得稅 Current Year Profits Tax', type: 'expense', parent: '81100' },
  '81102': { name: '遞延稅項 Deferred Tax', type: 'expense', parent: '81100' },
};

export function getCodeType(code: string): string {
  if (code.startsWith('1')) return 'asset';
  if (code.startsWith('2')) return 'liability';
  if (code.startsWith('3')) return 'equity';
  if (code.startsWith('4')) return 'revenue';
  if (code.startsWith('5') || code.startsWith('6') || code.startsWith('8')) return 'expense';
  return 'expense';
}

function getParentCandidates(code: string): string[] {
  const parents: string[] = [];
  if (code.length >= 5) parents.push(code.slice(0, 3) + '00');
  if (code.length >= 4) parents.push(code[0] + '000');
  return parents;
}

async function ensureMissingAccounts(db: any, tenantId: string, codes: string[], created: number[]) {
  const existingRows = await db.prepare(
    `SELECT account_code FROM accounts WHERE user_id = ? AND account_code IN (${codes.map(() => '?').join(',')})`
  ).bind(tenantId, ...codes).all();
  const existingSet = new Set((existingRows.results as any[]).map(r => r.account_code));

  for (const code of codes) {
    if (existingSet.has(code)) continue;
    const info = HK_COA_NAMES[code];
    const name = info?.name || `${code} (${getCodeType(code)})`;
    const type = info?.type || getCodeType(code);
    const parentCode = info?.parent || null;
    await db.prepare(
      'INSERT INTO accounts (id, user_id, account_code, account_name, account_type, parent_code) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(`acc-${uuidv4().slice(0, 8)}`, tenantId, code, name, type, parentCode).run();
    created[0]++;
  }
}

async function collectTransactionCodes(db: any, tenantId: string): Promise<string[]> {
  const codeSet = new Set<string>();

  // Collect from bank_transactions
  const btRows = await db.prepare(
    `SELECT DISTINCT account_code FROM bank_transactions WHERE user_id = ? AND account_code IS NOT NULL AND account_code != '' AND deleted_at IS NULL`
  ).bind(tenantId).all();
  for (const r of btRows.results as any[]) codeSet.add(r.account_code);

  // Collect from journal_lines
  const jlRows = await db.prepare(
    `SELECT DISTINCT jl.account_code FROM journal_lines jl
     JOIN journal_entries je ON jl.entry_id = je.id
     WHERE je.user_id = ? AND je.status != 'stale'`
  ).bind(tenantId).all();
  for (const r of jlRows.results as any[]) codeSet.add(r.account_code);

  // Also include hierarchy parents
  const fullSet = new Set(codeSet);
  for (const code of codeSet) {
    for (const parent of getParentCandidates(code)) {
      if (HK_COA_NAMES[parent]) fullSet.add(parent);
    }
  }

  // Add the 6 essential accounts if not already present
  const essentials = ['11101', '21201', '41101', '42101', '51101', '62303'];
  for (const e of essentials) fullSet.add(e);

  return Array.from(fullSet).filter(Boolean).sort();
}

// Audit log helper
async function auditLog(db: any, userId: string, action: string, entityType: string, entityId: string | null | undefined, changes?: object) {
  const id = `al-${uuidv4().slice(0, 8)}`;
  await db.prepare(
    'INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, changes) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, userId, action, entityType, entityId, changes ? JSON.stringify(changes) : null).run();
}

bookkeeping.get('/entries', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = (page - 1) * limit;
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');

  let query = `SELECT je.*, SUM(jl.debit) as total_debit, SUM(jl.credit) as total_credit
    FROM journal_entries je LEFT JOIN journal_lines jl ON je.id = jl.entry_id
    WHERE je.user_id = ? AND je.status != 'stale'`;
  const params: any[] = [tenantId];
  if (startDate) { query += ' AND je.entry_date >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND je.entry_date <= ?'; params.push(endDate); }
  query += ' GROUP BY je.id ORDER BY je.entry_date DESC, je.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all();
  return c.json({ data: rows.results, page, limit });
});

bookkeeping.get('/entries/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const entry = await db.prepare('SELECT * FROM journal_entries WHERE id = ? AND user_id = ?').bind(c.req.param('id'), tenantId).first();
  if (!entry) return c.json({ error: 'Entry not found' }, 404);
  const lines = await db.prepare('SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY sort_order').bind(c.req.param('id')).all();
  return c.json({ ...entry, lines: lines.results });
});

const lineSchema = z.object({
  account_code: z.string().min(1).max(20), account_name: z.string().min(1).max(200),
  description: z.string().max(500).optional(), debit: z.number().min(0).max(999999999).optional(), credit: z.number().min(0).max(999999999).optional(),
});

const entrySchema = z.object({
  entry_number: z.string().min(1).max(50), entry_date: z.string().max(10), description: z.string().min(1).max(500),
  reference_type: z.string().max(50).optional(), reference_id: z.string().max(50).optional(), lines: z.array(lineSchema).min(2).max(200),
});

bookkeeping.post('/entries', bookkeeperMiddleware, zValidator('json', entrySchema), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = `je-${uuidv4().slice(0, 8)}`;

  const totalDebit = data.lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = data.lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.001) return c.json({ error: 'Debits must equal credits' }, 400);

  // Validate all account codes exist in COA
  const codes = [...new Set(data.lines.map(l => l.account_code))];
  const existingAccounts = await db.prepare(
    `SELECT account_code FROM accounts WHERE user_id = ? AND is_active = 1 AND account_code IN (${codes.map(() => '?').join(',')})`
  ).bind(tenantId, ...codes).all();
  const existingCodes = new Set((existingAccounts.results as any[]).map(a => a.account_code));
  const missingCodes = codes.filter(c => !existingCodes.has(c));
  if (missingCodes.length > 0) {
    return c.json({ error: `Account code(s) not found: ${missingCodes.join(', ')}` }, 400);
  }

  if (!(await checkPeriodOpen(db, tenantId, data.entry_date)))
    return c.json({ error: 'Cannot create entry in a closed period' }, 400);

  await db.prepare(
    'INSERT INTO journal_entries (id, user_id, entry_number, entry_date, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, data.entry_number, data.entry_date, data.description, data.reference_type || null, data.reference_id || null).run();

  for (let i = 0; i < data.lines.length; i++) {
    const line = data.lines[i];
    await db.prepare(
      'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(`jl-${uuidv4().slice(0, 8)}`, id, line.account_code, line.account_name, line.description || null, line.debit || 0, line.credit || 0, i).run();
  }

  const entry = await db.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(id).first();
  const lines = await db.prepare('SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY sort_order').bind(id).all();
  await auditLog(db, user.id, 'create', 'journal_entry', id, { entry_number: data.entry_number, description: data.description, lines: data.lines.length });
  return c.json({ ...entry, lines: lines.results }, 201);
});

// Update entry status (draft → posted, etc.)
bookkeeping.patch('/entries/:id/status', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json();
  const { status } = body;
  if (!status || !['draft', 'posted', 'reconciled'].includes(status)) {
    return c.json({ error: 'status must be draft, posted, or reconciled' }, 400);
  }
  const entry = await db.prepare('SELECT * FROM journal_entries WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).first();
  if (!entry) return c.json({ error: 'Entry not found' }, 404);

  await db.prepare("UPDATE journal_entries SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .bind(status, c.req.param('id'), tenantId).run();
  await auditLog(db, user.id, 'update_status', 'journal_entry', c.req.param('id'), { status });
  return c.json({ success: true, status });
});

// Delete a journal entry (hard delete, cascades to journal_lines)
bookkeeping.delete('/entries/:id', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const id = c.req.param('id');

  const entry = await db.prepare('SELECT * FROM journal_entries WHERE id = ? AND user_id = ?')
    .bind(id, tenantId).first();
  if (!entry) return c.json({ error: 'Entry not found' }, 404);

  // Check if period is closed
  const closed = await db.prepare(
    "SELECT id FROM closed_periods WHERE user_id = ? AND ? >= period_start AND ? <= period_end"
  ).bind(tenantId, (entry as any).entry_date, (entry as any).entry_date).first();
  if (closed) return c.json({ error: 'Cannot delete entry in a closed period' }, 400);

  await db.prepare('DELETE FROM journal_entries WHERE id = ? AND user_id = ?')
    .bind(id, tenantId).run();
  await auditLog(db, user.id, 'delete', 'journal_entry', id, { entry_number: (entry as any).entry_number });
  return c.json({ success: true });
});

// Reverse a journal entry (creates opposite entry)
bookkeeping.post('/entries/:id/reverse', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const originalId = c.req.param('id');

  const entry = await db.prepare('SELECT * FROM journal_entries WHERE id = ? AND user_id = ?')
    .bind(originalId, tenantId).first<{ id: string; entry_number: string; entry_date: string; description: string; user_id: string }>();
  if (!entry) return c.json({ error: 'Entry not found' }, 404);

  const lines = await db.prepare('SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY sort_order')
    .bind(originalId).all();

  const revId = `je-${uuidv4().slice(0, 8)}`;
  const revNumber = `${entry.entry_number}-REV`;

  await db.prepare(
    'INSERT INTO journal_entries (id, user_id, entry_number, entry_date, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(revId, tenantId, revNumber, new Date().toISOString().split('T')[0],
    `Reversal: ${entry.description}`, 'journal', originalId).run();

  for (let i = 0; i < (lines.results as any[]).length; i++) {
    const line = (lines.results as any[])[i];
    await db.prepare(
      'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(`jl-${uuidv4().slice(0, 8)}`, revId, line.account_code, line.account_name,
      `Reversal: ${line.description || ''}`, line.credit, line.debit, i).run();
  }

  const revEntry = await db.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(revId).first();
  const revLines = await db.prepare('SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY sort_order').bind(revId).all();
  await auditLog(db, user.id, 'reverse', 'journal_entry', originalId, { reversal_id: revId, reversal_number: revNumber });
  return c.json({ ...revEntry, lines: revLines.results }, 201);
});

bookkeeping.get('/accounts', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const asOf = c.req.query('as_of');

  const rows = await db.prepare('SELECT * FROM accounts WHERE user_id = ? AND is_active = 1 ORDER BY account_code').bind(tenantId).all();

  // Compute current_balance for each account if as_of is provided
  if (asOf) {
    const balanceRows = await db.prepare(
      `SELECT jl.account_code,
              COALESCE(SUM(jl.debit), 0) as total_debit,
              COALESCE(SUM(jl.credit), 0) as total_credit
       FROM journal_lines jl
       JOIN journal_entries je ON jl.entry_id = je.id
       WHERE je.user_id = ? AND je.entry_date <= ? AND je.status != 'stale'
       GROUP BY jl.account_code`
    ).bind(tenantId, asOf).all();
    const balanceMap = new Map<string, { debit: number; credit: number }>();
    for (const r of balanceRows.results as any[]) {
      balanceMap.set(r.account_code, { debit: r.total_debit, credit: r.total_credit });
    }

    const data = (rows.results as any[]).map(a => {
      const b = balanceMap.get(a.account_code);
      const opening = a.opening_balance || 0;
      const debit = b?.debit || 0;
      const credit = b?.credit || 0;
      const code = a.account_code || '';
      const name = (a.account_name || '').toLowerCase();
      const isContra = code.startsWith('123') || name.includes('accumulated depreciation')
        || name.includes('累計折舊') || name.includes('allowance') || name.includes('減值');
      const isDebitNatural = !isContra && (a.account_type === 'asset' || a.account_type === 'expense');
      const currentBalance = isDebitNatural ? opening + debit - credit : opening + credit - debit;
      return { ...a, total_debit: debit, total_credit: credit, current_balance: Math.round(currentBalance * 100) / 100 };
    });
    return c.json({ data, as_of: asOf });
  }

  return c.json({ data: rows.results });
});

// Search accounts by code or name
bookkeeping.get('/accounts/search', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const q = c.req.query('q') || '';
  if (!q || q.length < 1) return c.json({ data: [] });
  const rows = await c.env.DB.prepare(
    `SELECT * FROM accounts WHERE user_id = ? AND is_active = 1
     AND (account_code LIKE ? OR account_name LIKE ?)
     ORDER BY account_code LIMIT 20`
  ).bind(tenantId, `%${q}%`, `%${q}%`).all();
  return c.json({ data: rows.results });
});

// Seed COA with HK industry template
bookkeeping.post('/accounts/seed', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;

  // HK 5-digit COA template: [code, name, type, parentCode]
  const template: [string, string, string, string | null][] = [
    // Assets
    ['10000', '資產 Assets', 'asset', null],
    ['11000', '流動資產 Current Assets', 'asset', '10000'],
    ['12000', '固定資產 Fixed Assets', 'asset', '10000'],
    ['11100', '現金及銀行存款 Cash & Bank', 'asset', '11000'],
    ['11200', '應收賬款及票據 AR & Notes', 'asset', '11000'],
    ['11300', '其他應收款 Other Receivables', 'asset', '11000'],
    ['11400', '預付及按金 Prepayments & Deposits', 'asset', '11000'],
    ['12100', '物業房產 Property', 'asset', '12000'],
    ['12200', '設備及器材 Equipment', 'asset', '12000'],
    ['12300', '累計折舊 Accumulated Depreciation', 'asset', '12000'],
    ['11101', '庫存現金 Cash on Hand', 'asset', '11100'],
    ['11102', '匯豐銀行 HSBC', 'asset', '11100'],
    ['11103', '其他銀行 Other Bank', 'asset', '11100'],
    ['11201', '應收賬款 Trade Debtors', 'asset', '11200'],
    ['11301', '應收董事款項 Director Loan to Co', 'asset', '11300'],
    ['11302', '暫付款 Sundry Debtors', 'asset', '11300'],
    ['11401', '預付費用 Prepayments', 'asset', '11400'],
    ['11402', '租金按金 Rental Deposit', 'asset', '11400'],
    ['11403', '其他按金 Other Deposits', 'asset', '11400'],
    ['12201', '辦公設備 Office Equipment', 'asset', '12200'],
    ['12202', '電腦設備 Computer Equipment', 'asset', '12200'],
    ['12203', '汽車 Vehicles', 'asset', '12200'],
    ['12301', '累計折舊-設備 Accumulated Depn-Equip', 'asset', '12300'],
    ['12302', '累計折舊-電腦 Accumulated Depn-Computer', 'asset', '12300'],
    // Liabilities
    ['20000', '負債 Liabilities', 'liability', null],
    ['21000', '流動負債 Current Liabilities', 'liability', '20000'],
    ['22000', '長期負債 Long-term Liabilities', 'liability', '20000'],
    ['21100', '應付賬款及票據 AP & Notes', 'liability', '21000'],
    ['21200', '其他應付款 Other Payables', 'liability', '21000'],
    ['21300', '應付稅項 Tax Payable', 'liability', '21000'],
    ['21400', '預收及應計 Accruals & Deferred', 'liability', '21000'],
    ['21101', '應付賬款 Trade Creditors', 'liability', '21100'],
    ['21201', '應付董事款項 Director Loan from Dir', 'liability', '21200'],
    ['21202', '暫收款 Sundry Creditors', 'liability', '21200'],
    ['21203', '應付薪金 Salary Payable', 'liability', '21200'],
    ['21204', '應付強積金 MPF Payable', 'liability', '21200'],
    ['21301', '應付利得稅 Profits Tax Payable', 'liability', '21300'],
    ['21401', '預收收入 Deferred Revenue', 'liability', '21400'],
    ['21402', '應計費用 Accrued Expenses', 'liability', '21400'],
    // Equity
    ['30000', '資本及儲備 Equity & Reserves', 'equity', null],
    ['31000', '股本及往來 Share Capital & Current', 'equity', '30000'],
    ['32000', '儲備及損益 Reserves & P&L', 'equity', '30000'],
    ['31100', '股本 Share Capital', 'equity', '31000'],
    ['31200', '董事往來 Director Current Account', 'equity', '31000'],
    ['32100', '留存盈利 Retained Earnings', 'equity', '32000'],
    ['32200', '本年損益 Current Year P&L', 'equity', '32000'],
    ['31101', '普通股本 Ordinary Shares', 'equity', '31100'],
    ['31201', '董事往來-往來帳 Director Current A/C', 'equity', '31200'],
    ['31202', '董事酬金 Director Remuneration', 'equity', '31200'],
    ['32101', '上年度保留盈利 Retained Earnings b/f', 'equity', '32100'],
    // Revenue
    ['40000', '收入 Revenue', 'revenue', null],
    ['41000', '營業收入 Operating Revenue', 'revenue', '40000'],
    ['42000', '其他收益 Other Income', 'revenue', '40000'],
    ['41100', '服務收入 Service Income', 'revenue', '41000'],
    ['41200', '銷售收入 Sales Revenue', 'revenue', '41000'],
    ['41300', '顧問收入 Consulting Income', 'revenue', '41000'],
    ['42100', '利息及投資收入 Interest & Investment', 'revenue', '42000'],
    ['42200', '非經常性收入 Non-recurring Income', 'revenue', '42000'],
    ['41101', '專業服務收入 Professional Services', 'revenue', '41100'],
    ['41102', '技術服務收入 Technical Services', 'revenue', '41100'],
    ['42101', '銀行利息收入 Bank Interest', 'revenue', '42100'],
    ['42201', '政府補貼 Government Subsidy', 'revenue', '42200'],
    ['42202', '匯兌收益 Exchange Gain', 'revenue', '42200'],
    // Direct Costs
    ['50000', '直接成本 Direct Costs', 'expense', null],
    ['51000', '服務成本 Cost of Services', 'expense', '50000'],
    ['52000', '銷售成本 Cost of Sales', 'expense', '50000'],
    ['51100', '外判及顧問費 Subcontractor & Consultant', 'expense', '51000'],
    ['51200', '直接人工 Direct Labour', 'expense', '51000'],
    ['51101', '外判工作費用 Subcontractor Fees', 'expense', '51100'],
    ['51102', '專業顧問費 Professional Consultant', 'expense', '51100'],
    ['51201', '項目人員薪酬 Project Staff Salary', 'expense', '51200'],
    // Operating Expenses
    ['60000', '營運支出 Operating Expenses', 'expense', null],
    ['61000', '員工支出 Staff Costs', 'expense', '60000'],
    ['62000', '辦公室支出 Office Costs', 'expense', '60000'],
    ['63000', '專業及合規 Professional & Compliance', 'expense', '60000'],
    ['64000', '銷售及推廣 Sales & Marketing', 'expense', '60000'],
    ['65000', '財務及銀行 Finance & Banking', 'expense', '60000'],
    ['66000', '其他營運支出 Other Operating', 'expense', '60000'],
    ['61100', '董事及管理層 Director & Management', 'expense', '61000'],
    ['61101', '董事袍金 Director Fee', 'expense', '61100'],
    ['61102', '管理層薪金 Management Salary', 'expense', '61100'],
    ['61200', '員工薪酬 Staff Remuneration', 'expense', '61000'],
    ['61201', '員工薪金 Staff Salaries', 'expense', '61200'],
    ['61202', '強積金僱主供款 MPF Employer Contribution', 'expense', '61200'],
    ['61203', '員工福利 Staff Benefits', 'expense', '61200'],
    ['62100', '租金 Rent', 'expense', '62000'],
    ['62101', '辦公室租金 Office Rent', 'expense', '62100'],
    ['62102', '差餉及管理費 Rates & Management', 'expense', '62100'],
    ['62200', '水電煤 Utilities', 'expense', '62000'],
    ['62201', '電費 Electricity', 'expense', '62200'],
    ['62202', '水費 Water', 'expense', '62200'],
    ['62300', '電訊及科技 Telecom & IT', 'expense', '62000'],
    ['62301', '電話及上網 Phone & Internet', 'expense', '62300'],
    ['62302', '網站寄存及域名 Web Hosting & Domain', 'expense', '62300'],
    ['62303', '軟件訂閱費 Software Subscriptions', 'expense', '62300'],
    ['62400', '辦公雜項 Office Miscellaneous', 'expense', '62000'],
    ['62401', '文具及印刷 Stationery & Printing', 'expense', '62400'],
    ['62402', '茶水及清潔 Pantry & Cleaning', 'expense', '62400'],
    ['63100', '專業服務 Professional Services', 'expense', '63000'],
    ['63101', '審計費用 Audit Fee', 'expense', '63100'],
    ['63102', '公司秘書費 Company Secretary Fee', 'expense', '63100'],
    ['63103', '法律顧問費 Legal Fee', 'expense', '63100'],
    ['63200', '政府規費 Government Fees', 'expense', '63000'],
    ['63201', '商業登記費 BR Renewal Fee', 'expense', '63200'],
    ['63202', '公司周年申報費 Annual Return Fee', 'expense', '63200'],
    ['63300', '保險 Insurance', 'expense', '63000'],
    ['63301', '勞工保險 EC Insurance', 'expense', '63300'],
    ['63302', '專業責任保險 Professional Indemnity', 'expense', '63300'],
    ['64100', '市場推廣 Marketing', 'expense', '64000'],
    ['64101', '廣告費用 Advertising', 'expense', '64100'],
    ['64102', '網站推廣 Website Promotion', 'expense', '64100'],
    ['64200', '業務拓展 Business Development', 'expense', '64000'],
    ['64201', '佣金支出 Commission Expense', 'expense', '64200'],
    ['64202', '交際應酬費 Entertainment', 'expense', '64200'],
    ['64300', '差旅交通 Travel & Transport', 'expense', '64000'],
    ['64301', '本地交通 Local Transport', 'expense', '64300'],
    ['64302', '海外差旅 Overseas Travel', 'expense', '64300'],
    ['65100', '銀行費用 Bank Charges', 'expense', '65000'],
    ['65101', '銀行手續費 Bank Service Fee', 'expense', '65100'],
    ['65102', '貸款利息 Loan Interest', 'expense', '65100'],
    ['65200', '匯兌差額 Exchange Difference', 'expense', '65000'],
    ['65201', '匯兌損失 Exchange Loss', 'expense', '65200'],
    ['66100', '折舊 Depreciation', 'expense', '66000'],
    ['66101', '折舊-設備 Depreciation-Equipment', 'expense', '66100'],
    ['66102', '折舊-電腦 Depreciation-Computer', 'expense', '66100'],
    ['66200', '雜項支出 Sundry Expenses', 'expense', '66000'],
    ['66201', '罰款及附加費 Penalties & Surcharges', 'expense', '66200'],
    ['66202', '捐款 Donations', 'expense', '66200'],
    ['66203', '其他雜項 Miscellaneous', 'expense', '66200'],
    // Profits Tax
    ['80000', '利得稅 Profits Tax', 'expense', null],
    ['81100', '香港利得稅 HK Profits Tax', 'expense', '80000'],
    ['81101', '本年度利得稅 Current Year Profits Tax', 'expense', '81100'],
    ['81102', '遞延稅項 Deferred Tax', 'expense', '81100'],
  ];

  let created = 0;
  for (const [code, name, type, parentCode] of template) {
    const id = `acc-${uuidv4().slice(0, 8)}`;
    await db.prepare(
      'INSERT OR IGNORE INTO accounts (id, user_id, account_code, account_name, account_type, parent_code) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, tenantId, code, name, type, parentCode).run();
    created++;
  }

  await auditLog(db, user.id, 'seed_coa', 'account', null, { template: 'hk-5digit', accounts_created: created });
  return c.json({ success: true, accounts_created: created }, 201);
});

// GET /accounts/missing-codes — detect transaction codes not yet in COA
bookkeeping.get('/accounts/missing-codes', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;

  const codes = await collectTransactionCodes(db, tenantId);
  const existingRows = await db.prepare(
    `SELECT account_code FROM accounts WHERE user_id = ? AND is_active = 1`
  ).bind(tenantId).all();
  const existingSet = new Set((existingRows.results as any[]).map(r => r.account_code));
  const missing = codes.filter(c => !existingSet.has(c)).map(code => ({
    code,
    name: HK_COA_NAMES[code]?.name || null,
    type: HK_COA_NAMES[code]?.type || getCodeType(code),
  }));
  return c.json({ missing, total_existing: existingSet.size, total_expected: codes.length });
});

// Create a single account manually
const createAccountSchema = z.object({
  account_code: z.string().min(1).max(20),
  account_name: z.string().min(1).max(200),
  account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  parent_code: z.string().max(20).optional(),
  opening_balance: z.number().optional(),
});

bookkeeping.post('/accounts', bookkeeperMiddleware, zValidator('json', createAccountSchema), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const data = c.req.valid('json');

  // Check for duplicate code
  const existing = await db.prepare('SELECT id FROM accounts WHERE user_id = ? AND account_code = ?')
    .bind(tenantId, data.account_code).first();
  if (existing) return c.json({ error: 'Account code already exists' }, 409);

  const id = `acc-${uuidv4().slice(0, 8)}`;
  await db.prepare(
    'INSERT INTO accounts (id, user_id, account_code, account_name, account_type, parent_code, opening_balance) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, data.account_code, data.account_name, data.account_type, data.parent_code || null, data.opening_balance || 0).run();

  await auditLog(db, user.id, 'create', 'account', data.account_code, { account_name: data.account_name, account_type: data.account_type });
  const account = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first();
  return c.json(account, 201);
});

// Get transaction history for a specific account with running balance
bookkeeping.get('/accounts/:code/transactions', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const code = c.req.param('code');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');

  // Get account info
  const account = await db.prepare('SELECT * FROM accounts WHERE user_id = ? AND account_code = ?')
    .bind(tenantId, code).first();
  if (!account) return c.json({ error: 'Account not found' }, 404);

  const sDate = startDate || '2000-01-01';
  const eDate = endDate || '2099-12-31';

  // Get journal lines for this account
  const rows = await db.prepare(
    `SELECT jl.account_code, jl.account_name, jl.description as line_description,
            jl.debit, jl.credit, jl.sort_order,
            je.entry_date, je.description as entry_description, je.entry_number,
            je.reference_type, je.reference_id, je.id as entry_id
     FROM journal_lines jl
     JOIN journal_entries je ON jl.entry_id = je.id
     WHERE jl.account_code = ? AND je.user_id = ?
       AND je.entry_date >= ? AND je.entry_date <= ?
       AND je.status != 'stale'
     ORDER BY je.entry_date, jl.sort_order`
  ).bind(code, tenantId, sDate, eDate).all();

  const opening = (account as any).opening_balance || 0;
  const acctCode = (account as any).account_code || '';
  const acctName = ((account as any).account_name || '').toLowerCase();
  const isContra = acctCode.startsWith('123') || acctName.includes('accumulated depreciation')
    || acctName.includes('累計折舊') || acctName.includes('allowance') || acctName.includes('減值');
  const isDebitNatural = !isContra && ((account as any).account_type === 'asset' || (account as any).account_type === 'expense');

  const transactions: any[] = [];
  let runningBalance = opening;
  for (const r of rows.results as any[]) {
    const change = isDebitNatural ? (r.debit - r.credit) : (r.credit - r.debit);
    runningBalance += change;
    transactions.push({
      entry_date: r.entry_date,
      description: r.line_description || r.entry_description,
      debit: r.debit,
      credit: r.credit,
      running_balance: Math.round(runningBalance * 100) / 100,
      entry_number: r.entry_number,
      reference_type: r.reference_type,
      reference_id: r.reference_id,
      entry_id: r.entry_id,
    });
  }

  return c.json({
    account: { ...account, opening_balance: opening },
    transactions,
    period: { start: sDate, end: eDate },
  });
});

// PATCH opening balance for an account
bookkeeping.patch('/accounts/:code', authMiddleware, bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const code = c.req.param('code');
  const body = await c.req.json();
  const { opening_balance } = body;
  if (opening_balance === undefined) return c.json({ error: 'opening_balance required' }, 400);
  await c.env.DB.prepare('UPDATE accounts SET opening_balance = ? WHERE user_id = ? AND account_code = ?')
    .bind(opening_balance, tenantId, code).run();
  await auditLog(c.env.DB, user.id, 'update', 'account', code, { opening_balance });
  return c.json({ success: true });
});

// GET/PATCH fiscal period
bookkeeping.get('/fiscal-period', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const row = await c.env.DB.prepare('SELECT fiscal_year_start, fiscal_year_end FROM company_settings WHERE user_id = ?')
    .bind(tenantId).first<{ fiscal_year_start: string; fiscal_year_end: string }>();
  return c.json({ fiscal_year_start: row?.fiscal_year_start || null, fiscal_year_end: row?.fiscal_year_end || '03-31' });
});

bookkeeping.patch('/fiscal-period', authMiddleware, bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const body = await c.req.json();
  const sets: string[] = [];
  const params: any[] = [];
  if (body.fiscal_year_start) { sets.push('fiscal_year_start = ?'); params.push(body.fiscal_year_start); }
  if (body.fiscal_year_end) { sets.push('fiscal_year_end = ?'); params.push(body.fiscal_year_end); }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(tenantId);
  await c.env.DB.prepare(`UPDATE company_settings SET ${sets.join(', ')} WHERE user_id = ?`).bind(...params).run();
  return c.json({ success: true });
});

// Close an accounting period (prevent further modifications)
bookkeeping.post('/close-period', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json();
  const { period_start, period_end, notes } = body;
  if (!period_start || !period_end) return c.json({ error: 'period_start and period_end required' }, 400);

  const id = `cp-${uuidv4().slice(0, 8)}`;
  await db.prepare(
    'INSERT INTO closed_periods (id, user_id, period_start, period_end, closed_by, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, period_start, period_end, user.id, notes || null).run();

  await auditLog(db, user.id, 'close_period', 'accounting_period', id, { period_start, period_end });
  return c.json({ id, period_start, period_end, closed: true }, 201);
});

// Reopen a closed period
bookkeeping.delete('/close-period/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;

  const period = await db.prepare('SELECT * FROM closed_periods WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).first();
  if (!period) return c.json({ error: 'Closed period not found' }, 404);

  await db.prepare('DELETE FROM closed_periods WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).run();
  return c.json({ success: true });
});

// List closed periods
bookkeeping.get('/closed-periods', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const rows = await c.env.DB.prepare(
    'SELECT * FROM closed_periods WHERE user_id = ? ORDER BY period_start DESC'
  ).bind(tenantId).all();
  return c.json({ data: rows.results });
});

// Middleware-style check: prevent mutation on closed periods (called by mutation endpoints)
async function checkPeriodOpen(db: any, tenantId: string, entryDate: string): Promise<boolean> {
  const closed = await db.prepare(
    'SELECT id FROM closed_periods WHERE user_id = ? AND ? >= period_start AND ? <= period_end LIMIT 1'
  ).bind(tenantId, entryDate, entryDate).first();
  return !closed;
}

bookkeeping.get('/trial-balance', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const asOf = c.req.query('as_of') || new Date().toISOString().split('T')[0];

  // Get journal line totals
  const rows = await db.prepare(
    `SELECT jl.account_code, jl.account_name, a.account_type, a.opening_balance, SUM(jl.debit) as total_debit, SUM(jl.credit) as total_credit
     FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
     LEFT JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date <= ? AND je.status != 'stale' GROUP BY jl.account_code, jl.account_name ORDER BY jl.account_code`
  ).bind(tenantId, asOf).all();

  // Compute ending balances: opening + debit - credit (for assets/expenses) or opening + credit - debit (for liabilities/equity/revenue)
  // Contra-asset accounts (accumulated depreciation, allowances) are credit-normal
  const data = (rows.results as any[]).map(row => {
    const opening = row.opening_balance || 0;
    const type = (row.account_type || '').toLowerCase();
    const code = row.account_code || '';
    const name = (row.account_name || '').toLowerCase();
    const isContra = code.startsWith('123') || name.includes('accumulated depreciation')
      || name.includes('累計折舊') || name.includes('allowance') || name.includes('減值');
    const isDebitNatural = !isContra && (type === 'asset' || type === 'expense');
    const ending = isDebitNatural
      ? opening + row.total_debit - row.total_credit
      : opening + row.total_credit - row.total_debit;
    return { ...row, opening_balance: opening, ending_balance: ending };
  });

  // If journal entries exist, return them; otherwise fallback to bank transactions for consistency
  if (data.length > 0) {
    return c.json({ data, as_of: asOf, source: 'journal' });
  }

  // Fallback: build trial balance from bank transactions grouped by account_code
  const btRows = await db.prepare(
    `SELECT COALESCE(account_code, 'UNCAT') as account_code,
     'Uncategorized' as account_name, '' as account_type, 0 as opening_balance,
     SUM(deposit_amount) as total_debit, SUM(withdrawal_amount) as total_credit
     FROM bank_transactions WHERE user_id = ? AND transaction_date <= ? AND deleted_at IS NULL
     GROUP BY COALESCE(account_code, 'UNCAT') ORDER BY account_code`
  ).bind(tenantId, asOf).all();

  const btData = (btRows.results as any[]).map(row => ({
    ...row,
    ending_balance: (row.total_debit || 0) - (row.total_credit || 0),
    account_name: row.account_code === 'UNCAT' ? '未分類交易 Uncategorized' : row.account_name,
  }));

  return c.json({ data: btData, as_of: asOf, source: 'bank' });
});

bookkeeping.get('/export', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const startDate = c.req.query('start_date') || '2000-01-01';
  const endDate = c.req.query('end_date') || '2099-12-31';
  const format = c.req.query('format') || 'json';

  const entries = await db.prepare(
    `SELECT je.*, jl.account_code, jl.account_name, jl.description as line_description, jl.debit, jl.credit
     FROM journal_entries je JOIN journal_lines jl ON je.id = jl.entry_id
     WHERE je.user_id = ? AND je.entry_date >= ? AND je.entry_date <= ? AND je.status != 'stale'
     ORDER BY je.entry_date, je.entry_number, jl.sort_order`
  ).bind(tenantId, startDate, endDate).all();

  if (format === 'csv') {
    const esc = (v: any) => `"${String(v || '').replace(/"/g, '""')}"`;
    let csv = 'Entry Date,Entry Number,Description,Account Code,Account Name,Line Description,Debit,Credit\n';
    for (const row of entries.results as any[]) {
      csv += `${esc(row.entry_date)},${esc(row.entry_number)},${esc(row.description)},${esc(row.account_code)},${esc(row.account_name)},${esc(row.line_description)},${row.debit},${row.credit}\n`;
    }
    return c.text(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=bookkeeping-export.csv' });
  }
  return c.json({ data: entries.results, period: { start: startDate, end: endDate } });
});

bookkeeping.get('/income-statement', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const startDate = c.req.query('start_date') || '2000-01-01';
  const endDate = c.req.query('end_date') || new Date().toISOString().split('T')[0];

  // Use account_type from COA to classify revenue and expenses
  const revenue = await db.prepare(
    `SELECT COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as amount FROM journal_lines jl
     JOIN journal_entries je ON jl.entry_id = je.id
     JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date >= ? AND je.entry_date <= ? AND a.account_type = 'revenue' AND je.status != 'stale'`
  ).bind(tenantId, startDate, endDate).first<{ amount: number }>();

  const expenses = await db.prepare(
    `SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as amount FROM journal_lines jl
     JOIN journal_entries je ON jl.entry_id = je.id
     JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date >= ? AND je.entry_date <= ? AND a.account_type = 'expense' AND je.status != 'stale'`
  ).bind(tenantId, startDate, endDate).first<{ amount: number }>();

  // If journal entries exist, use them
  if ((revenue?.amount || 0) > 0 || (expenses?.amount || 0) > 0) {
    const netIncome = (revenue?.amount || 0) - (expenses?.amount || 0);
    return c.json({ revenue: revenue?.amount || 0, expenses: expenses?.amount || 0, net_income: netIncome, source: 'journal', period: { start: startDate, end: endDate } });
  }

  // Fallback: use bank transactions with account_code categorization
  // Revenue: 4xxxx codes, plus uncategorized deposits that look like client payments
  const bankRevenue = await db.prepare(
    `SELECT COALESCE(SUM(deposit_amount), 0) as amount FROM bank_transactions
     WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ? AND deleted_at IS NULL
     AND (account_code LIKE '4%' OR (account_code IS NULL AND deposit_amount > 0
       AND description NOT LIKE '%LOAN REPAYMENT%'
       AND description NOT LIKE '%B/F%'
       AND description NOT LIKE '%TRANSFER%FROM%'))
     AND NOT (account_code LIKE '3%' OR account_code LIKE '1%' OR account_code LIKE '2%')`
  ).bind(tenantId, startDate, endDate).first<{ amount: number }>();

  // Expenses: 5xxxx/6xxxx/8xxxx codes, plus uncategorized withdrawals
  const bankExpenses = await db.prepare(
    `SELECT COALESCE(SUM(withdrawal_amount), 0) as amount FROM bank_transactions
     WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ? AND deleted_at IS NULL
     AND (account_code LIKE '5%' OR account_code LIKE '6%' OR account_code LIKE '8%' OR (account_code IS NULL AND withdrawal_amount > 0
       AND description NOT LIKE '%LOAN REPAYMENT%'
       AND description NOT LIKE '%TD DESIGNATED%'
       AND description NOT LIKE '%轉賬支出%'))
     AND NOT (account_code LIKE '3%' OR account_code LIKE '1%' OR account_code LIKE '2%')`
  ).bind(tenantId, startDate, endDate).first<{ amount: number }>();

  // Also count categorized separately for transparency
  const catRevenue = await db.prepare(
    `SELECT COALESCE(SUM(deposit_amount), 0) as amount FROM bank_transactions
     WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ? AND account_code LIKE '4%' AND deleted_at IS NULL`
  ).bind(tenantId, startDate, endDate).first<{ amount: number }>();

  const catExpenses = await db.prepare(
    `SELECT COALESCE(SUM(withdrawal_amount), 0) as amount FROM bank_transactions
     WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ? AND (account_code LIKE '5%' OR account_code LIKE '6%' OR account_code LIKE '8%') AND deleted_at IS NULL`
  ).bind(tenantId, startDate, endDate).first<{ amount: number }>();

  const uncategorized = await db.prepare(
    `SELECT COUNT(*) as cnt, COALESCE(SUM(withdrawal_amount),0) as wit, COALESCE(SUM(deposit_amount),0) as dep
     FROM bank_transactions WHERE user_id = ? AND account_code IS NULL AND deleted_at IS NULL`
  ).bind(tenantId).first<{ cnt: number; wit: number; dep: number }>();

  const netIncome = (bankRevenue?.amount || 0) - (bankExpenses?.amount || 0);
  return c.json({
    revenue: bankRevenue?.amount || 0,
    expenses: bankExpenses?.amount || 0,
    net_income: netIncome,
    source: 'bank',
    breakdown: {
      categorized_revenue: catRevenue?.amount || 0,
      categorized_expenses: catExpenses?.amount || 0,
      uncategorized_count: uncategorized?.cnt || 0,
      uncategorized_deposits: uncategorized?.dep || 0,
      uncategorized_withdrawals: uncategorized?.wit || 0,
    },
    period: { start: startDate, end: endDate },
  });
});

// Balance Sheet — Assets, Liabilities, and Equity as of a date
bookkeeping.get('/balance-sheet', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const asOf = c.req.query('as_of') || new Date().toISOString().split('T')[0];

  // Get all journal lines up to as_of date
  const rows = await db.prepare(
    `SELECT jl.account_code, jl.account_name, a.account_type, SUM(jl.debit) as total_debit, SUM(jl.credit) as total_credit
     FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
     LEFT JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date <= ? AND je.status != 'stale'
     GROUP BY jl.account_code, jl.account_name
     ORDER BY jl.account_code`
  ).bind(tenantId, asOf).all();

  const jeCount = await db.prepare(
    "SELECT COUNT(*) as cnt FROM journal_entries WHERE user_id = ? AND entry_date <= ? AND status != 'stale'"
  ).bind(tenantId, asOf).first<{ cnt: number }>();

  if ((jeCount?.cnt || 0) > 0 && (rows.results || []).length > 0) {
    // Calculate balances: Assets/Expenses = debit - credit, Liabilities/Equity/Revenue = credit - debit
    const isContraAsset = (row: any) => {
      const code = row.account_code || '';
      const name = (row.account_name || '').toLowerCase();
      return code.startsWith('123') || name.includes('accumulated depreciation')
        || name.includes('累計折舊') || name.includes('allowance')
        || name.includes('減值') || name.includes('呆帳');
    };

    const calcBalance = (row: any) => {
      const type = (row.account_type || '').toLowerCase();
      const code = (row.account_code || '');
      // Contra-asset accounts (accumulated depreciation, allowances): credit balance
      if (isContraAsset(row)) {
        return row.total_credit - row.total_debit;
      }
      // Assets (1xxx) and Expenses (5xxx/6xxx/8xxx): debit balance
      if (type === 'asset' || type === 'expense' || code.startsWith('1') || code.startsWith('5') || code.startsWith('6') || code.startsWith('8')) {
        return row.total_debit - row.total_credit;
      }
      // Liabilities (2xxx), Equity (3xxx), Revenue (4xxx): credit balance
      return row.total_credit - row.total_debit;
    };

    const assets: { code: string; name: string; balance: number }[] = [];
    const liabilities: { code: string; name: string; balance: number }[] = [];
    const equity: { code: string; name: string; balance: number }[] = [];
    let totalRevenue = 0;
    let totalExpenses = 0;

    // Get opening balances for balance sheet accounts
    const openingRows = await db.prepare(
      "SELECT account_code, account_name, account_type, COALESCE(opening_balance, 0) as opening_balance FROM accounts WHERE user_id = ? AND is_active = 1"
    ).bind(tenantId).all();

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
      } else if (row.account_code?.startsWith('5') || row.account_code?.startsWith('6') || row.account_code?.startsWith('8') || accountType === 'expense') {
        totalExpenses += balance;
      }
    }

    // Add opening balances to assets, liabilities, and equity
    for (const row of openingRows.results as any[]) {
      if (!row.opening_balance || row.opening_balance === 0) continue;
      const type = (row.account_type || '').toLowerCase();
      const code = row.account_code || '';
      // Only apply opening balances to balance sheet accounts (not P&L)
      if (code.startsWith('1') || type === 'asset') {
        const existing = assets.find(a => a.code === code);
        if (existing) existing.balance += row.opening_balance;
        else assets.push({ code, name: row.account_name, balance: row.opening_balance });
      } else if (code.startsWith('2') || type === 'liability') {
        const existing = liabilities.find(l => l.code === code);
        if (existing) existing.balance += row.opening_balance;
        else liabilities.push({ code, name: row.account_name, balance: row.opening_balance });
      } else if (code.startsWith('3') || type === 'equity') {
        const existing = equity.find(e => e.code === code);
        if (existing) existing.balance += row.opening_balance;
        else equity.push({ code, name: row.account_name, balance: row.opening_balance });
      }
    }

    const currentYearPL = totalRevenue - totalExpenses;
    if (Math.abs(currentYearPL) > 0.01) {
      equity.push({ code: '32200', name: 'Current Year P&L (本年度損益)', balance: currentYearPL });
    }

    const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0);
    const totalEquity = equity.reduce((s, e) => s + e.balance, 0);

    return c.json({
      assets, liabilities, equity,
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
      total_equity: totalEquity,
      current_year_pl: currentYearPL,
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      check: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      as_of: asOf,
      source: 'journal',
    });
  }

  // Fallback: estimate from bank transactions
  const bankDeposits = await db.prepare(
    `SELECT COALESCE(SUM(deposit_amount), 0) as amount FROM bank_transactions WHERE user_id = ? AND transaction_date <= ? AND deleted_at IS NULL`
  ).bind(tenantId, asOf).first<{ amount: number }>();
  const bankWithdrawals = await db.prepare(
    `SELECT COALESCE(SUM(withdrawal_amount), 0) as amount FROM bank_transactions WHERE user_id = ? AND transaction_date <= ? AND deleted_at IS NULL`
  ).bind(tenantId, asOf).first<{ amount: number }>();

  const cashBalance = (bankDeposits?.amount || 0) - (bankWithdrawals?.amount || 0);
  const netCash = Math.max(cashBalance, 0);
  const netDeficit = Math.max(-cashBalance, 0);

  return c.json({
    assets: [
      { code: '11101', name: 'Cash (銀行現金估算)', balance: netCash },
    ],
    liabilities: netDeficit > 0.01 ? [
      { code: '21201', name: 'Director Loan (估算)', balance: netDeficit },
    ] : [],
    equity: [
      { code: '3xxx', name: 'Retained Earnings (估算)', balance: netCash - netDeficit },
    ],
    total_assets: netCash,
    total_liabilities: netDeficit,
    total_equity: netCash - netDeficit,
    current_year_pl: netCash - netDeficit,
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
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const startDate = c.req.query('start_date') || '2000-01-01';
  const endDate = c.req.query('end_date') || '2099-12-31';
  const filterAccount = c.req.query('account_code');

  // Check if journal entries exist
  const jeCount = await db.prepare(
    "SELECT COUNT(*) as cnt FROM journal_entries WHERE user_id = ? AND entry_date >= ? AND entry_date <= ? AND status != 'stale'"
  ).bind(tenantId, startDate, endDate).first<{ cnt: number }>();

  if ((jeCount?.cnt || 0) > 0) {
    // Use journal entries
    let query = `SELECT jl.account_code, jl.account_name, a.account_type, je.entry_date as date, je.description, jl.debit, jl.credit
      FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
      LEFT JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
      WHERE je.user_id = ? AND je.entry_date >= ? AND je.entry_date <= ? AND je.status != 'stale'`;
    const params: any[] = [tenantId, startDate, endDate];
    if (filterAccount) { query += ' AND jl.account_code LIKE ?'; params.push(`${filterAccount}%`); }
    query += ' ORDER BY jl.account_code, je.entry_date, jl.sort_order';
    const rows = await db.prepare(query).bind(...params).all();

    // Pre-load opening balances for all accounts
    const openingBalances = await db.prepare(
      'SELECT account_code, COALESCE(opening_balance, 0) as ob FROM accounts WHERE user_id = ? AND is_active = 1'
    ).bind(tenantId).all();
    const obMap = new Map<string, number>();
    for (const row of openingBalances.results as any[]) { obMap.set(row.account_code, row.ob); }

    // Group by account and compute running balances (starting from opening_balance)
    const groups: Record<string, { account_code: string; account_name: string; account_type: string; opening_balance: number; entries: any[]; total_debit: number; total_credit: number }> = {};
    for (const row of rows.results as any[]) {
      const key = row.account_code;
      if (!groups[key]) {
        const ob = obMap.get(row.account_code) || 0;
        groups[key] = { account_code: row.account_code, account_name: row.account_name, account_type: row.account_type || '', opening_balance: ob, entries: [], total_debit: 0, total_credit: 0 };
      }
      const g = groups[key];
      const lastBalance = g.entries.length > 0 ? g.entries[g.entries.length - 1].balance : g.opening_balance;
      // Assets/Expenses: debit increases, credit decreases. Liabilities/Equity/Revenue: opposite.
      const isDebitNatural = row.account_type === 'asset' || row.account_type === 'expense';
      const change = isDebitNatural ? (row.debit - row.credit) : (row.credit - row.debit);
      const balance = lastBalance + change;
      g.entries.push({ date: row.date, description: row.description, debit: row.debit, credit: row.credit, balance });
      g.total_debit += row.debit;
      g.total_credit += row.credit;
    }
    return c.json({ accounts: Object.values(groups).map(g => ({ ...g, opening_balance: g.opening_balance })), source: 'journal', period: { start: startDate, end: endDate } });
  }

  // Fallback: bank_transactions
  const bankRows = await db.prepare(
    `SELECT bt.*, i.invoice_number, i.supplier_id, i.customer_id
     FROM bank_transactions bt LEFT JOIN invoices i ON bt.invoice_id = i.id
     WHERE bt.user_id = ? AND bt.transaction_date >= ? AND bt.transaction_date <= ? AND bt.deleted_at IS NULL
     ORDER BY bt.transaction_date`
  ).bind(tenantId, startDate, endDate).all();

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
      push(ensure('11101', 'Cash on Hand', 'asset'), { date: tx.transaction_date, description: desc + invInfo, debit: tx.deposit_amount, credit: 0, balance: 0 });
      // Credit revenue or Director Loan
      if (isDirector(desc)) {
        push(ensure('21201', 'Director Loan', 'liability'), { date: tx.transaction_date, description: desc, debit: 0, credit: tx.deposit_amount, balance: 0 });
      } else {
        push(ensure('41101', 'Professional Services', 'revenue'), { date: tx.transaction_date, description: desc + invInfo, debit: 0, credit: tx.deposit_amount, balance: 0 });
      }
    }
    if (tx.withdrawal_amount > 0) {
      const expCode = tx.supplier_id ? '51101' : '62303';
      const expName = tx.supplier_id ? 'Subcontractor Fees' : 'Software Subscriptions';
      push(ensure(expCode, expName, 'expense'), { date: tx.transaction_date, description: desc + invInfo, debit: tx.withdrawal_amount, credit: 0, balance: 0 });
      push(ensure('11101', 'Cash on Hand', 'asset'), { date: tx.transaction_date, description: desc + invInfo, debit: 0, credit: tx.withdrawal_amount, balance: 0 });
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
bookkeeping.post('/auto-generate-entries', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;

  // Count and delete stale entries so they can be regenerated
  const staleCount = await db.prepare(
    "SELECT COUNT(*) as cnt FROM journal_entries WHERE user_id = ? AND reference_type = 'bank_transaction' AND status = 'stale'"
  ).bind(tenantId).first<{ cnt: number }>();
  if ((staleCount?.cnt || 0) > 0) {
    await db.prepare(
      "DELETE FROM journal_entries WHERE user_id = ? AND reference_type = 'bank_transaction' AND status = 'stale'"
    ).bind(tenantId).run();
  }

  // Get bank transactions already converted (skip stale ones just deleted)
  const existingRefs = await db.prepare(
    "SELECT reference_id FROM journal_entries WHERE user_id = ? AND reference_type = 'bank_transaction'"
  ).bind(tenantId).all();
  const refSet = new Set((existingRefs.results as any[]).map(r => r.reference_id));

  const txRows = await db.prepare(
    `SELECT bt.*, i.invoice_number, i.supplier_id
     FROM bank_transactions bt LEFT JOIN invoices i ON bt.invoice_id = i.id
     WHERE bt.user_id = ?
     AND bt.deleted_at IS NULL
     AND bt.description NOT LIKE '%TRANSACTION SUMMARY%'
     AND bt.description NOT LIKE '%CARRIED FORWARD%'
     AND bt.description NOT LIKE '%今期結餘%'
     AND bt.description NOT LIKE '%進支摘要%'
     ORDER BY bt.transaction_date`
  ).bind(tenantId).all();

  // Dynamically ensure all transaction codes exist in COA
  const createdCount: number[] = [0];
  const codes = await collectTransactionCodes(db, tenantId);
  await ensureMissingAccounts(db, tenantId, codes, createdCount);

  const isDirector = (desc: string) => /JOSEPH|LIN PUI|LAI KIN|RAYMOND|SZETO/i.test(desc);

  // Pre-load COA lookup for resolving pre-assigned account codes
  const allAccounts = await db.prepare(
    'SELECT account_code, account_name, account_type FROM accounts WHERE user_id = ? AND is_active = 1'
  ).bind(tenantId).all();
  const accountMap = new Map<string, { name: string; type: string }>();
  for (const a of allAccounts.results as any[]) {
    accountMap.set(a.account_code, { name: a.account_name, type: a.account_type });
  }

  let created = 0;

  for (const tx of txRows.results as any[]) {
    if (refSet.has(tx.id)) continue;

    const desc = tx.description || '';
    const invInfo = tx.invoice_number ? ` (${tx.invoice_number})` : '';
    const entryId = `je-${uuidv4().slice(0, 8)}`;
    const entryNum = `JE-AUTO-${String(created + 1).padStart(4, '0')}-${uuidv4().slice(0, 4)}`;
    const lines: { code: string; name: string; debit: number; credit: number }[] = [];

    if (tx.deposit_amount > 0) {
      // OUTCLEARING/RETURN: deposit was reversed — contra entry
      if (desc.includes('OUTCLEARING') || desc.includes('RETURN') || desc.includes('退票')) {
        lines.push({ code: '21201', name: 'Director Loan', debit: tx.deposit_amount, credit: 0 });
        lines.push({ code: '11101', name: 'Cash on Hand', debit: 0, credit: tx.deposit_amount });
      } else {
        lines.push({ code: '11101', name: 'Cash on Hand', debit: tx.deposit_amount, credit: 0 });

        // Use pre-assigned account_code if available
        const assigned = tx.account_code ? accountMap.get(tx.account_code) : null;
        if (assigned && tx.account_code !== '11101' && tx.account_code !== '21201') {
          lines.push({ code: tx.account_code, name: assigned.name, debit: 0, credit: tx.deposit_amount });
        } else if (isDirector(desc)) {
          lines.push({ code: '21201', name: 'Director Loan', debit: 0, credit: tx.deposit_amount });
        } else if (/VISA DEBIT.*- *CR|CREDIT.*VISA/i.test(desc)) {
          lines.push({ code: '62303', name: 'Software Subscriptions', debit: 0, credit: tx.deposit_amount });
        } else if (desc.includes('INTEREST PAYMENT') || desc.includes('利息收入')) {
          lines.push({ code: '42101', name: 'Bank Interest', debit: 0, credit: tx.deposit_amount });
        } else if (tx.deposit_amount >= 5000 && /DIRECT CREDIT|FPS|TRANSFER|CHEQUE/i.test(desc)) {
          lines.push({ code: '21201', name: 'Director Loan', debit: 0, credit: tx.deposit_amount });
        } else {
          lines.push({ code: '41101', name: 'Professional Services', debit: 0, credit: tx.deposit_amount });
        }
      }
    }
    if (tx.withdrawal_amount > 0) {
      if (desc.includes('OUTCLEARING') || desc.includes('RETURN') || desc.includes('退票')) {
        lines.push({ code: '21201', name: 'Director Loan', debit: tx.withdrawal_amount, credit: 0 });
        lines.push({ code: '11101', name: 'Cash on Hand', debit: 0, credit: tx.withdrawal_amount });
      } else if (isDirector(desc) && /TRANSFER-DEBIT|FPS/i.test(desc)) {
        lines.push({ code: '21201', name: 'Director Loan', debit: tx.withdrawal_amount, credit: 0 });
        lines.push({ code: '11101', name: 'Cash on Hand', debit: 0, credit: tx.withdrawal_amount });
      } else {
        // Use pre-assigned account_code if available
        const assigned = tx.account_code ? accountMap.get(tx.account_code) : null;
        let expCode: string, expName: string;
        if (assigned && tx.account_code !== '11101' && tx.account_code !== '21201') {
          expCode = tx.account_code;
          expName = assigned.name;
        } else {
          expCode = tx.supplier_id ? '51101' : '62303';
          expName = tx.supplier_id ? 'Subcontractor Fees' : 'Software Subscriptions';
        }
        lines.push({ code: expCode, name: expName, debit: tx.withdrawal_amount, credit: 0 });
        lines.push({ code: '11101', name: 'Cash on Hand', debit: 0, credit: tx.withdrawal_amount });
      }
    }

    if (lines.length === 0) continue;

    await db.prepare(
      'INSERT INTO journal_entries (id, user_id, entry_number, entry_date, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(entryId, tenantId, entryNum, tx.transaction_date, desc + invInfo, 'bank_transaction', tx.id).run();

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await db.prepare(
        'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(`jl-${uuidv4().slice(0, 8)}`, entryId, l.code, l.name, desc + invInfo, l.debit, l.credit, i).run();
    }
    created++;
  }

  if (created > 0) {
    await auditLog(db, user.id, 'auto_generate', 'journal_entry', null, { created, total: txRows.results.length, skipped: refSet.size });
  }
  return c.json({ created, total_transactions: txRows.results.length, skipped: refSet.size, stale_deleted: staleCount?.cnt || 0 });
});

// Post an invoice to GL: Dr Accounts Receivable, Cr Revenue
bookkeeping.post('/post-invoice/:id', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const invoiceId = c.req.param('id');

  const inv = await db.prepare(
    'SELECT * FROM invoices WHERE id = ? AND user_id = ?'
  ).bind(invoiceId, tenantId).first<{ id: string; invoice_number: string; issue_date: string; total: number; customer_id: string; notes: string }>();
  if (!inv) return c.json({ error: 'Invoice not found' }, 404);

  // Check not already posted
  const existing = await db.prepare(
    "SELECT id FROM journal_entries WHERE reference_type = 'invoice' AND reference_id = ? AND user_id = ?"
  ).bind(invoiceId, tenantId).first();
  if (existing) return c.json({ error: 'Invoice already posted to GL', entry_id: (existing as any).id }, 409);

  // Ensure AR and Revenue accounts exist via dynamic missing-account creation
  await ensureMissingAccounts(db, tenantId, ['11201', '41101'], [0]);

  const jeId = `je-${uuidv4().slice(0, 8)}`;
  const jeNum = `JE-INV-${inv.invoice_number}`;
  await db.prepare(
    'INSERT INTO journal_entries (id, user_id, entry_number, entry_date, description, reference_type, reference_id) VALUES (?,?,?,?,?,?,?)'
  ).bind(jeId, tenantId, jeNum, inv.issue_date, `Invoice ${inv.invoice_number}: ${inv.notes || 'Services'}`, 'invoice', invoiceId).run();
  // Dr AR
  await db.prepare(
    'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, '11201', 'Trade Debtors 應收賬款', inv.invoice_number, inv.total, 0, 0).run();
  // Cr Revenue
  await db.prepare(
    'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, '41101', 'Professional Services 專業服務收入', inv.invoice_number, 0, inv.total, 1).run();

  await auditLog(db, user.id, 'post_invoice', 'invoice', invoiceId, { invoice_number: inv.invoice_number, total: inv.total });
  return c.json({ entry_id: jeId, entry_number: jeNum, invoice_id: invoiceId }, 201);
});

// When an invoice payment is matched, create the receipt entry (Dr Cash, Cr AR)
bookkeeping.post('/post-payment/:transactionId', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const txId = c.req.param('transactionId');
  if (!txId) return c.json({ error: 'transactionId required' }, 400);

  const tx = await db.prepare(
    `SELECT bt.*, i.invoice_number, i.total as invoice_total
     FROM bank_transactions bt LEFT JOIN invoices i ON bt.invoice_id = i.id
     WHERE bt.id = ? AND bt.user_id = ? AND bt.match_status = 'confirmed' AND bt.deleted_at IS NULL`
  ).bind(txId, tenantId).first<{ id: string; transaction_date: string; deposit_amount: number; invoice_id: string; invoice_number: string; invoice_total: number }>();
  if (!tx || !tx.invoice_id) return c.json({ error: 'Transaction not found or not matched to an invoice' }, 404);

  // Check not already posted
  const existing = await db.prepare(
    "SELECT id FROM journal_entries WHERE reference_type = 'payment' AND reference_id = ? AND user_id = ?"
  ).bind(txId, tenantId).first();
  if (existing) return c.json({ error: 'Payment already posted to GL', entry_id: (existing as any).id }, 409);

  const jeId = `je-${uuidv4().slice(0, 8)}`;
  const jeNum = `JE-PMT-${tx.invoice_number || txId.slice(0, 8)}`;
  await db.prepare(
    'INSERT INTO journal_entries (id, user_id, entry_number, entry_date, description, reference_type, reference_id) VALUES (?,?,?,?,?,?,?)'
  ).bind(jeId, tenantId, jeNum, tx.transaction_date, `Payment for invoice ${tx.invoice_number || ''}`, 'payment', txId).run();
  // Dr Cash
  await db.prepare(
    'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, '11101', 'Cash on Hand 庫存現金', tx.invoice_number || '', tx.deposit_amount, 0, 0).run();
  // Cr AR
  await db.prepare(
    'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, '11201', 'Trade Debtors 應收賬款', tx.invoice_number || '', 0, tx.deposit_amount, 1).run();

  await auditLog(db, user.id, 'post_payment', 'payment', txId, { invoice_number: tx.invoice_number, amount: tx.deposit_amount });
  return c.json({ entry_id: jeId, entry_number: jeNum, transaction_id: txId }, 201);
});

// Year-End Close: transfer P&L to Retained Earnings and roll forward
bookkeeping.post('/year-end-close', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json();
  const { fiscal_end_date } = body;
  if (!fiscal_end_date) return c.json({ error: 'fiscal_end_date required (e.g. 2026-03-31)' }, 400);

  // Get total revenue and expenses up to fiscal end date
  const revenue = await db.prepare(
    `SELECT COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as amount FROM journal_lines jl
     JOIN journal_entries je ON jl.entry_id = je.id
     JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date <= ? AND a.account_type = 'revenue' AND je.status != 'stale'`
  ).bind(tenantId, fiscal_end_date).first<{ amount: number }>();

  const expenses = await db.prepare(
    `SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as amount FROM journal_lines jl
     JOIN journal_entries je ON jl.entry_id = je.id
     JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date <= ? AND a.account_type = 'expense' AND je.status != 'stale'`
  ).bind(tenantId, fiscal_end_date).first<{ amount: number }>();

  const netIncome = (revenue?.amount || 0) - (expenses?.amount || 0);

  // Create closing entry: Dr/Cr Revenue & Expense accounts, offset to Retained Earnings
  const jeId = `je-${uuidv4().slice(0, 8)}`;
  const jeNum = `JE-YEC-${fiscal_end_date.slice(0, 4)}`;
  await db.prepare(
    'INSERT INTO journal_entries (id, user_id, entry_number, entry_date, description, reference_type) VALUES (?,?,?,?,?,?)'
  ).bind(jeId, tenantId, jeNum, fiscal_end_date, `Year-end close ${fiscal_end_date.slice(0,4)}`, 'year_end_close').run();

  let sortOrder = 0;

  // Close each Revenue account individually (Debit revenue to zero, Credit Retained Earnings)
  const revAccounts = await db.prepare(
    `SELECT jl.account_code, jl.account_name, SUM(jl.credit) - SUM(jl.debit) as balance
     FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
     JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date <= ? AND a.account_type = 'revenue' AND je.status != 'stale'
     GROUP BY jl.account_code ORDER BY jl.account_code`
  ).bind(tenantId, fiscal_end_date).all();

  for (const row of revAccounts.results as any[]) {
    if (Math.abs(row.balance || 0) < 0.01) continue;
    await db.prepare(
      'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, row.account_code, row.account_name, `Close to RE`, Math.abs(row.balance), 0, sortOrder++).run();
  }

  // Close each Expense account individually (Credit expense to zero, Debit Retained Earnings)
  const expAccounts = await db.prepare(
    `SELECT jl.account_code, jl.account_name, SUM(jl.debit) - SUM(jl.credit) as balance
     FROM journal_lines jl JOIN journal_entries je ON jl.entry_id = je.id
     JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date <= ? AND a.account_type = 'expense' AND je.status != 'stale'
     GROUP BY jl.account_code ORDER BY jl.account_code`
  ).bind(tenantId, fiscal_end_date).all();

  for (const row of expAccounts.results as any[]) {
    if (Math.abs(row.balance || 0) < 0.01) continue;
    await db.prepare(
      'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, row.account_code, row.account_name, `Close to RE`, 0, Math.abs(row.balance), sortOrder++).run();
  }

  // Net to Retained Earnings (balancing entry)
  if (netIncome > 0) {
    await db.prepare(
      'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, '32101', 'Retained Earnings b/f 上年度保留盈利', `Year ${fiscal_end_date.slice(0,4)} net income`, 0, netIncome, sortOrder++).run();
  } else if (netIncome < 0) {
    await db.prepare(
      'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, '32101', 'Retained Earnings b/f 上年度保留盈利', `Year ${fiscal_end_date.slice(0,4)} net loss`, Math.abs(netIncome), 0, sortOrder++).run();
  }

  // Update opening balances for balance sheet accounts for new fiscal year
  const bsAccounts = await db.prepare(
    `SELECT a.account_code, COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as journal_balance, a.opening_balance
     FROM accounts a LEFT JOIN journal_lines jl ON a.account_code = jl.account_code
     LEFT JOIN journal_entries je ON jl.entry_id = je.id AND je.entry_date <= ? AND je.status != 'stale'
     WHERE a.user_id = ? AND a.is_active = 1 AND a.account_type IN ('asset', 'liability', 'equity')
     GROUP BY a.account_code`
  ).bind(fiscal_end_date, tenantId).all();

  for (const row of bsAccounts.results as any[]) {
    const newOpening = (row.opening_balance || 0) + (row.journal_balance || 0);
    await db.prepare('UPDATE accounts SET opening_balance = ? WHERE user_id = ? AND account_code = ?')
      .bind(newOpening, tenantId, row.account_code).run();
  }

  await auditLog(db, user.id, 'year_end_close', 'fiscal_year', jeId, { fiscal_end_date, revenue: revenue?.amount, expenses: expenses?.amount, net_income: netIncome });
  return c.json({ entry_id: jeId, entry_number: jeNum, fiscal_end_date, revenue: revenue?.amount || 0, expenses: expenses?.amount || 0, net_income: netIncome }, 201);
});

// Profits Tax Provision: compute basic tax provision (16.5% of net income for HK companies)
bookkeeping.post('/profits-tax-provision', bookkeeperMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const body = await c.req.json();
  const { fiscal_end_date, tax_rate } = body;
  if (!fiscal_end_date) return c.json({ error: 'fiscal_end_date required' }, 400);
  const rate = tax_rate || 16.5; // HK standard Profits Tax rate (8.25% below $2M assessable profits)

  // Get net income from P&L
  const revenue = await db.prepare(
    `SELECT COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as amount FROM journal_lines jl
     JOIN journal_entries je ON jl.entry_id = je.id
     JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date <= ? AND a.account_type = 'revenue' AND je.status != 'stale'`
  ).bind(tenantId, fiscal_end_date).first<{ amount: number }>();

  const expenses = await db.prepare(
    `SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as amount FROM journal_lines jl
     JOIN journal_entries je ON jl.entry_id = je.id
     JOIN accounts a ON jl.account_code = a.account_code AND je.user_id = a.user_id
     WHERE je.user_id = ? AND je.entry_date <= ? AND a.account_type = 'expense' AND je.status != 'stale'`
  ).bind(tenantId, fiscal_end_date).first<{ amount: number }>();

  const netIncome = (revenue?.amount || 0) - (expenses?.amount || 0);
  if (netIncome <= 0) return c.json({ message: 'No taxable profit. No provision needed.', net_income: netIncome }, 200);

  // Simple 2-tier rate: 8.25% on first $2M, 16.5% on remainder
  const tier1 = Math.min(netIncome, 2000000);
  const tier2 = Math.max(netIncome - 2000000, 0);
  const taxAmount = tier1 * 0.0825 + tier2 * (rate / 100);

  // Ensure tax accounts exist
  for (const [code, name, type] of [['81101', 'Current Year Profits Tax 本年度利得稅', 'expense'], ['21301', 'Profits Tax Payable 應付利得稅', 'liability']] as const) {
    const ex = await db.prepare('SELECT id FROM accounts WHERE user_id = ? AND account_code = ?').bind(tenantId, code).first();
    if (!ex) {
      await db.prepare('INSERT INTO accounts (id, user_id, account_code, account_name, account_type) VALUES (?,?,?,?,?)')
        .bind(`acc-${uuidv4().slice(0, 8)}`, tenantId, code, name, type).run();
    }
  }

  // Create tax provision journal entry: Dr Profits Tax Expense, Cr Profits Tax Payable
  const jeId = `je-${uuidv4().slice(0, 8)}`;
  const jeNum = `JE-TAX-${fiscal_end_date.slice(0, 4)}`;
  await db.prepare(
    'INSERT INTO journal_entries (id, user_id, entry_number, entry_date, description, reference_type) VALUES (?,?,?,?,?,?)'
  ).bind(jeId, tenantId, jeNum, fiscal_end_date, `Profits Tax provision ${fiscal_end_date.slice(0,4)}`, 'tax_provision').run();

  await db.prepare(
    'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, '81101', 'Current Year Profits Tax 本年度利得稅', `Tax provision @${rate}%`, Math.round(taxAmount * 100) / 100, 0, 0).run();

  await db.prepare(
    'INSERT INTO journal_lines (id, entry_id, account_code, account_name, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(`jl-${uuidv4().slice(0, 8)}`, jeId, '21301', 'Profits Tax Payable 應付利得稅', `Tax provision @${rate}%`, 0, Math.round(taxAmount * 100) / 100, 1).run();

  await auditLog(db, user.id, 'tax_provision', 'tax', jeId, { fiscal_end_date, net_income: netIncome, tax_rate: rate, tax_amount: Math.round(taxAmount * 100) / 100 });

  return c.json({
    entry_id: jeId, entry_number: jeNum,
    net_income: netIncome,
    tax_rate_used: `8.25% on first $2M, ${rate}% on remainder`,
    tax_amount: Math.round(taxAmount * 100) / 100,
    tier1_amount: tier1 * 0.0825,
    tier2_amount: tier2 * (rate / 100),
  }, 201);
});

export { bookkeeping as bookkeepingRoutes };
