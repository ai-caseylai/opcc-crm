import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { verify as jwtVerify } from 'jsonwebtoken';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';

const bank = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Download file (token-protected) ──
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
  const tenantId = c.get('client_user_id') || user.id;
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

// ── Auto-match bank deposits to invoices ──
bank.post('/auto-match', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;

  const deposits = await db.prepare(
    `SELECT id, transaction_date, description, deposit_amount, reference
     FROM bank_transactions
     WHERE user_id = ? AND deposit_amount > 0 AND match_status = 'unmatched'
     ORDER BY transaction_date`
  ).bind(tenantId).all();

  const invoices = await db.prepare(
    `SELECT id, invoice_number, total, currency, issue_date, due_date, customer_id
     FROM invoices
     WHERE user_id = ? AND status NOT IN ('paid', 'cancelled')`
  ).bind(tenantId).all();

  const matched: any[] = [];
  const usedInvoiceIds = new Set<string>();

  for (const tx of deposits.results as any[]) {
    let bestMatch: any = null;
    let bestConfidence = '';

    for (const inv of (invoices.results as any[]).filter(i => !usedInvoiceIds.has(i.id))) {
      const amountMatch = Math.abs(tx.deposit_amount - inv.total) < 0.01;
      if (!amountMatch) continue;

      const descHasInv = tx.description.toUpperCase().includes(inv.invoice_number.toUpperCase())
        || (tx.reference && tx.reference.toUpperCase().includes(inv.invoice_number.toUpperCase()));

      if (descHasInv) {
        bestMatch = inv;
        bestConfidence = 'high';
        break;
      }

      const txDate = new Date(tx.transaction_date);
      const issueDate = new Date(inv.issue_date);
      const dueDate = new Date(inv.due_date || inv.issue_date);
      dueDate.setDate(dueDate.getDate() + 7);

      if (txDate >= issueDate && txDate <= dueDate) {
        if (!bestMatch || bestConfidence !== 'high') {
          bestMatch = inv;
          bestConfidence = 'medium';
        }
      } else if (!bestMatch) {
        bestMatch = inv;
        bestConfidence = 'low';
      }
    }

    if (bestMatch) {
      const reason = bestConfidence === 'high'
        ? `金額 $${tx.deposit_amount} 相符且描述含發票號 ${bestMatch.invoice_number}`
        : bestConfidence === 'medium'
        ? `金額 $${tx.deposit_amount} 相符且日期在發票期間內`
        : `金額 $${tx.deposit_amount} 相符`;

      await db.prepare(
        `UPDATE bank_transactions SET invoice_id = ?, match_confidence = ?, match_status = 'suggested' WHERE id = ?`
      ).bind(bestMatch.id, bestConfidence, tx.id).run();

      matched.push({
        transaction_id: tx.id,
        invoice_id: bestMatch.id,
        invoice_number: bestMatch.invoice_number,
        amount: tx.deposit_amount,
        confidence: bestConfidence,
        reason,
      });
      usedInvoiceIds.add(bestMatch.id);
    }
  }

  const unmatchedCount = (deposits.results as any[]).length - matched.length;
  return c.json({ matched, unmatched_count: unmatchedCount });
});

// ── List match suggestions ──
bank.get('/match-suggestions', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const rows = await c.env.DB.prepare(
    `SELECT bt.id, bt.transaction_date, bt.description, bt.deposit_amount, bt.match_confidence,
     i.id as invoice_id, i.invoice_number, i.total as invoice_total, i.status as invoice_status
     FROM bank_transactions bt
     JOIN invoices i ON bt.invoice_id = i.id
     WHERE bt.user_id = ? AND bt.match_status = 'suggested'
     ORDER BY bt.transaction_date`
  ).bind(tenantId).all();
  return c.json({ data: rows.results });
});

// ── Update transaction fields (inline edit) ──
bank.patch('/transactions/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const txId = c.req.param('id');
  const body = await c.req.json();

  const tx = await db.prepare('SELECT id FROM bank_transactions WHERE id = ? AND user_id = ?')
    .bind(txId, tenantId).first();
  if (!tx) return c.json({ error: 'Transaction not found' }, 404);

  const allowedFields = ['transaction_date', 'description', 'deposit_amount', 'withdrawal_amount', 'balance', 'reference', 'account_code'];
  const sets: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (allowedFields.includes(k)) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);

  params.push(txId, tenantId);
  await db.prepare(`UPDATE bank_transactions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...params).run();

  const row = await db.prepare('SELECT * FROM bank_transactions WHERE id = ?').bind(txId).first();
  return c.json(row);
});

// ── Confirm or unlink a match ──
bank.patch('/transactions/:id/match', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const txId = c.req.param('id');
  const body = await c.req.json();
  const { invoice_id, action } = body;

  const tx = await db.prepare(
    'SELECT id, transaction_date FROM bank_transactions WHERE id = ? AND user_id = ?'
  ).bind(txId, tenantId).first<{ id: string; transaction_date: string }>();
  if (!tx) return c.json({ error: 'Transaction not found' }, 404);

  if (action === 'confirm' && invoice_id) {
    const inv = await db.prepare(
      'SELECT id FROM invoices WHERE id = ? AND user_id = ?'
    ).bind(invoice_id, tenantId).first();
    if (!inv) return c.json({ error: 'Invoice not found' }, 404);

    await db.prepare(
      `UPDATE bank_transactions SET invoice_id = ?, match_confidence = 'manual', match_status = 'confirmed' WHERE id = ?`
    ).bind(invoice_id, txId).run();

    await db.prepare(
      `UPDATE invoices SET status = 'paid', paid_date = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(tx.transaction_date, invoice_id).run();

    return c.json({ success: true, invoice_status: 'paid', paid_date: tx.transaction_date });
  }

  if (action === 'unlink') {
    await db.prepare(
      `UPDATE bank_transactions SET invoice_id = NULL, match_confidence = NULL, match_status = 'unmatched' WHERE id = ?`
    ).bind(txId).run();
    return c.json({ success: true });
  }

  return c.json({ error: 'action must be confirm or unlink' }, 400);
});

// ── Get single (with transactions) ──
bank.get('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const stmt = await c.env.DB.prepare(
    `SELECT id, file_name, bank_name, account_number, branch, currency, account_type,
     statement_year, statement_month, period_start, period_end,
     opening_balance, closing_balance, page_count, ocr_text, status, created_at
     FROM bank_statements WHERE id = ? AND user_id = ?`
  ).bind(c.req.param('id'), tenantId).first();
  if (!stmt) return c.json({ error: 'Not found' }, 404);

  const txs = await c.env.DB.prepare(
    `SELECT bt.id, bt.transaction_date, bt.description, bt.deposit_amount, bt.withdrawal_amount,
     bt.balance, bt.account_type, bt.account_code, bt.reference, bt.sort_order,
     bt.invoice_id, bt.match_confidence, bt.match_status,
     i.invoice_number, i.total as invoice_total, i.status as invoice_status
     FROM bank_transactions bt
     LEFT JOIN invoices i ON bt.invoice_id = i.id
     WHERE bt.bank_statement_id = ?
     ORDER BY bt.sort_order`
  ).bind(c.req.param('id')).all();

  return c.json({ ...stmt, transactions: txs.results });
});

// ── Import (parsed data + transactions) ──
bank.post('/import', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
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
  ).bind(tenantId, r2_key).first();
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
  const tenantId = c.get('client_user_id') || user.id;
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
  const tenantId = c.get('client_user_id') || user.id;
  const existing = await c.env.DB.prepare('SELECT id FROM bank_statements WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM bank_statements WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).run();
  return c.json({ success: true });
});

// ── Auto-categorize transactions by description patterns ──
bank.post('/:id/auto-categorize', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const stmtId = c.req.param('id');

  const stmt = await db.prepare('SELECT id FROM bank_statements WHERE id = ? AND user_id = ?')
    .bind(stmtId, tenantId).first();
  if (!stmt) return c.json({ error: 'Statement not found' }, 404);

  // Categorization rules: [pattern, account_code]
  const rules: [RegExp, string][] = [
    [/B\/F\s+BALANCE|承上結餘/i, ''],
    [/INTEREST\s*(PAYMENT|收入)|利息/i, '42010'],
    [/VISA\s+DEBIT.*-.*CR|CREDIT.*VISA/i, '52070'],
    [/VISA\s+DEBIT|扣賬卡交易/i, '52070'],
    [/TRANSFER-DEBIT|轉賬支出/i, '52070'],
    [/DIRECT\s+CREDIT|自動轉賬存入/i, ''],
    [/FPS\s+FEE|FPSPAYMENT/i, '52100'],
    [/OUTCLEARING|RETURN|退票/i, '22020'],
    [/CHEQUE|支票/i, '11012'],
    [/SALARY|薪金|薪資|工資|PAYROLL/i, '52020'],
    [/RENT|租金/i, '52030'],
    [/UTILITIES|水電|電費|水費/i, '52040'],
    [/INSURANCE|保險/i, '52090'],
    [/TAX|稅|IRD/i, '57010'],
    [/SOFTWARE|SUBSCRIPTION|CLOUD|API|\.AI\b|\.COM/i, '52070'],
    [/MPF|強積金|公積金/i, '52021'],
    [/AUDIT|審計/i, '52081'],
    [/SECRETARY|秘書/i, '52084'],
    [/TRAVEL|交通|機票|HOTEL/i, '54000'],
    [/ADVERTISING|廣告|MARKETING/i, '53000'],
    [/COMMISSION|佣金/i, '53030'],
    [/ENTERTAINMENT|交際|應酬/i, '53040'],
    [/BANK\s+CHARGE|手續費/i, '52100'],
    [/DONATION|捐款|慈善/i, '58020'],
  ];

  // Director names for Director Loan classification
  const directorPattern = /JOSEPH|LIN\s*PUI|LAI\s*KIN|RAYMOND|SZETO/i;

  const txs = await db.prepare(
    'SELECT id, description, deposit_amount, withdrawal_amount FROM bank_transactions WHERE bank_statement_id = ? AND account_code IS NULL ORDER BY sort_order'
  ).bind(stmtId).all();

  let categorized = 0;
  let skipped = 0;
  const results: string[] = [];

  for (const tx of txs.results as any[]) {
    const desc = tx.description || '';
    let code = '';

    // Check if director-related
    const isDirector = directorPattern.test(desc);

    for (const [pattern, acctCode] of rules) {
      if (pattern.test(desc)) {
        code = acctCode;
        break;
      }
    }

    // Override: director-related deposits/withdrawals → Director Loan
    if (isDirector && /DIRECT\s+CREDIT|TRANSFER-DEBIT|FPS|自動轉賬|轉賬/.test(desc)) {
      code = '22020';
    }

    // Override: DIRECT CREDIT that's not matched → check for director
    if (!code && tx.deposit_amount > 0 && /DIRECT\s+CREDIT|自動轉賬存入/i.test(desc)) {
      code = isDirector ? '22020' : '41020';
    }

    if (!code) { skipped++; continue; }

    await db.prepare('UPDATE bank_transactions SET account_code = ? WHERE id = ?')
      .bind(code, tx.id).run();
    results.push(`${tx.transaction_date?.slice(0,10)} | ${code} | ${desc.slice(0,50)}`);
    categorized++;
  }

  return c.json({ categorized, skipped, total: txs.results.length, results: results.slice(0, 20) });
});

export { bank as bankStatementRoutes };
