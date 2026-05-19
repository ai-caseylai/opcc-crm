import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { wsBroadcast } from './ws';
import { processBankStatement, extractCompanyInfo, extractBankInfo } from '../lib/bank-ocr';

// Shared import: file_record → bank_statement + bank_transactions
async function importStatementFromFile(
  fileId: string, userId: string, db: D1Database, fileBucket: R2Bucket, ai: any, deepseekKey: string,
): Promise<{ success: boolean; statement_id?: string; error?: string; transactions_count?: number; parsed_via_ai?: boolean }> {
  const fileRow = await db.prepare(
    'SELECT id, r2_key, filename, original_name, file_type, ocr_text, ocr_status, category FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(fileId, userId).first<{ id: string; r2_key: string; filename: string; original_name: string; file_type: string; ocr_text: string; ocr_status: string; category: string }>();
  if (!fileRow) return { success: false, error: 'File not found' };

  const existing = await db.prepare('SELECT id FROM bank_statements WHERE user_id = ? AND r2_key = ?').bind(userId, fileRow.r2_key).first();
  if (existing) return { success: false, error: 'Statement already imported', statement_id: existing.id as string };

  // Get OCR text
  let ocrText = fileRow.ocr_text || '';
  if (!ocrText || ocrText.length < 20) {
    const obj = await fileBucket.get(fileRow.r2_key);
    if (obj) {
      const buffer = await obj.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      if (ai) {
        try {
          const aiResponse = await ai.run('@cf/unum/uform-gen2-qwen-500m', {
            prompt: 'Extract all visible text from this bank statement. Include all transaction dates, descriptions, deposit amounts, withdrawal amounts, balances, account numbers, bank name, statement period, opening and closing balances.',
            image: base64,
          });
          ocrText = aiResponse?.description || '';
        } catch {}
      }
      if (ocrText) {
        await db.prepare("UPDATE file_records SET ocr_text = ?, ocr_status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(ocrText, fileId).run();
      }
    }
  }

  if (!ocrText || ocrText.length < 10) return { success: false, error: 'Could not extract text' };

  // Parse with DeepSeek AI
  let parsed: any = null;
  if (deepseekKey) {
    try {
      const parseResp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: `Parse the following bank statement OCR text into structured JSON. Extract:
- bank_name: the bank name
- account_number: account number if visible
- currency: default "HKD"
- statement_year and statement_month: from statement period
- period_start and period_end: dates in YYYY-MM-DD
- opening_balance and closing_balance: numbers (opening is the starting balance, closing is the ending balance)
- transactions: array of { transaction_date (YYYY-MM-DD), description, deposit_amount (number, 0 if withdrawal), withdrawal_amount (number, 0 if deposit), balance (number or null) }
Return ONLY valid JSON, no explanation. If you can't parse something, use null.

OCR TEXT:
${ocrText.slice(0, 8000)}` }],
          max_tokens: 4000,
        }),
      });
      const parseData = await parseResp.json() as any;
      const raw = parseData.choices?.[0]?.message?.content || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {}
  }

  const stmtId = `bs-${uuidv4().slice(0, 8)}`;
  const bankName = parsed?.bank_name || null;
  const accountNumber = parsed?.account_number || null;
  const currency = parsed?.currency || 'HKD';
  const stmtYear = parsed?.statement_year || null;
  const stmtMonth = parsed?.statement_month || null;
  const periodStart = parsed?.period_start || null;
  const periodEnd = parsed?.period_end || null;
  const openingBal = parsed?.opening_balance ?? null;
  const closingBal = parsed?.closing_balance ?? null;

  await db.prepare(
    `INSERT INTO bank_statements (id, user_id, file_name, file_type, file_data, r2_key,
     bank_name, account_number, branch, currency, account_type,
     statement_year, statement_month, period_start, period_end,
     opening_balance, closing_balance, page_count, ocr_text)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(stmtId, userId, fileRow.original_name || fileRow.filename, fileRow.file_type, '',
    fileRow.r2_key, bankName, accountNumber, null, currency, null,
    stmtYear, stmtMonth, periodStart, periodEnd,
    openingBal, closingBal, null, ocrText
  ).run();

  let txCount = 0;
  const transactions = parsed?.transactions || [];
  for (const tx of transactions) {
    if (!tx.transaction_date) continue;
    const txId = `bt-${uuidv4().slice(0, 8)}`;
    await db.prepare(
      `INSERT INTO bank_transactions (id, bank_statement_id, user_id, transaction_date, description,
       deposit_amount, withdrawal_amount, balance, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(txId, stmtId, userId, tx.transaction_date, tx.description || '',
      tx.deposit_amount || 0, tx.withdrawal_amount || 0, tx.balance ?? null, txCount
    ).run();
    txCount++;
  }

  await db.prepare(
    "UPDATE file_records SET category = 'bank_statement', folder = 'Bank Statements', updated_at = datetime('now') WHERE id = ?"
  ).bind(fileId).run();

  // Auto-categorize transactions
  try {
    const rules: [RegExp, string][] = [
      [/B\/F\s+BALANCE|承上結餘/i, ''],
      [/INTEREST\s*(PAYMENT|收入)|利息/i, '42010'],
      [/VISA\s+DEBIT.*-.*CR|CREDIT.*VISA/i, '52070'],
      [/VISA\s+DEBIT|扣賬卡交易/i, '52070'],
      [/TRANSFER-DEBIT|轉賬支出/i, '52070'],
      [/FPS\s+FEE|FPSPAYMENT/i, '52100'],
      [/OUTCLEARING|RETURN|退票/i, '22020'],
      [/SALARY|薪金|薪資|工資/i, '52020'],
      [/RENT|租金/i, '52030'],
      [/UTILITIES|水電|電費|水費/i, '52040'],
      [/INSURANCE|保險/i, '52090'],
      [/TAX|稅|IRD/i, '57010'],
      [/SOFTWARE|SUBSCRIPTION|CLOUD|API|\.AI\b|\.COM/i, '52070'],
      [/MPF|強積金/i, '52021'],
      [/AUDIT|審計/i, '52081'],
      [/SECRETARY|秘書/i, '52084'],
      [/TRAVEL|交通|機票|HOTEL/i, '54000'],
      [/BANK\s+CHARGE|手續費/i, '52100'],
    ];
    const directorPattern = /JOSEPH|LIN\s*PUI|LAI\s*KIN|RAYMOND|SZETO/i;

    const txs = await db.prepare(
      'SELECT id, description, deposit_amount FROM bank_transactions WHERE bank_statement_id = ? AND account_code IS NULL'
    ).bind(stmtId).all();

    for (const tx of txs.results as any[]) {
      const desc = tx.description || '';
      const isDirector = directorPattern.test(desc);
      let code = '';
      for (const [pattern, acctCode] of rules) {
        if (pattern.test(desc)) { code = acctCode; break; }
      }
      if (isDirector && /DIRECT\s+CREDIT|TRANSFER-DEBIT|FPS|自動轉賬|轉賬/.test(desc)) code = '22020';
      if (!code && tx.deposit_amount > 0 && /DIRECT\s+CREDIT|自動轉賬存入/i.test(desc)) code = isDirector ? '22020' : '41020';
      if (code) {
        await db.prepare('UPDATE bank_transactions SET account_code = ? WHERE id = ?').bind(code, tx.id).run();
      }
    }
  } catch { /* non-critical */ }

  // Auto-fill company & bank profile from first bank statement if empty
  try {
    const text = fileRow.ocr_text || ocrText || '';
    if (text.length > 100) {
      const company = extractCompanyInfo(text);
      const bank = extractBankInfo(text);

      const existing = await db.prepare(
        'SELECT name, address, bank_name, bank_account FROM company_settings WHERE user_id = ?'
      ).bind(userId).first<{ name: string; address: string | null; bank_name: string; bank_account: string }>();

      const sets: string[] = [];
      const params: any[] = [];

      if (company.name && (!existing?.name || existing.name === 'OPCC CRM' || !existing?.name)) {
        sets.push('name = ?, legal_name = ?');
        params.push(company.name, company.name);
      }
      if (company.address && (!existing?.address || !existing.address?.trim() || existing.address === 'Hong Kong')) {
        sets.push('address = ?');
        params.push(company.address);
      }
      if (company.address2) {
        sets.push('address2 = ?');
        params.push(company.address2);
      }
      if (bank.bank_name && !existing?.bank_name) {
        sets.push('bank_name = ?');
        params.push(bank.bank_name);
      }
      if (bank.account_number && !existing?.bank_account) {
        sets.push('bank_account = ?');
        params.push(bank.account_number);
      }

      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        params.push(userId);
        await db.prepare(`UPDATE company_settings SET ${sets.join(', ')} WHERE user_id = ?`).bind(...params).run();
      }
    }
  } catch { /* non-critical */ }

  return {
    success: true,
    statement_id: stmtId,
    transactions_count: txCount,
    parsed_via_ai: !!parsed,
  };
}

// Shared import: file_record → invoice + invoice_items
async function importInvoiceFromFile(
  fileId: string, userId: string, db: D1Database, fileBucket: R2Bucket, ai: any, deepseekKey: string,
): Promise<{ success: boolean; invoice_id?: string; error?: string; items_count?: number }> {
  const fileRow = await db.prepare(
    'SELECT id, r2_key, filename, original_name, file_type, ocr_text, ocr_status, category, direction FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(fileId, userId).first<{ id: string; r2_key: string; filename: string; original_name: string; file_type: string; ocr_text: string; ocr_status: string; category: string; direction: string }>();
  if (!fileRow) return { success: false, error: 'File not found' };

  let ocrText = fileRow.ocr_text || '';
  if (!ocrText || ocrText.length < 20) {
    const obj = await fileBucket.get(fileRow.r2_key);
    if (obj) {
      const buffer = await obj.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      if (ai) {
        try {
          const aiResponse = await ai.run('@cf/unum/uform-gen2-qwen-500m', {
            prompt: 'Extract all visible text from this invoice. Include invoice number, dates, company names, amounts, line items with descriptions and prices.',
            image: base64,
          });
          ocrText = aiResponse?.description || '';
        } catch {}
      }
      if (ocrText) {
        await db.prepare("UPDATE file_records SET ocr_text = ?, ocr_status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(ocrText, fileId).run();
      }
    }
  }

  if (!ocrText || ocrText.length < 10) return { success: false, error: 'No OCR text available' };

  // Parse with DeepSeek AI
  let parsed: any = null;
  if (deepseekKey) {
    try {
      const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: `Parse this invoice OCR text into structured JSON. Extract:
- invoice_number: the invoice number/ID
- customer_name: the customer/company being billed
- customer_email: optional customer email
- issue_date: YYYY-MM-DD
- due_date: YYYY-MM-DD if visible
- currency: default "HKD"
- items: array of { description, quantity (number, default 1), unit_price (number), amount (number) }
- total: the total amount
- notes: any additional notes

Return ONLY valid JSON, no explanation. Use null for missing values.

OCR TEXT:
${ocrText.slice(0, 8000)}` }],
          max_tokens: 4000,
        }),
      });
      const data = await resp.json() as any;
      const raw = data.choices?.[0]?.message?.content || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {}
  }

  // Match or create customer
  let customerId: string | null = null;
  const customerName = parsed?.customer_name || null;
  const customerEmail = parsed?.customer_email || null;
  if (customerEmail) {
    const c = await db.prepare('SELECT id FROM customers WHERE user_id = ? AND email = ?').bind(userId, customerEmail).first<{ id: string }>();
    if (c) customerId = c.id;
  }
  if (!customerId && customerName) {
    const c = await db.prepare('SELECT id FROM customers WHERE user_id = ? AND name LIKE ?').bind(userId, `%${customerName}%`).first<{ id: string }>();
    if (c) customerId = c.id;
  }
  if (!customerId && customerName) {
    customerId = `c-${uuidv4().slice(0, 8)}`;
    await db.prepare('INSERT INTO customers (id, user_id, name, email, is_active) VALUES (?, ?, ?, ?, 1)')
      .bind(customerId, userId, customerName, customerEmail || null).run();
  }
  if (!customerId) return { success: false, error: 'Could not identify customer from invoice' };

  // Calculate totals
  const items: any[] = (parsed?.items || []).map((it: any, i: number) => ({
    description: it.description || 'Item',
    quantity: it.quantity || 1,
    unit_price: it.unit_price || 0,
    amount: it.amount || ((it.quantity || 1) * (it.unit_price || 0)),
    sort_order: i,
  }));
  if (items.length === 0) {
    // Single-item fallback from total
    const total = parsed?.total || parseFloat(ocrText.match(/(?:total|合計|金額)[^\d]*([\d,]+\.?\d*)/i)?.[1]?.replace(/,/g, '') || '0') || 0;
    if (total > 0) {
      items.push({ description: 'Invoice item', quantity: 1, unit_price: total, amount: total, sort_order: 0 });
    }
  }
  if (items.length === 0) return { success: false, error: 'No line items found in invoice' };

  const subtotal = items.reduce((s: number, it: any) => s + it.amount, 0);
  const total = parsed?.total || subtotal;
  const invNumber = parsed?.invoice_number || `INV-${Date.now().toString(36).toUpperCase()}`;
  const issueDate = parsed?.issue_date || new Date().toISOString().split('T')[0];
  const dueDate = parsed?.due_date || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const direction = fileRow.direction || (parsed?.customer_name ? 'outgoing' : 'incoming');

  // Check for duplicate invoice number
  const existing = await db.prepare('SELECT id FROM invoices WHERE user_id = ? AND invoice_number = ?').bind(userId, invNumber).first<{ id: string }>();
  if (existing) return { success: false, error: `Invoice ${invNumber} already exists`, invoice_id: existing.id };

  const invId = `i-${uuidv4().slice(0, 8)}`;
  await db.prepare(
    `INSERT INTO invoices (id, user_id, invoice_number, customer_id, status, issue_date, due_date, subtotal, total, currency, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(invId, userId, invNumber, customerId, 'draft', issueDate, dueDate, subtotal, total, parsed?.currency || 'HKD', parsed?.notes || null).run();

  for (const item of items) {
    await db.prepare(
      'INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(`ii-${uuidv4().slice(0, 8)}`, invId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order).run();
  }

  // Update file record
  await db.prepare(
    "UPDATE file_records SET category = 'invoice', direction = ?, payment_status = 'unmatched', amount = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(direction, total, fileId).run();

  return { success: true, invoice_id: invId, items_count: items.length };
}

// Extract the largest dollar amount from OCR text
function extractAmount(ocrText: string): number | null {
  const amounts: number[] = [];
  // Match patterns like $10,000.00 or HKD 10000 or 10,000.00
  for (const match of ocrText.matchAll(/(?:\$|HKD|HK\$)\s*([\d,]+\.?\d*)/gi)) {
    const n = parseFloat(match[1].replace(/,/g, ''));
    if (n > 0) amounts.push(n);
  }
  // Also match "Total: 10,000.00" patterns
  for (const match of ocrText.matchAll(/(?:total|金額|金額|合計|合计|amount)\s*[:：]?\s*([\d,]+\.?\d*)/gi)) {
    const n = parseFloat(match[1].replace(/,/g, ''));
    if (n > 0) amounts.push(n);
  }
  if (amounts.length === 0) return null;
  // Return the largest amount (likely the total)
  return Math.max(...amounts);
}

const files = new Hono<{ Bindings: Bindings; Variables: Variables }>();
files.use('*', authMiddleware);

// Auto-classify file based on filename patterns
function classifyFile(filename: string, fileType: string, ocrText?: string): { folder: string; category: string; direction?: string } {
  const name = filename.toLowerCase();
  const type = fileType.toLowerCase();

  // Bank statements
  if (/hsbc|bank|statement|月結單|月结单|bank\s*statement|eStatement/i.test(name)) {
    return { folder: 'Bank Statements', category: 'bank_statement' };
  }
  // Business Registration
  if (/br[^a-z]|business\s*reg|商業登記|商业登记|biz\s*reg/i.test(name)) {
    return { folder: 'Business Registration', category: 'br' };
  }
  // Certificate of Incorporation
  if (/ci[^a-z]|incorporation|公司註冊|公司注册|inc\s*cert/i.test(name)) {
    return { folder: 'Company Incorporation', category: 'ci' };
  }
  // Employee Insurance
  if (/ei[^a-z]|insurance|勞工保險|劳工保险|employee\s*insurance|ec\s*insurance/i.test(name)) {
    return { folder: 'Insurance', category: 'ei' };
  }
  // Employment Contract
  if (/employment|雇傭|雇佣|僱傭|staff\s*contract|labour\s*contract|labor\s*contract/i.test(name)) {
    return { folder: 'Employment Contracts', category: 'ec' };
  }
  // Telecom Contract
  if (/telecom|電信|电信|broadband|寬頻|宽频|mobile\s*plan|上網|上网/i.test(name)) {
    return { folder: 'Telecom Contracts', category: 'tc' };
  }
  // Rental Lease
  if (/rental|lease|tenancy|租約|租约|租單|租单|tenancy\s*agreement|lease\s*agreement/i.test(name)) {
    return { folder: 'Rental Leases', category: 'rl' };
  }
  // Invoices — try to detect direction from OCR text
  if (/invoice|發票|发票|inv[_-]?\d/i.test(name)) {
    let direction: string | undefined;
    const txt = (ocrText || '').toUpperCase();
    // If OCR mentions "payment" or "bill to" or common purchase patterns, it's incoming
    if (/BILL\s*TO|PURCHASE|PAYMENT\s*DUE|AMOUNT\s*DUE|供應商|供應商發票/i.test(txt)) {
      direction = 'incoming';
    } else if (/RECEIPT|收據|PAYMENT\s*RECEIVED|已收款/i.test(txt)) {
      direction = 'outgoing';
    }
    return { folder: 'Invoices', category: 'invoice', direction };
  }
  // Receipts
  if (/receipt|收據|收据/i.test(name)) {
    return { folder: 'Receipts', category: 'receipt' };
  }
  // Contracts
  if (/contract|agreement|合約|合同|合约/i.test(name)) {
    return { folder: 'Contracts', category: 'contract' };
  }
  // PDFs
  if (type.includes('pdf')) {
    return { folder: 'Documents', category: 'document' };
  }
  // Images
  if (type.includes('image')) {
    return { folder: 'Images', category: 'image' };
  }
  // Spreadsheets
  if (type.includes('sheet') || type.includes('excel') || type.includes('xls') || name.endsWith('.csv')) {
    return { folder: 'Spreadsheets', category: 'spreadsheet' };
  }

  return { folder: 'General', category: 'general' };
}

// Run OCR via Cloudflare AI for PDFs and images
async function runOcr(fileData: string, fileType: string, ai: any): Promise<{ text: string; status: string }> {
  if (!ai) return { text: '', status: 'pending' };

  const isOcrCandidate = fileType.includes('pdf') || fileType.includes('image') || fileType.includes('png') || fileType.includes('jpg') || fileType.includes('jpeg');
  if (!isOcrCandidate) return { text: '', status: 'skipped' };

  try {
    const cleanBase64 = fileData.replace(/^data:.*?;base64,/, '');
    const aiResponse = await ai.run('@cf/unum/uform-gen2-qwen-500m', {
      prompt: 'Extract all visible text from this document. Identify document type (invoice/receipt/bank statement/certificate/contract), dates, amounts, company names, and document numbers.',
      image: cleanBase64,
    });
    const text = (aiResponse as any)?.description || '';
    return { text, status: text.length > 10 ? 'completed' : 'unclear' };
  } catch {
    return { text: '', status: 'failed' };
  }
}

// List files with optional folder filter and search
files.get('/', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const folder = c.req.query('folder') || '';
  const q = c.req.query('q') || '';

  let sql = 'SELECT id, folder, filename, original_name, file_type, file_size, description, ocr_status, category, direction, payment_status, amount, created_at, updated_at FROM file_records WHERE user_id = ?';
  const params: unknown[] = [user.id];

  if (folder) {
    sql += ' AND folder = ?';
    params.push(folder);
  }
  if (q) {
    sql += ' AND (filename LIKE ? OR description LIKE ? OR ocr_text LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY created_at DESC';

  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ data: rows.results });
});

// List distinct folder names
files.get('/folders', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const rows = await c.env.DB.prepare(
    'SELECT DISTINCT folder FROM file_records WHERE user_id = ? ORDER BY folder'
  ).bind(tenantId).all();
  return c.json({ data: rows.results.map(r => r.folder) });
});

// Get files with issues (for nav badge)
files.get('/issues', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM file_records WHERE user_id = ? AND ocr_status IN ('failed', 'unclear')"
  ).bind(tenantId).first<{ count: number }>();
  return c.json({ issues: row?.count || 0 });
});

// Upload file to R2 + store metadata in D1
files.post('/upload', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const body = await c.req.json();
  const { filename, original_name, file_type, file_size, file_data, folder: reqFolder, description } = body;

  if (!file_data) return c.json({ error: 'file_data required (base64)' }, 400);

  const id = `fs-${uuidv4().slice(0, 8)}`;
  const safeName = original_name || filename || 'untitled';
  const r2Key = `${tenantId}/${id}-${safeName}`;
  const displayName = filename || safeName;

  // Auto-classify
  const classification = classifyFile(safeName, file_type || '');
  const folder = reqFolder || classification.folder;

  // Run OCR
  const ocrResult = await runOcr(file_data, file_type || '', c.env.AI);
  const ocrDirection = classifyFile(safeName, file_type || '', ocrResult.text).direction || classification.direction;
  const ocrAmount = classification.category === 'invoice' ? extractAmount(ocrResult.text) : null;

  const cleanBase64 = file_data.replace(/^data:.*?;base64,/, '');
  const binary = Uint8Array.from(atob(cleanBase64), ch => ch.charCodeAt(0));

  await c.env.FILE_BUCKET.put(r2Key, binary, {
    httpMetadata: { contentType: file_type || 'application/octet-stream' },
    customMetadata: { originalName: safeName, userId: user.id },
  });

  await c.env.DB.prepare(
    `INSERT INTO file_records (id, user_id, folder, filename, original_name, file_type, file_size, r2_key, description, ocr_text, ocr_status, category, direction, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, folder, displayName, safeName,
    file_type || 'application/octet-stream', file_size || binary.byteLength,
    r2Key, description || '', ocrResult.text, ocrResult.status, classification.category,
    ocrDirection || null, ocrAmount).run();

  const row = await c.env.DB.prepare(
    'SELECT id, folder, filename, original_name, file_type, file_size, description, ocr_status, category, created_at FROM file_records WHERE id = ?'
  ).bind(id).first();

  // Notify OCR worker via WebSocket
  try {
    wsBroadcast(user.id, { type: 'ocr_request', file_id: id, filename: displayName, file_type: file_type || 'application/octet-stream', folder: folder, category: classification.category });
  } catch { /* WebSocket not available */ }

  // Auto-import bank statements with dual OCR
  if (classification.category === 'bank_statement') {
    c.executionCtx.waitUntil((async () => {
      try {
        // Mark as processing
        await c.env.DB.prepare("UPDATE file_records SET ocr_status = 'processing', updated_at = datetime('now') WHERE id = ?")
          .bind(id).run();

        // Path A: Import using pdftotext OCR
        const importResult = await importStatementFromFile(id, user.id, c.env.DB, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY);

        // Path B: Run GLM-OCR in background for cross-validation
        if (importResult.success && c.env.DEEPSEEK_API_KEY) {
          try {
            const obj = await c.env.FILE_BUCKET.get(r2Key);
            if (obj) {
              const buffer = await obj.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              let binary = '';
              for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
              const base64 = btoa(binary);

              const glmResp = await fetch('https://api.z.ai/api/paas/v4/layout_parsing', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer bc604bbc774c49528e8615564aa51ea3.f0Hzibmlxdd5bKGZ',
                },
                body: JSON.stringify({ model: 'glm-ocr', file: `data:${file_type || 'application/pdf'};base64,${base64}` }),
              });

              if (glmResp.ok) {
                const glmData = await glmResp.json() as any;
                const glmText = JSON.stringify(glmData);
                // Store full GLM-OCR in file_records
                await c.env.DB.prepare(
                  "UPDATE file_records SET ocr_text = ?, ocr_status = 'completed' WHERE id = ?"
                ).bind(glmText.slice(0, 50000), id).run();
                // Also update linked bank_statement
                await c.env.DB.prepare(
                  "UPDATE bank_statements SET ocr_text = ? WHERE r2_key = ?"
                ).bind(glmText.slice(0, 50000), r2Key).run();
              }
            }
          } catch { /* GLM-OCR is supplementary */ }
        }

        // Mark as completed
        await c.env.DB.prepare("UPDATE file_records SET ocr_status = 'completed', updated_at = datetime('now') WHERE id = ?")
          .bind(id).run();
      } catch (e) {
        await c.env.DB.prepare("UPDATE file_records SET ocr_status = 'failed', updated_at = datetime('now') WHERE id = ?")
          .bind(id).run();
      }
    })());
  }

  // Auto-import invoices with dual OCR
  if (classification.category === 'invoice') {
    c.executionCtx.waitUntil((async () => {
      try {
        await c.env.DB.prepare("UPDATE file_records SET ocr_status = 'processing', updated_at = datetime('now') WHERE id = ?")
          .bind(id).run();

        // Try GLM-OCR first for better invoice recognition
        let ocrText = ocrResult.text || '';
        if (c.env.DEEPSEEK_API_KEY) {
          try {
            const obj = await c.env.FILE_BUCKET.get(r2Key);
            if (obj) {
              const buffer = await obj.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              let binary = '';
              for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
              const base64 = btoa(binary);

              const glmResp = await fetch('https://api.z.ai/api/paas/v4/layout_parsing', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer bc604bbc774c49528e8615564aa51ea3.f0Hzibmlxdd5bKGZ',
                },
                body: JSON.stringify({ model: 'glm-ocr', file: `data:${file_type || 'application/pdf'};base64,${base64}` }),
              });
              if (glmResp.ok) {
                const glmData = await glmResp.json() as any;
                ocrText = JSON.stringify(glmData);
                await c.env.DB.prepare(
                  "UPDATE file_records SET ocr_text = ?, ocr_status = 'completed' WHERE id = ?"
                ).bind(ocrText.slice(0, 10000), id).run();
              }
            }
          } catch { /* GLM-OCR fallback */ }
        }

        // If we have OCR text, try to import
        if (ocrText && ocrText.length > 20) {
          await importInvoiceFromFile(id, user.id, c.env.DB, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY);
        }

        await c.env.DB.prepare("UPDATE file_records SET ocr_status = 'completed', updated_at = datetime('now') WHERE id = ?")
          .bind(id).run();
      } catch (e) {
        await c.env.DB.prepare("UPDATE file_records SET ocr_status = 'failed', updated_at = datetime('now') WHERE id = ?")
          .bind(id).run();
      }
    })());
  }

  return c.json(row, 201);
});

// Batch upload multiple files
files.post('/upload-batch', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const body = await c.req.json();
  const { files: fileList, folder: batchFolder, description: batchDesc } = body as {
    files: { filename: string; original_name?: string; file_type?: string; file_size?: number; file_data: string }[];
    folder?: string;
    description?: string;
  };

  if (!Array.isArray(fileList) || fileList.length === 0) {
    return c.json({ error: 'files array required' }, 400);
  }

  const results = [];
  for (const f of fileList) {
    if (!f.file_data) continue;

    const id = `fs-${uuidv4().slice(0, 8)}`;
    const safeName = f.original_name || f.filename || 'untitled';
    const r2Key = `${tenantId}/${id}-${safeName}`;
    const displayName = f.filename || safeName;

    const classification = classifyFile(safeName, f.file_type || '');
    const folder = batchFolder || classification.folder;

    const ocrResult = await runOcr(f.file_data, f.file_type || '', c.env.AI);

    const cleanBase64 = f.file_data.replace(/^data:.*?;base64,/, '');
    const binary = Uint8Array.from(atob(cleanBase64), ch => ch.charCodeAt(0));

    await c.env.FILE_BUCKET.put(r2Key, binary, {
      httpMetadata: { contentType: f.file_type || 'application/octet-stream' },
      customMetadata: { originalName: safeName, userId: user.id },
    });

    await c.env.DB.prepare(
      `INSERT INTO file_records (id, user_id, folder, filename, original_name, file_type, file_size, r2_key, description, ocr_text, ocr_status, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, user.id, folder, displayName, safeName,
      f.file_type || 'application/octet-stream', f.file_size || binary.byteLength,
      r2Key, batchDesc || '', ocrResult.text, ocrResult.status, classification.category).run();

    results.push({ id, filename: displayName, folder, ocr_status: ocrResult.status, category: classification.category });

    // Auto-import bank statements
    if (classification.category === 'bank_statement' && ocrResult.status === 'completed') {
      c.executionCtx.waitUntil(
        importStatementFromFile(id, user.id, c.env.DB, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY)
      );
    }

    // Auto-import invoices
    if (classification.category === 'invoice') {
      c.executionCtx.waitUntil((async () => {
        try {
          const obj = await c.env.FILE_BUCKET.get(r2Key);
          if (obj) {
            const buffer = await obj.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            const base64 = btoa(binary);

            const glmResp = await fetch('https://api.z.ai/api/paas/v4/layout_parsing', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer bc604bbc774c49528e8615564aa51ea3.f0Hzibmlxdd5bKGZ',
              },
              body: JSON.stringify({ model: 'glm-ocr', file: `data:${f.file_type || 'application/pdf'};base64,${base64}` }),
            });
            if (glmResp.ok) {
              const glmData = await glmResp.json() as any;
              await c.env.DB.prepare(
                "UPDATE file_records SET ocr_text = ?, ocr_status = 'completed' WHERE id = ?"
              ).bind(JSON.stringify(glmData).slice(0, 10000), id).run();
            }
          }
        } catch {}
        await importInvoiceFromFile(id, user.id, c.env.DB, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY);
      })());
    }
  }

  return c.json({ uploaded: results.length, files: results }, 201);
});

// Get file metadata
files.get('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const row = await c.env.DB.prepare(
    'SELECT id, folder, filename, original_name, file_type, file_size, description, ocr_text, ocr_status, category, direction, payment_status, amount, created_at, updated_at FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(c.req.param('id'), tenantId).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

// Download from R2
files.get('/:id/download', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const row = await c.env.DB.prepare(
    'SELECT r2_key, file_type, original_name, filename FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(c.req.param('id'), tenantId).first();
  if (!row) return c.json({ error: 'Not found' }, 404);

  const obj = await c.env.FILE_BUCKET.get(row.r2_key as string);
  if (!obj) return c.json({ error: 'File not found in storage' }, 404);

  const downloadName = (row.original_name || row.filename || 'file') as string;
  return new Response(obj.body, {
    headers: {
      'Content-Type': (row.file_type as string) || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
      'Content-Length': obj.size.toString(),
    },
  });
});

// Update metadata (rename, move folder, change description)
files.patch('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT id FROM file_records WHERE id = ? AND user_id = ?')
    .bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const allowedFields = ['filename', 'folder', 'description'];
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (allowedFields.includes(k)) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(id, tenantId);

  await c.env.DB.prepare(`UPDATE file_records SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...params).run();

  const row = await c.env.DB.prepare(
    'SELECT id, folder, filename, original_name, file_type, file_size, description, ocr_status, category, created_at, updated_at FROM file_records WHERE id = ?'
  ).bind(id).first();
  return c.json(row);
});

// Delete from R2 + D1
files.delete('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const existing = await c.env.DB.prepare(
    'SELECT id, r2_key FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(c.req.param('id'), tenantId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.FILE_BUCKET.delete(existing.r2_key as string);
  await c.env.DB.prepare('DELETE FROM file_records WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), tenantId).run();
  return c.json({ success: true });
});

// Run OCR via DeepSeek Vision API (supports images and PDFs)
async function runDeepseekOcr(base64: string, mimeType: string, apiKey: string): Promise<{ text: string; status: string }> {
  const dataUri = `data:${mimeType};base64,${base64}`;
  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Extract all visible text from this document. Return: document type, dates, amounts, company names, invoice numbers, item descriptions. Be thorough.' },
            { type: 'image_url', image_url: { url: dataUri } },
          ],
        }],
        max_tokens: 2000,
      }),
    });
    if (!resp.ok) return { text: '', status: 'failed' };
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content || '';
    return { text, status: text.length > 10 ? 'completed' : 'unclear' };
  } catch {
    return { text: '', status: 'failed' };
  }
}

// Reprocess files with pending/missing OCR or classification
files.post('/reprocess', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;

  const rows = await db.prepare(
    "SELECT id, r2_key, filename, original_name, file_type FROM file_records WHERE user_id = ? AND (ocr_status IN ('pending','skipped','failed') OR category = '' OR category IS NULL) LIMIT 50"
  ).bind(tenantId).all();

  let processed = 0;
  let failed = 0;

  for (const row of (rows.results || []) as { id: string; r2_key: string; filename: string; original_name: string; file_type: string }[]) {
    try {
      const classification = classifyFile(row.original_name || row.filename, row.file_type);

      const isOcrCandidate = (row.file_type || '').includes('pdf') || (row.file_type || '').includes('image') || (row.file_type || '').includes('png') || (row.file_type || '').includes('jpg') || (row.file_type || '').includes('jpeg');

      let ocrText = '';
      let ocrStatus = 'skipped';

      if (isOcrCandidate) {
        const obj = await c.env.FILE_BUCKET.get(row.r2_key);
        if (obj && obj.size <= 10 * 1024 * 1024) {
          const buffer = await obj.arrayBuffer();
          const bytes = new Uint8Array(buffer);

          if ((row.file_type || '').includes('pdf')) {
            // PDF: can't extract text in Workers (no DOM), mark as skipped
            ocrStatus = 'skipped';
          } else {
            // Image: use DeepSeek vision
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            if (c.env.DEEPSEEK_API_KEY) {
              const result = await runDeepseekOcr(base64, row.file_type || 'image/png', c.env.DEEPSEEK_API_KEY);
              ocrText = result.text;
              ocrStatus = result.status;
            } else if (c.env.AI) {
              const result = await runOcr(`data:${row.file_type};base64,${base64}`, row.file_type, c.env.AI);
              ocrText = result.text;
              ocrStatus = result.status;
            }
          }
        }
      }

      await db.prepare(
        "UPDATE file_records SET ocr_text = ?, ocr_status = ?, category = ?, folder = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
      ).bind(ocrText, ocrStatus, classification.category, classification.folder, row.id, tenantId).run();

      processed++;
    } catch {
      failed++;
    }
  }

  return c.json({ processed, failed, total: (rows.results || []).length });
});

// Docker OCR worker updates OCR results for a file
files.post('/:id/ocr-result', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.json();
  const { ocr_text, ocr_status, category, folder } = body as { ocr_text?: string; ocr_status?: string; category?: string; folder?: string };

  const existing = await db.prepare('SELECT id FROM file_records WHERE id = ? AND user_id = ?')
    .bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const sets: string[] = [];
  const params: unknown[] = [];
  if (ocr_text !== undefined) { sets.push('ocr_text = ?'); params.push(ocr_text); }
  if (ocr_status !== undefined) { sets.push('ocr_status = ?'); params.push(ocr_status); }
  if (category !== undefined) { sets.push('category = ?'); params.push(category); }
  if (folder !== undefined) { sets.push('folder = ?'); params.push(folder); }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(id, tenantId);

  await db.prepare(`UPDATE file_records SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  const row = await db.prepare('SELECT id, filename, ocr_status, ocr_text, category, folder FROM file_records WHERE id = ?').bind(id).first();

  // Auto-import bank statements / invoices when Docker worker provides good OCR
  const updatedCategory = category || (row as any)?.category || '';
  const updatedOcrStatus = ocr_status || (row as any)?.ocr_status || '';
  if ((updatedCategory === 'bank_statement' || updatedCategory === 'bank') && updatedOcrStatus === 'completed') {
    c.executionCtx.waitUntil(
      importStatementFromFile(id, user.id, db, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY)
    );
  }
  if (updatedCategory === 'invoice' && updatedOcrStatus === 'completed') {
    c.executionCtx.waitUntil(
      importInvoiceFromFile(id, user.id, db, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY)
    );
  }

  return c.json(row);
});

// Import a file as a bank statement (OCR + AI parse → bank_statement + bank_transactions)
files.post('/:id/import-statement', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const result = await importStatementFromFile(
    c.req.param('id'), user.id, c.env.DB, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY
  );
  if (!result.success) {
    const status = result.error === 'File not found' ? 404 : result.error === 'Statement already imported' ? 409 : 422;
    return c.json({ error: result.error, statement_id: result.statement_id }, status as any);
  }
  return c.json(result, 201);
});

// Import a file as an invoice (OCR + AI parse → invoice + invoice_items)
files.post('/:id/import-invoice', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const result = await importInvoiceFromFile(
    c.req.param('id'), user.id, c.env.DB, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY
  );
  if (!result.success) {
    const status = result.error === 'File not found' ? 404 : result.error?.includes('already exists') ? 409 : 422;
    return c.json({ error: result.error, invoice_id: result.invoice_id }, status as any);
  }
  return c.json(result, 201);
});

// ── Auto-match invoice files with bank transactions ──
files.post('/auto-match-invoices', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const db = c.env.DB;

  // Get unmatched invoice files with amounts
  const invoiceFiles = await db.prepare(
    `SELECT id, filename, original_name, ocr_text, direction, amount, category
     FROM file_records
     WHERE user_id = ? AND category = 'invoice' AND payment_status = 'unmatched' AND amount IS NOT NULL AND amount > 0`
  ).bind(tenantId).all();

  // Get unmatched bank transactions
  const deposits = await db.prepare(
    `SELECT id, transaction_date, description, deposit_amount
     FROM bank_transactions WHERE user_id = ? AND deposit_amount > 0 AND match_status = 'unmatched'`
  ).bind(tenantId).all();

  const withdrawals = await db.prepare(
    `SELECT id, transaction_date, description, withdrawal_amount
     FROM bank_transactions WHERE user_id = ? AND withdrawal_amount > 0 AND match_status = 'unmatched'`
  ).bind(tenantId).all();

  const matched: any[] = [];

  for (const file of invoiceFiles.results as any[]) {
    const isOutgoing = file.direction === 'outgoing' || !file.direction;
    const candidates = isOutgoing ? deposits.results : withdrawals.results;
    const amountKey = isOutgoing ? 'deposit_amount' : 'withdrawal_amount';
    const newStatus = isOutgoing ? 'received' : 'paid';

    for (const tx of candidates as any[]) {
      if (Math.abs(file.amount - tx[amountKey]) < 0.01) {
        await db.prepare(
          `UPDATE file_records SET payment_status = ? WHERE id = ?`
        ).bind(newStatus, file.id).run();

        matched.push({
          file_id: file.id,
          filename: file.original_name || file.filename,
          direction: isOutgoing ? 'outgoing' : 'incoming',
          amount: file.amount,
          transaction_id: tx.id,
          transaction_date: tx.transaction_date,
          new_status: newStatus,
        });
        break;
      }
    }
  }

  return c.json({ matched, unmatched: (invoiceFiles.results as any[]).length - matched.length });
});

// ── Update file direction manually ──
files.patch('/:id/direction', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const id = c.req.param('id');
  const { direction } = await c.req.json();
  if (!['outgoing', 'incoming'].includes(direction)) {
    return c.json({ error: 'direction must be outgoing or incoming' }, 400);
  }
  await c.env.DB.prepare(
    'UPDATE file_records SET direction = ? WHERE id = ? AND user_id = ?'
  ).bind(direction, id, tenantId).run();
  return c.json({ success: true });
});

// DeepSeek Vision OCR — send images to DeepSeek Chat (supports vision)
files.post('/deepseek-vision', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { images, prompt } = body as { images: string[]; prompt?: string };

  if (!images || images.length === 0) return c.json({ error: 'images array required (base64 data URIs)' }, 400);

  const defaultPrompt = `Extract all visible text from this bank statement. Return the data as JSON with:
- bank_name, account_number, statement_period (YYY-MM-DD to YYY-MM-DD)
- opening_balance (number), closing_balance (number)
- transactions: array of { transaction_date (YYY-MM-DD), description, deposit_amount (number, 0 if withdrawal), withdrawal_amount (number, 0 if deposit), balance (number or null) }
Return ONLY the JSON object, no other text.`;

  const content: any[] = [{ type: 'text', text: prompt || defaultPrompt }];
  for (const img of images) {
    content.push({ type: 'image_url', image_url: { url: img } });
  }

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content }], max_tokens: 4000 }),
    });
    const respText = await resp.text();
    let data: any;
    try { data = JSON.parse(respText); } catch { data = { parse_error: true, raw: respText.slice(0, 1000) }; }

    if (!resp.ok) {
      return c.json({ error: 'DeepSeek API error', status: resp.status, detail: data }, 502);
    }

    const raw = data.choices?.[0]?.message?.content || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    return c.json({ success: true, data: parsed, raw, usage: data.usage });
  } catch (e: any) {
    return c.json({ error: 'DeepSeek Vision failed: ' + (e.message || 'unknown') }, 500);
  }
});

// Z.AI GLM-OCR proxy — dedicated OCR model, supports PDF and images
files.post('/glm-ocr', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { file_data, file_url } = body as { file_data?: string; file_url?: string };

  if (!file_data && !file_url) return c.json({ error: 'file_data (base64) or file_url required' }, 400);

  try {
    const requestBody: any = { model: 'glm-ocr' };
    if (file_url) {
      requestBody.file = file_url;
    } else {
      requestBody.file = file_data;
    }

    const resp = await fetch('https://api.z.ai/api/paas/v4/layout_parsing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer bc604bbc774c49528e8615564aa51ea3.f0Hzibmlxdd5bKGZ',
      },
      body: JSON.stringify(requestBody),
    });
    const respText = await resp.text();
    let data: any;
    try { data = JSON.parse(respText); } catch { data = { raw: respText }; }

    if (!resp.ok) {
      return c.json({ error: 'GLM-OCR API error', status: resp.status, detail: data }, 502);
    }

    return c.json({ success: true, data });
  } catch (e: any) {
    return c.json({ error: 'GLM-OCR failed: ' + (e.message || 'unknown') }, 500);
  }
});

// Run GLM-OCR on an uploaded file (downloads from R2, sends to Z.AI)
files.post('/:id/glm-ocr', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const fileRow = await c.env.DB.prepare(
    'SELECT id, r2_key, filename, original_name, file_type, ocr_text FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first<{ id: string; r2_key: string; filename: string; original_name: string; file_type: string; ocr_text: string }>();
  if (!fileRow) return c.json({ error: 'File not found' }, 404);

  const obj = await c.env.FILE_BUCKET.get(fileRow.r2_key);
  if (!obj) return c.json({ error: 'File not found in storage' }, 404);

  const buffer = await obj.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  try {
    const resp = await fetch('https://api.z.ai/api/paas/v4/layout_parsing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer bc604bbc774c49528e8615564aa51ea3.f0Hzibmlxdd5bKGZ',
      },
      body: JSON.stringify({ model: 'glm-ocr', file: `data:${fileRow.file_type || 'application/pdf'};base64,${base64}` }),
    });
    const respText = await resp.text();
    let data: any;
    try { data = JSON.parse(respText); } catch { data = { raw: respText }; }

    if (!resp.ok) {
      return c.json({ error: 'GLM-OCR API error', status: resp.status, detail: data }, 502);
    }

    // Save OCR result to file_records (full GLM-OCR JSON)
    const ocrText = typeof data === 'string' ? data : JSON.stringify(data);
    await c.env.DB.prepare(
      "UPDATE file_records SET ocr_text = ?, ocr_status = 'completed', updated_at = datetime('now') WHERE id = ?"
    ).bind(ocrText.slice(0, 50000), id).run();

    // Also update linked bank_statement ocr_text
    await c.env.DB.prepare(
      "UPDATE bank_statements SET ocr_text = ?, updated_at = datetime('now') WHERE r2_key = (SELECT r2_key FROM file_records WHERE id = ?)"
    ).bind(ocrText.slice(0, 50000), id).run();

    return c.json({ success: true, file_id: id, ocr_result: data });
  } catch (e: any) {
    return c.json({ error: 'GLM-OCR failed: ' + (e.message || 'unknown') }, 500);
  }
});

export { files as fileStorageRoutes };
