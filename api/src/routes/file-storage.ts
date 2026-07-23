import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware, requireHigherTier } from '../middleware/auth';
import { wsBroadcast } from './ws';
import { processBankStatement, extractCompanyInfo, extractBankInfo } from '../lib/bank-ocr';

// Audit logging helper
async function auditLog(db: any, userId: string, action: string, entityType: string, entityId: string | null, changes?: object) {
  try {
    await db.prepare(
      'INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, changes) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(`al-${uuidv4().slice(0,8)}`, userId, action, entityType, entityId, changes ? JSON.stringify(changes) : null).run();
  } catch { /* never block main flow for audit errors */ }
}

// Bank name detection fallback from OCR text and/or filename.
// (Lily issues #1 and #9 — bank name not detected, especially HSBC.)
function inferBankName(...texts: (string | null | undefined)[]): string | null {
  const combined = texts.filter(Boolean).join(' ').toUpperCase();
  if (/HSBC|匯豐|汇丰/.test(combined)) return 'HSBC';
  if (/STANDARD\s*CHARTERED|渣打/.test(combined)) return 'Standard Chartered';
  if (/HANG\s*SENG|恆生|恒生/.test(combined)) return 'Hang Seng Bank';
  if (/BANK\s*OF\s*CHINA|BOC\s*HK|中國銀行|中银/.test(combined)) return 'Bank of China (HK)';
  if (/CITIBANK|花旗/.test(combined)) return 'Citibank';
  if (/\bDBS\b|星展/.test(combined)) return 'DBS';
  if (/CITIC|中信/.test(combined)) return 'China CITIC Bank';
  if (/DAH\s*SING|大新/.test(combined)) return 'Dah Sing Bank';
  return null;
}

// Account number detection fallback from OCR text.
// (Lily issue #6 — account number not detected.)
function inferAccountNumber(ocrText: string | null | undefined): string | null {
  if (!ocrText) return null;
  const m = ocrText.match(/\b\d{3,4}[- ]\d{1,10}[- ]\d{1,4}\b/);
  return m ? m[0].replace(/\s/g, '-') : null;
}

// Shared import: file_record → bank_statement + bank_transactions
async function importStatementFromFile(
  fileId: string, userId: string, db: D1Database, fileBucket: R2Bucket, ai: any, deepseekKey: string, glmApiKey?: string,
): Promise<{ success: boolean; statement_id?: string; error?: string; transactions_count?: number; parsed_via_ai?: boolean; ocr_failed?: boolean; duplicate_info?: { type?: string; bank_name: string | null; period: string | null; file_name: string | null } }> {
  const fileRow = await db.prepare(
    'SELECT id, r2_key, filename, original_name, file_type, ocr_text, ocr_status, category FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(fileId, userId).first<{ id: string; r2_key: string; filename: string; original_name: string; file_type: string; ocr_text: string; ocr_status: string; category: string }>();
  if (!fileRow) return { success: false, error: 'File not found' };

  // Check if a bank_statement already exists for this file (ignoring soft-deleted ones)
  const existing = await db.prepare(
    'SELECT id, bank_name, period_start, period_end, file_name FROM bank_statements WHERE user_id = ? AND r2_key = ? AND deleted_at IS NULL'
  ).bind(userId, fileRow.r2_key).first<{ id: string; bank_name: string | null; period_start: string | null; period_end: string | null; file_name: string | null }>();
  if (existing) return {
    success: false,
    error: 'Statement already imported',
    statement_id: existing.id,
    duplicate_info: {
      type: 'bank_statement',
      bank_name: existing.bank_name,
      period: existing.period_start && existing.period_end ? `${existing.period_start} – ${existing.period_end}` : null,
      file_name: existing.file_name,
    },
  };

  // Get OCR text from file record or run GLM-OCR
  let ocrText = fileRow.ocr_text || '';
  if (!ocrText || ocrText.length < 20) {
    const obj = await fileBucket.get(fileRow.r2_key);
    if (obj) {
      const buffer = await obj.arrayBuffer();
      const mimeType = fileRow.file_type || 'application/pdf';

      // Attempt 1: GLM-OCR — best for all PDFs
      if (glmApiKey) {
        try {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const base64 = btoa(binary);
          const glmResp = await fetch('https://api.z.ai/api/paas/v4/layout_parsing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${glmApiKey}` },
            body: JSON.stringify({ model: 'glm-ocr', file: `data:${mimeType};base64,${base64}` }),
          });
          if (glmResp.ok) {
            const glmData = await glmResp.json() as any;
            ocrText = typeof glmData === 'string' ? glmData : JSON.stringify(glmData);
          }
        } catch {}
        if (ocrText) {
          await db.prepare("UPDATE file_records SET ocr_text = ?, ocr_status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(ocrText, fileId).run();
        }
      }

      // Attempt 2: Cloudflare AI toMarkdown — fast free fallback
      if ((!ocrText || ocrText.length < 20) && ai) {
        try {
          const mdResult = await (ai as any).toMarkdown([{
            name: fileRow.original_name || fileRow.filename || 'statement.pdf',
            blob: new Blob([buffer], { type: mimeType }),
          }]);
          const candidate = Array.isArray(mdResult) ? mdResult.map((r: any) => r?.data || r?.content || '').join('\n') : String(mdResult || '');
          if (candidate && candidate.length > 20) ocrText = candidate;
        } catch {}
        if (ocrText && ocrText.length >= 20) {
          await db.prepare("UPDATE file_records SET ocr_text = ?, ocr_status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(ocrText, fileId).run();
        }
      }
    }
  }

  if (!ocrText || ocrText.length < 10) {
    // OCR could not read the file. Instead of returning an error (which makes the
    // frontend hang on "Processing…"), create an EMPTY draft statement so the user
    // is taken to the review page and can enter transactions manually.
    // (Lily issues #14, #15, #16 — blurry / random / near-empty files hung forever.)
    const emptyId = `bs-${crypto.randomUUID().slice(0, 8)}`;
    const inferredBank = inferBankName(fileRow.original_name || fileRow.filename || '');
    await db.prepare(



    ).bind(emptyId, userId, fileRow.original_name || fileRow.filename, fileRow.r2_key, inferredBank).run();
    return {
      success: true,
      statement_id: emptyId,
      ocr_failed: true,
      error: 'Could not read this file automatically — please enter transactions manually on the review page.',
    };
  }

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
- opening_balance and closing_balance: numbers (opening is the starting balance, closing is the ending balance, for the statement as a whole)
- transactions: array of { transaction_date (YYYY-MM-DD), description, deposit_amount (number, 0 if withdrawal), withdrawal_amount (number, 0 if deposit), balance (number or null), account_type (string or null) }

IMPORTANT — some statements (especially HSBC Business Direct) contain MORE THAN ONE sub-account in the same document, e.g. a "HKD Current" section and a separate "HKD Savings" section, each with its OWN "B/F BALANCE" row and its own running balance column. Treat each such section as a separate ledger:
- Set "account_type" on every transaction to the name of the sub-account/section heading it belongs to (e.g. "HKD Current", "HKD Savings"). Use the exact section heading text from the statement.
- Always include the "B/F BALANCE" row itself as the first transaction of each sub-account (deposit_amount 0, withdrawal_amount 0, balance = the stated opening balance for that sub-account). This row anchors that sub-account's running balance.
- If the statement only has a single account/ledger, set account_type to null for all transactions (or a single consistent value).
- Never mix rows from different sub-accounts into one running sequence — keep them tagged separately via account_type.

IMPORTANT — banks (especially HSBC) often print SEVERAL transaction lines on the same date as one batch, but only print the running "Balance" figure once, next to the LAST line of that batch — the earlier lines in the batch have a blank/empty balance column. This does NOT mean those earlier lines should be skipped, merged into the next line, or given that later line's balance:
- Output EVERY transaction line as its own separate row in "transactions", in the exact order they appear on the statement, even if several rows share the same date and same description prefix.
- If a line has no balance figure printed directly next to it, set that row's "balance" to null. Do NOT copy/borrow the balance from a later or earlier line, and do NOT combine two lines' deposit/withdrawal amounts into a single row.
- Only set "balance" to a number when that exact figure is printed on that exact line.

IMPORTANT — deciding whether a line's amount is a deposit or a withdrawal:
- Judge ONLY by which column (Deposit vs Withdrawal) the number is printed under / aligned with in the original layout. Never infer it from wording in the description such as "CR", "CR TO", "credit", "DR", "debit", etc. — those words describe the OTHER party's account, not this statement's own column, and are frequently misleading (e.g. a line reading "CR TO <account>" is very often actually a WITHDRAWAL from this account, because money is being credited TO the other account, not to this one).
- A figure printed with a trailing "DR" suffix directly attached to it (e.g. "10,500.00DR") means the running balance is NEGATIVE / overdrawn at that point — parse it as a negative number (e.g. -10500.00). Do NOT drop the "DR" suffix and treat it as a positive balance, and do NOT leave "balance" null just because of the suffix — the number itself (minus the DR marker) is exactly the balance figure, just negated.
- Self-check your work continuously down each ledger, not only within same-date batches: keep a running total starting from that ledger's B/F BALANCE (or opening_balance), and every time you reach a line that has a balance printed on it (including a "DR" balance, now correctly negated), verify running total so far equals that printed balance exactly. If it doesn't, you have swapped a deposit/withdrawal or misread a figure somewhere between the previous checkpoint and this line — go back and correct it (checking column alignment and DR suffixes first) so every printed balance reconciles before you return the JSON.

Return ONLY valid JSON, no explanation. If you can't parse something, use null.

OCR TEXT:
${ocrText.slice(0, 16000)}` }],
          max_tokens: 8000,
        }),
      });
      const parseData = await parseResp.json() as any;
      const raw = parseData.choices?.[0]?.message?.content || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {}
  }

  // Cross-file duplicate check: same bank + same period = same statement
  // This catches re-uploads of the same PDF with a different filename (which gets a different r2_key)
  const parsedBankName = parsed?.bank_name || inferBankName(ocrText, fileRow.original_name || fileRow.filename) || null;
  const parsedPeriodStart = parsed?.period_start || null;
  const parsedPeriodEnd = parsed?.period_end || null;
  if (parsedBankName && parsedPeriodStart) {
    const crossDup = await db.prepare(
      'SELECT id, bank_name, period_start, period_end, file_name FROM bank_statements WHERE user_id = ? AND bank_name = ? AND period_start = ? AND deleted_at IS NULL'
    ).bind(userId, parsedBankName, parsedPeriodStart).first<{ id: string; bank_name: string | null; period_start: string | null; period_end: string | null; file_name: string | null }>();
    if (crossDup) {
      return {
        success: false,
        error: 'This statement period already exists',
        statement_id: crossDup.id,
        duplicate_info: {
          type: 'bank_statement',
          bank_name: crossDup.bank_name,
          period: crossDup.period_start && crossDup.period_end ? `${crossDup.period_start} – ${crossDup.period_end}` : null,
          file_name: crossDup.file_name,
        },
      };
    }
  }

  const stmtId = `bs-${uuidv4().slice(0, 8)}`;
  // Bank name: prefer AI parse, else infer from OCR text + filename (Lily #1, #9)
  const bankName = parsed?.bank_name
    || inferBankName(ocrText, fileRow.original_name || fileRow.filename)
    || null;
  // Account number: prefer AI parse, else infer from OCR text (Lily #6)
  const accountNumber = parsed?.account_number
    || inferAccountNumber(ocrText)
    || null;
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
     opening_balance, closing_balance, page_count, ocr_text, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(stmtId, userId, fileRow.original_name || fileRow.filename, fileRow.file_type, '',
    fileRow.r2_key, bankName, accountNumber, null, currency, null,
    stmtYear, stmtMonth, periodStart, periodEnd,
    openingBal, closingBal, null, ocrText, 'draft'
  ).run();

  let txCount = 0;
  const transactions = parsed?.transactions || [];
  for (const tx of transactions) {
    if (!tx.transaction_date) continue;
    const txId = `bt-${uuidv4().slice(0, 8)}`;
    await db.prepare(
      `INSERT INTO bank_transactions (id, bank_statement_id, user_id, transaction_date, description,
       deposit_amount, withdrawal_amount, balance, account_type, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(txId, stmtId, userId, tx.transaction_date, tx.description || '',
      tx.deposit_amount || 0, tx.withdrawal_amount || 0, tx.balance ?? null, tx.account_type || null, txCount
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
      [/INTEREST|SAVINGS?\s+INTEREST|利息/i, '42101'],                       // Bank interest income (Lily #10: also matches "INTEREST-SAVINGS ACCOUNT")
      [/VISA\s+DEBIT|扣賬卡交易/i, '62303'],                                 // Software subscriptions (best default for card charges)
      [/TRANSFER-DEBIT|轉賬支出/i, '66203'],                                 // Miscellaneous
      [/FPS\s+FEE|FPSPAYMENT/i, '65101'],                                   // Bank service fee
      [/OUTCLEARING|RETURN|退票/i, '66203'],                                // Miscellaneous
      [/SALARY|薪金|薪資|工資|PAYROLL/i, '61201'],                          // Staff salaries
      [/RENT|租金/i, '62101'],                                              // Office rent
      [/ELECTRIC(ITY)?|CLP|HKELECTRIC|中電|港燈|電費/i, '62201'],           // Electricity
      [/WATER|水費/i, '62202'],                                             // Water
      [/UTILITIES|水電/i, '62200'],                                         // Utilities (parent)
      [/INSURANCE|保險/i, '63300'],                                         // Insurance (parent)
      [/PROFITS?\s+TAX|IRD|稅/i, '21301'],                                  // Profits tax payable
      [/SOFTWARE|SUBSCRIPTION|CLOUD|API/i, '62303'],                        // Software subscriptions
      [/HOSTING|DOMAIN|寄存|域名/i, '62302'],                               // Web hosting
      [/PHONE|MOBILE|BROADBAND|INTERNET|CHINA MOBILE|PCCW|SMARTONE|電話|上網/i, '62301'], // Phone & internet
      [/MPF|強積金|MANULIFE/i, '61202'],                                    // MPF employer contribution
      [/AUDIT|審計/i, '63101'],                                             // Audit fee
      [/SECRETARY|秘書/i, '63102'],                                         // Company secretary fee
      [/LEGAL|律師|法律/i, '63103'],                                        // Legal fee
      [/TRAVEL|機票|HOTEL|海外/i, '64302'],                                 // Overseas travel
      [/TAXI|MTR|BUS|OCTOPUS|SHELL|CALTEX|油費|加油|交通/i, '64301'],       // Local transport
      [/DINING|MCDONALD|STARBUCKS|CAFE|RESTAURANT|餐飲|飯|茶餐廳/i, '64200'],  // Meals & entertainment
      [/PARKNSHOP|WELLCOME|SUPERMARKET|GROCERY|超市/i, '62402'],            // Pantry
      [/BANK\s+CHARGE|SERVICE FEE|手續費|銀行費/i, '65101'],                // Bank service fee
      [/WIRE\s+TRANSFER|TT\s+CHARGE|OUTGOING\s+TRANSFER/i, '65101'],        // Wire transfer fee
      [/CHEQUE\s+PAYMENT|支票/i, '51101'],                                  // Subcontractor fees (default for cheque payments)
      [/LOAN\s+REPAYMENT|DIRECTOR|LAI\s*KIN|SZETO/i, '31201'],              // Director current account
      [/INWARD\s+REMITTANCE|CREDIT\s+TRANSFER.*IN|收款|入賬/i, '41101'],    // Professional services income
      [/CLIENT\s+PAYMENT|CUSTOMER\s+PAYMENT|客戶付款/i, '41200'],           // Sales revenue (Lily #7: CLIENT PAYMENT-ACME)
      [/CHEQUE\s+DEPOSIT/i, '41200'],                                       // Sales revenue
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
  fileId: string, userId: string, db: D1Database, fileBucket: R2Bucket, ai: any, deepseekKey: string, glmApiKey?: string,
): Promise<{ success: boolean; invoice_id?: string; error?: string; items_count?: number; ocr_failed?: boolean; parsed?: any }> {
  const fileRow = await db.prepare(
    'SELECT id, r2_key, filename, original_name, file_type, ocr_text, ocr_status, category, direction FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(fileId, userId).first<{ id: string; r2_key: string; filename: string; original_name: string; file_type: string; ocr_text: string; ocr_status: string; category: string; direction: string }>();
  if (!fileRow) return { success: false, error: 'File not found' };

  let ocrText = fileRow.ocr_text || '';
  if (!ocrText || ocrText.length < 20) {
    const obj = await fileBucket.get(fileRow.r2_key);
    if (obj) {
      const buffer = await obj.arrayBuffer();
      const mimeType = fileRow.file_type || 'application/pdf';

      // Attempt 1: GLM-OCR (best for scanned PDFs and images)
      if (glmApiKey) {
        try {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const base64 = btoa(binary);
          const glmResp = await fetch('https://api.z.ai/api/paas/v4/layout_parsing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${glmApiKey}` },
            body: JSON.stringify({ model: 'glm-ocr', file: `data:${mimeType};base64,${base64}` }),
          });
          if (glmResp.ok) {
            const glmData = await glmResp.json() as any;
            const candidate = typeof glmData === 'string' ? glmData : JSON.stringify(glmData);
            if (candidate && candidate.length > 20) ocrText = candidate;
          }
        } catch {}
      }

      // Attempt 2: Cloudflare AI Workers toMarkdown (works great on text-layer PDFs)
      if ((!ocrText || ocrText.length < 20) && ai) {
        try {
          const mdResult = await (ai as any).toMarkdown([{
            name: fileRow.original_name || fileRow.filename || 'invoice.pdf',
            blob: new Blob([buffer], { type: mimeType }),
          }]);
          const candidate = Array.isArray(mdResult) ? mdResult.map((r: any) => r?.data || r?.content || '').join('\n') : String(mdResult || '');
          if (candidate && candidate.length > 20) ocrText = candidate;
        } catch {}
      }

      if (ocrText && ocrText.length >= 20) {
        await db.prepare("UPDATE file_records SET ocr_text = ?, ocr_status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(ocrText, fileId).run();
      }
    }
  }

  // If both OCR methods failed, create an empty pending_review invoice so the user
  // can enter the data manually on the review page — same pattern as bank statement OCR failure.
  if (!ocrText || ocrText.length < 20) {
    // Ensure a customer exists as placeholder
    let placeholderCustomerId: string | null = null;
    const placeholderCust = await db.prepare('SELECT id FROM customers WHERE user_id = ? ORDER BY created_at LIMIT 1').bind(userId).first<{ id: string }>();
    if (placeholderCust) {
      placeholderCustomerId = placeholderCust.id;
    } else {
      placeholderCustomerId = `c-${uuidv4().slice(0, 8)}`;
      await db.prepare('INSERT INTO customers (id, user_id, name, is_active) VALUES (?, ?, ?, 1)').bind(placeholderCustomerId, userId, 'Unknown Customer', true).run();
    }
    const emptyInvId = `i-${uuidv4().slice(0, 8)}`;
    const emptyInvNumber = `DRAFT-${Date.now().toString(36).toUpperCase()}`;
    await db.prepare(
      `INSERT INTO invoices (id, user_id, invoice_number, customer_id, status, issue_date, due_date, subtotal, total, currency, file_id)
       VALUES (?, ?, ?, ?, 'pending_review', date('now'), date('now', '+30 days'), 0, 0, 'HKD', ?)`
    ).bind(emptyInvId, userId, emptyInvNumber, placeholderCustomerId, fileId).run();
    await db.prepare("UPDATE file_records SET category = 'invoice', ocr_status = 'failed', updated_at = datetime('now') WHERE id = ?").bind(fileId).run();
    return { success: true, invoice_id: emptyInvId, items_count: 0, ocr_failed: true };
  }

  // Parse with DeepSeek AI
  // Detect if this is a payment receipt (not a sales invoice)
  // Signals: filename has 'receipt', OCR text contains 'RECEIPT #', 'received payment', etc.
  const originalName = (fileRow.original_name || fileRow.filename || '').toLowerCase();
  const isReceipt = /receipt/i.test(originalName) || /RECEIPT\s*#|we have received|payment received|hereby confirmed/i.test(ocrText);

  let parsed: any = null;
  if (deepseekKey) {
    try {
      const promptForReceipt = `Parse this PAYMENT RECEIPT into structured JSON. Extract:
- receipt_number: the receipt number (look for "RECEIPT #:" or "Receipt No:")
- invoice_number: the invoice number being paid (look for "Invoice #" in the body), or null
- customer_name: the company that ISSUED this receipt (the one who received the payment)
- payer_name: the company that MADE the payment (look for "issued by", "received from")
- issue_date: YYYY-MM-DD (the receipt date)
- currency: default "HKD"
- items: array of { description, quantity (default 1), unit_price (number), amount (number) } for each invoice/payment line
- total: the total amount received
- notes: any additional notes

Return ONLY valid JSON, no explanation. Use null for missing values.

OCR TEXT:
${ocrText.slice(0, 12000)}`;

      const promptForInvoice = `Parse this invoice OCR text into structured JSON. Extract:
- invoice_number: the invoice number/ID
- vendor_name: the company that ISSUED this invoice (the seller). Look for their company name near their address, email, website, or phone number at the top. If the text starts with "Customer:" as the first line, that is NOT the vendor — keep looking for the issuer's details elsewhere (address, email domain, signature name like "Casey Lai" from muselabs-eng.com = Muse Labs). If you cannot determine the vendor, return null.
- customer_name: the company being BILLED. This is ALWAYS in a field explicitly labelled "Customer:", "Bill To:", "Attn:", or "To:". Example: "Customer: Proficiency and Reliance Company Limited" → customer_name = "Proficiency and Reliance Company Limited".
- customer_email: optional customer email
- issue_date: YYYY-MM-DD
- due_date: YYYY-MM-DD if visible
- currency: default "HKD"
- items: array of { description, quantity (number — copy EXACTLY from PDF, if PDF shows 0 then quantity MUST be 0, NEVER change 0 to 1), unit_price (number), amount (number — if quantity is 0 then amount MUST be 0, copy total from PDF exactly) }
- total: the total amount
- notes: any additional notes

Return ONLY valid JSON, no explanation. Use null for missing values.

OCR TEXT:
${ocrText.slice(0, 8000)}`;

      const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: isReceipt ? promptForReceipt : promptForInvoice }],
          max_tokens: 6000,
        }),
      });
      const data = await resp.json() as any;
      const raw = data.choices?.[0]?.message?.content || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {}
  }

  // For receipts: the "customer" is the payer (the company that made the payment)
  // For invoices: figure out which extracted name is actually the counterparty —
  // the letterhead "vendor_name" and the "Customer:"/"Bill To:" customer_name can each
  // legitimately be either OUR OWN company or the other party, depending on whether this
  // document is a bill WE issued (outgoing) or a bill FROM a supplier TO us (incoming).
  // Compare both against our own company name (from company_settings) to tell them apart.
  const normalizeCompanyName = (s: string | null | undefined) =>
    (s || '').toLowerCase()
      .replace(/\b(limited|ltd|inc|incorporated|llc|llp|co\.?|company|corp|corporation|gmbh|holdings|group)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();

  let counterpartyName: string | null = null;
  let isIncoming = false;

  if (!isReceipt) {
    const ownCompany = await db.prepare('SELECT name FROM company_settings WHERE user_id = ?').bind(userId).first<{ name: string | null }>();
    const ownNorm = normalizeCompanyName(ownCompany?.name);
    const vendorNorm = normalizeCompanyName(parsed?.vendor_name);
    const customerNorm = normalizeCompanyName(parsed?.customer_name);

    if (ownNorm && ownNorm.length > 3 && customerNorm && (customerNorm.includes(ownNorm) || ownNorm.includes(customerNorm))) {
      // The "Customer:" field on this invoice is US — so this is a bill FROM a supplier TO us.
      isIncoming = true;
      counterpartyName = parsed?.vendor_name || null;
    } else if (ownNorm && ownNorm.length > 3 && vendorNorm && (vendorNorm.includes(ownNorm) || ownNorm.includes(vendorNorm))) {
      // The letterhead is US — so this is an invoice WE issued to a customer.
      isIncoming = false;
      counterpartyName = parsed?.customer_name || null;
    } else {
      // Company settings not set or no match — use payment section as signal:
      // If the OCR contains a bank account/payment section with vendor_name in A/C Name field
      // → vendor_name is the payee (us) → outgoing invoice we issued.
      // If customer_name appears in A/C Name → incoming (supplier billing us).
      const ocrUpper = ocrText.toUpperCase();
      const acNameMatch = ocrUpper.match(/A\/C\s*NAME\s*[:：]?\s*([A-Z\s&']+?)(?:\n|$)/);
      const acName = normalizeCompanyName(acNameMatch?.[1] || '');
      // Extract email domain for vendor detection
      const emailMatch = ocrText.match(/([a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))/);
      const emailDomain = normalizeCompanyName(emailMatch?.[2]?.split('.')[0] || '');
      const vendorNormShort = normalizeCompanyName(parsed?.vendor_name?.split(' ').slice(0, 2).join(' ') || '');

      if (acName && acName.length > 3) {
        const vendorNormFull = normalizeCompanyName(parsed?.vendor_name || '');
        const customerNormFull = normalizeCompanyName(parsed?.customer_name || '');

        if (customerNormFull.length > 3 && acName.includes(customerNormFull)) {
          // A/C Name matches customer → customer is the payee → incoming (supplier billed us)
          // e.g. acName=PROFICIENCY → customer=PNR → PNR is payee → outgoing (we are the payee)
          // Wait: if A/C Name = customer, that means CUSTOMER receives payment = WE receive payment = OUTGOING
          isIncoming = false;
          counterpartyName = parsed?.customer_name || null;
        } else if (vendorNormFull.length > 3 && acName.includes(vendorNormFull)) {
          // A/C Name matches vendor → vendor receives payment → vendor is third party → INCOMING
          isIncoming = true;
          counterpartyName = parsed?.vendor_name || null;
        } else if (customerNormFull.length > 3 && ownNorm && ownNorm.length > 3 && customerNormFull.includes(ownNorm.slice(0, 6))) {
          // Customer matches our company (partial) → we are the customer → incoming
          isIncoming = true;
          counterpartyName = acName ? acName : (parsed?.vendor_name || null);
        } else {
          // A/C Name doesn't match either side clearly
          // If vendor_name is null (image logo), the A/C Name IS the vendor
          // A/C Name != customer → A/C Name must be a third party → incoming
          if (!vendorNormFull && acName && customerNormFull.length > 3 && !acName.includes(customerNormFull)) {
            isIncoming = true;
            // Use A/C Name as the vendor/supplier name since it's the payee
            const rawAcName = ocrText.toUpperCase().match(/A\/C\s*NAME\s*[:：]?\s*([A-Z\s&']+?)(?:\n|$)/)?.[1]?.trim() || null;
            counterpartyName = rawAcName ? rawAcName.split('\n')[0].trim() : null;
          } else {
            isIncoming = false;
            counterpartyName = parsed?.customer_name || parsed?.vendor_name || null;
          }
        }
      } else if (emailDomain && emailDomain.length > 3 && vendorNormShort && (emailDomain.includes(vendorNormShort.slice(0, 5)) || vendorNormShort.includes(emailDomain.slice(0, 5)))) {
        // Email domain matches vendor name → vendor is a real third-party company → incoming
        isIncoming = true;
        counterpartyName = parsed?.vendor_name || null;
      } else {
        isIncoming = false;
        counterpartyName = parsed?.customer_name || parsed?.vendor_name || null;
      }
    }
  }

  const customerName = isReceipt
    ? (parsed?.payer_name || parsed?.customer_name || null)
    : counterpartyName;
  const customerEmail = isReceipt ? null : (parsed?.customer_email || null);

  // Route counterparty to correct table:
  // - Incoming invoice (supplier billed us) → suppliers table
  // - Outgoing invoice (we billed customer) → customers table
  // Deduplication: normalize name before creating to avoid "3 invoices = 3 customers"
  const normName = (s: string | null | undefined) =>
    (s || '').toLowerCase()
      .replace(/\b(limited|ltd|inc|co\.?|company|corp|hk|hong kong|intl|int'l|international)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();

  // Never create a record for null, blank, or generic "Unknown" names
  const isValidName = (s: string | null | undefined) =>
    !!s && s.trim().length > 2 && s.trim().toLowerCase() !== 'unknown';

  let customerId: string | null = null;
  let supplierId: string | null = null;

  if (isIncoming && isValidName(customerName)) {
    // Supplier invoice — find or create in suppliers table
    const normTarget = normName(customerName);
    const allSuppliers = await db.prepare('SELECT id, name FROM suppliers WHERE user_id = ?').bind(userId).all<{ id: string; name: string }>();
    const existingSupplier = (allSuppliers.results || []).find((s: any) => {
      const n = normName(s.name);
      return n === normTarget || n.includes(normTarget) || normTarget.includes(n);
    });
    if (existingSupplier) {
      supplierId = existingSupplier.id;
    } else {
      supplierId = `sup-${uuidv4().slice(0, 8)}`;
      await db.prepare('INSERT INTO suppliers (id, user_id, name, email, is_active) VALUES (?, ?, ?, ?, 1)')
        .bind(supplierId, userId, customerName, customerEmail || null).run();
    }
    // For incoming invoices, we (PNR) are the customer being billed.
    // Find or create a self-customer record representing our own company.
    const ownCompanyName = (await db.prepare('SELECT name FROM company_settings WHERE user_id = ?').bind(userId).first<{ name: string | null }>())?.name || 'My Company';
    const selfCust = await db.prepare('SELECT id FROM customers WHERE user_id = ? AND name = ?').bind(userId, ownCompanyName).first<{ id: string }>();
    if (selfCust) {
      customerId = selfCust.id;
    } else {
      customerId = `c-self-${uuidv4().slice(0, 6)}`;
      await db.prepare('INSERT INTO customers (id, user_id, name, is_active) VALUES (?, ?, ?, 1)')
        .bind(customerId, userId, ownCompanyName).run();
    }
  } else if (isValidName(customerName)) {
    // Outgoing invoice — find or create in customers table with deduplication
    const normTarget = normName(customerName);
    const allCustomers = await db.prepare('SELECT id, name FROM customers WHERE user_id = ?').bind(userId).all<{ id: string; name: string }>();
    const existing = (allCustomers.results || []).find((c: any) => {
      const n = normName(c.name);
      return n === normTarget || n.includes(normTarget) || normTarget.includes(n);
    });
    if (existing) {
      customerId = existing.id;
    } else {
      if (customerEmail) {
        const byEmail = await db.prepare('SELECT id FROM customers WHERE user_id = ? AND email = ?').bind(userId, customerEmail).first<{ id: string }>();
        if (byEmail) customerId = byEmail.id;
      }
      if (!customerId) {
        customerId = `c-${uuidv4().slice(0, 8)}`;
        await db.prepare('INSERT INTO customers (id, user_id, name, email, is_active) VALUES (?, ?, ?, ?, 1)')
          .bind(customerId, userId, customerName, customerEmail || null).run();
      }
    }
  }

  // If no customer found/created (name was invalid/unknown), use a placeholder
  // but DON'T create a new customer record — just find any existing one
  if (!customerId) {
    const anyCustomer = await db.prepare('SELECT id FROM customers WHERE user_id = ? LIMIT 1').bind(userId).first<{ id: string }>();
    if (anyCustomer) {
      customerId = anyCustomer.id;
    } else {
      // Only create if truly no customers exist yet
      customerId = `c-${uuidv4().slice(0, 8)}`;
      await db.prepare('INSERT INTO customers (id, user_id, name, is_active) VALUES (?, ?, ?, 1)')
        .bind(customerId, userId, customerName || 'Unknown').run();
    }
  }

  // Calculate totals
  const items: any[] = (parsed?.items || []).map((it: any, i: number) => {
    const rawQty = it.quantity !== undefined && it.quantity !== null ? Number(it.quantity) : 1;
    const unitPrice = Number(it.unit_price || 0);
    const extractedAmount = Number(it.amount ?? 0);
    // Key logic: if PDF amount is 0 or qty is explicitly 0, force qty=0 amount=0
    // This fixes the "Engineer Overtime qty=0 $0" being read as qty=1 $450
    const isZeroRow = extractedAmount === 0 || rawQty === 0;
    const qty = isZeroRow ? 0 : (rawQty || 1);
    const amount = isZeroRow ? 0 : (extractedAmount || qty * unitPrice);
    return {
      description: it.description || 'Item',
      quantity: qty,
      unit_price: unitPrice,
      amount: amount,
      sort_order: i,
    };
  });
  if (items.length === 0) {
    // Single-item fallback from total
    const total = parsed?.total || parseFloat(ocrText.match(/(?:total|合計|金額)[^\d]*([\d,]+\.?\d*)/i)?.[1]?.replace(/,/g, '') || '0') || 0;
    if (total > 0) {
      items.push({ description: 'Invoice item', quantity: 1, unit_price: total, amount: total, sort_order: 0 });
    }
  }
  if (items.length === 0) {
    // AI/OCR failed to extract line items — create a pending_review draft like bank statements do
    const emptyInvId = `i-${uuidv4().slice(0, 8)}`;
    const emptyInvNumber = `DRAFT-${Date.now().toString(36).toUpperCase()}`;
    const placeholderCust = await db.prepare('SELECT id FROM customers WHERE user_id = ? ORDER BY created_at LIMIT 1').bind(userId).first<{ id: string }>();
    let fallbackCustId: string;
    if (placeholderCust) {
      fallbackCustId = placeholderCust.id;
    } else {
      fallbackCustId = `c-${uuidv4().slice(0, 8)}`;
      await db.prepare('INSERT INTO customers (id, user_id, name, is_active) VALUES (?, ?, ?, 1)').bind(fallbackCustId, userId, 'Unknown Customer', true).run();
    }
    await db.prepare(
      `INSERT INTO invoices (id, user_id, invoice_number, customer_id, status, issue_date, due_date, subtotal, total, currency, file_id)
       VALUES (?, ?, ?, ?, 'pending_review', date('now'), date('now', '+30 days'), 0, 0, 'HKD', ?)`
    ).bind(emptyInvId, userId, emptyInvNumber, fallbackCustId, fileId).run();
    await db.prepare("UPDATE file_records SET category = 'invoice', ocr_status = 'failed', updated_at = datetime('now') WHERE id = ?").bind(fileId).run();
    return { success: true, invoice_id: emptyInvId, items_count: 0, ocr_failed: true };
  }

  const subtotal = items.reduce((s: number, it: any) => s + it.amount, 0);
  const total = parsed?.total || subtotal;

  // For receipts: use receipt_number column; invoice_number gets a REC- prefix so it never
  // collides with real invoice numbers and the two can be told apart by receipt_number IS NOT NULL
  const receiptNum = isReceipt ? (parsed?.receipt_number || parsed?.invoice_number || null) : null;
  const invNumber = isReceipt
    ? `REC-${Date.now().toString(36).toUpperCase()}`
    : (parsed?.invoice_number || `INV-${Date.now().toString(36).toUpperCase()}`);

  const issueDate = parsed?.issue_date || new Date().toISOString().split('T')[0];
  const dueDate = isReceipt ? issueDate : (parsed?.due_date || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]);
  // Always use isIncoming from AI+company comparison — never trust fileRow.direction for invoices
  // fileRow.direction is set by classifyFile which can't know company context
  const direction = isReceipt ? 'incoming' : (isIncoming ? 'incoming' : 'outgoing');

  // Duplicate check for invoices: same invoice_number already exists
  if (!isReceipt) {
    const existing = await db.prepare(
      'SELECT id, invoice_number, customer_id FROM invoices WHERE user_id = ? AND invoice_number = ?'
    ).bind(userId, invNumber).first<{ id: string; invoice_number: string }>();
    if (existing) return {
      success: false,
      error: `Invoice ${invNumber} already exists`,
      invoice_id: existing.id,
      duplicate_info: { type: 'invoice', number: invNumber, vendor: customerName },
    };
  }

  // Duplicate check for receipts: same receipt_number already exists
  if (isReceipt && receiptNum) {
    const existing = await db.prepare(
      'SELECT id, receipt_number, vendor_name FROM invoices WHERE user_id = ? AND receipt_number = ?'
    ).bind(userId, receiptNum).first<{ id: string; receipt_number: string; vendor_name: string | null }>();
    if (existing) return {
      success: false,
      error: `Receipt ${receiptNum} already exists`,
      invoice_id: existing.id,
      duplicate_info: { type: 'receipt', number: receiptNum, vendor: existing.vendor_name || customerName },
    };
  }

  // Also check by file_id — catches exact same file uploaded twice
  const existingByFile = await db.prepare(
    'SELECT id, invoice_number, receipt_number FROM invoices WHERE user_id = ? AND file_id = ?'
  ).bind(userId, fileId).first<{ id: string; invoice_number: string; receipt_number: string | null }>();
  if (existingByFile) return {
    success: false,
    error: 'This file has already been imported',
    invoice_id: existingByFile.id,
    duplicate_info: {
      type: isReceipt ? 'receipt' : 'invoice',
      number: existingByFile.receipt_number || existingByFile.invoice_number,
      vendor: customerName,
    },
  };

  const invId = `i-${uuidv4().slice(0, 8)}`;
  // Save as 'pending_review' — the user must confirm/edit on the Invoice Review page.
  await db.prepare(
    `INSERT INTO invoices (id, user_id, invoice_number, customer_id, supplier_id, status, issue_date, due_date, subtotal, total, currency, notes, file_id, vendor_name, receipt_number, direction)
     VALUES (?, ?, ?, ?, ?, 'pending_review', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(invId, userId, invNumber, customerId, supplierId || null, issueDate, dueDate, subtotal, total, parsed?.currency || 'HKD', parsed?.notes || null, fileId, customerName || null, receiptNum, direction).run();

  for (const item of items) {
    await db.prepare(
      'INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(`ii-${uuidv4().slice(0, 8)}`, invId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order).run();
  }

  // Derive a clean partner folder name from the resolved counterparty (supplier for incoming
  // bills, customer for outgoing invoices) — NOT the raw parsed.customer_name, which can be
  // our own company name when this is an incoming supplier bill.
  const rawPartner = (customerName || '').toString();
  let partnerFolder = rawPartner
    .replace(/\b(limited|ltd|inc|incorporated|llc|llp|co\.?|company|corp|corporation|gmbh|holdings|group|services|hk|hong\s*kong)\b/gi, '')
    .replace(/[(),.&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Title case
  partnerFolder = partnerFolder
    .split(' ')
    .filter(Boolean)
    .slice(0, 4)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  if (!partnerFolder || partnerFolder.length < 2) partnerFolder = 'Invoices';

  // Update file record
  await db.prepare(
    "UPDATE file_records SET category = 'invoice', direction = ?, payment_status = 'unmatched', amount = ?, folder = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(direction, total, partnerFolder, fileId).run();

  // Return parsed data so the review page can pre-populate without another round-trip
  return {
    success: true,
    invoice_id: invId,
    items_count: items.length,
    partner_folder: partnerFolder,
    is_receipt: isReceipt,
    receipt_number: receiptNum,
    parsed: {
      invoice_number: invNumber,
      customer_name: customerName,
      issue_date: issueDate,
      due_date: dueDate,
      currency: parsed?.currency || 'HKD',
      notes: parsed?.notes || null,
      subtotal,
      total,
      items,
    },
  };
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
  // Invoices — direction is determined later by company_settings comparison, not here
  if (/invoice|發票|发票|inv[_-]?\d/i.test(name)) {
    return { folder: 'Invoices', category: 'invoice' };
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

// Run GLM-OCR for PDFs and images
async function runGlmOcr(fileData: string, fileType: string, glmApiKey?: string): Promise<{ text: string; status: string }> {
  if (!glmApiKey) return { text: '', status: 'pending' };

  const isOcrCandidate = fileType.includes('pdf') || fileType.includes('image') || fileType.includes('png') || fileType.includes('jpg') || fileType.includes('jpeg');
  if (!isOcrCandidate) return { text: '', status: 'skipped' };

  try {
    const resp = await fetch('https://api.z.ai/api/paas/v4/layout_parsing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${glmApiKey}`,
      },
      body: JSON.stringify({ model: 'glm-ocr', file: fileData }),
    });
    if (!resp.ok) return { text: '', status: 'failed' };
    const data = await resp.json() as any;
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return { text, status: text.length > 20 ? 'completed' : 'unclear' };
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

  let sql = 'SELECT id, folder, filename, original_name, file_type, file_size, description, ocr_status, category, direction, payment_status, amount, created_at, updated_at FROM file_records WHERE user_id = ? AND deleted_at IS NULL';
  const params: unknown[] = [tenantId];

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
    'SELECT DISTINCT folder FROM file_records WHERE user_id = ? AND deleted_at IS NULL ORDER BY folder'
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

  // Validate file size (max 10MB base64 ≈ 13.3MB encoded)
  if (file_data.length > 14_000_000) return c.json({ error: 'File too large. Maximum 10MB.' }, 400);

  // Validate file type
  const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/vnd.ms-excel'];
  if (file_type && !allowedTypes.includes(file_type)) {
    return c.json({ error: `File type not allowed: ${file_type}` }, 400);
  }

  const id = `fs-${uuidv4().slice(0, 8)}`;
  const safeName = original_name || filename || 'untitled';
  const r2Key = `${tenantId}/${id}-${safeName}`;
  const displayName = filename || safeName;

  // Auto-classify
  const classification = classifyFile(safeName, file_type || '');
  const folder = reqFolder || classification.folder;

  // Skip GLM-OCR during upload — it blocks for 20-40s and times out frequently.
  // OCR runs in import-document using Cloudflare AI toMarkdown (fast, built-in).
  const ocrResult = { text: '', status: 'pending' };
  const ocrDirection = classification.direction;
  const ocrAmount = null;

  const cleanBase64 = file_data.replace(/^data:.*?;base64,/, '');
  const binary = Uint8Array.from(atob(cleanBase64), ch => ch.charCodeAt(0));

  await c.env.FILE_BUCKET.put(r2Key, binary, {
    httpMetadata: { contentType: file_type || 'application/octet-stream' },
    customMetadata: { originalName: safeName, userId: user.id },
  });

  await c.env.DB.prepare(
    `INSERT INTO file_records (id, user_id, folder, filename, original_name, file_type, file_size, r2_key, description, ocr_text, ocr_status, category, direction, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, folder, displayName, safeName,
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

  // NOTE: Bank statement auto-import is now handled explicitly by the frontend calling
  // POST /:id/import-document immediately after upload. That endpoint runs OCR, detects
  // whether the file is a bank statement or invoice, and dispatches accordingly.
  // Keeping this background block would double-create statements.
  // If you want to re-enable server-side auto-import, first make the dedup check atomic
  // (unique index on bank_statements.r2_key or SELECT+INSERT in a transaction).
  if (false && classification.category === 'bank_statement') {
    c.executionCtx.waitUntil((async () => {
      try {
        // Mark as processing
        await c.env.DB.prepare("UPDATE file_records SET ocr_status = 'processing', updated_at = datetime('now') WHERE id = ?")
          .bind(id).run();

        // Path A: Import using pdftotext OCR
        const importResult = await importStatementFromFile(id, tenantId, c.env.DB, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY, c.env.GLM_API_KEY);

        // Path B: Run GLM-OCR in background for cross-validation
        if (importResult.success && c.env.GLM_API_KEY) {
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
                  'Authorization': `Bearer ${c.env.GLM_API_KEY}`,
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
        if (c.env.GLM_API_KEY) {
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
                  'Authorization': `Bearer ${c.env.GLM_API_KEY}`,
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
          await importInvoiceFromFile(id, tenantId, c.env.DB, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY, c.env.GLM_API_KEY);
        }

        await c.env.DB.prepare("UPDATE file_records SET ocr_status = 'completed', updated_at = datetime('now') WHERE id = ?")
          .bind(id).run();
      } catch (e) {
        await c.env.DB.prepare("UPDATE file_records SET ocr_status = 'failed', updated_at = datetime('now') WHERE id = ?")
          .bind(id).run();
      }
    })());
  }

  await auditLog(c.env.DB, tenantId, 'upload', 'file', id, { filename: displayName, folder, category: classification.category });

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

    const ocrResult = await runGlmOcr(f.file_data, f.file_type || '', c.env.GLM_API_KEY);

    const cleanBase64 = f.file_data.replace(/^data:.*?;base64,/, '');
    const binary = Uint8Array.from(atob(cleanBase64), ch => ch.charCodeAt(0));

    await c.env.FILE_BUCKET.put(r2Key, binary, {
      httpMetadata: { contentType: f.file_type || 'application/octet-stream' },
      customMetadata: { originalName: safeName, userId: user.id },
    });

    await c.env.DB.prepare(
      `INSERT INTO file_records (id, user_id, folder, filename, original_name, file_type, file_size, r2_key, description, ocr_text, ocr_status, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, tenantId, folder, displayName, safeName,
      f.file_type || 'application/octet-stream', f.file_size || binary.byteLength,
      r2Key, batchDesc || '', ocrResult.text, ocrResult.status, classification.category).run();

    results.push({ id, filename: displayName, folder, ocr_status: ocrResult.status, category: classification.category });

    // Auto-import bank statements — DISABLED to avoid double-creation.
    // The frontend calls /:id/import-document after upload which handles both statements and invoices.
    if (false && classification.category === 'bank_statement') {
      c.executionCtx.waitUntil(
        importStatementFromFile(id, tenantId, c.env.DB, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY, c.env.GLM_API_KEY)
      );
    }

    // Auto-import invoices — DISABLED for same reason.
    if (false && classification.category === 'invoice') {
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
                'Authorization': `Bearer ${c.env.GLM_API_KEY}`,
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
        await importInvoiceFromFile(id, tenantId, c.env.DB, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY, c.env.GLM_API_KEY);
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

// Delete (SOFT DELETE — sets deleted_at; requires 'higher' tier)
files.delete('/:id', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;

  if (!await requireHigherTier(c)) {
    return c.json({
      error: 'Only account owner or boss-level users can delete files',
      hint: 'Ask your admin to grant you higher permission, or ask them to perform the delete.',
    }, 403);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id, r2_key, category FROM file_records WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
  ).bind(c.req.param('id'), tenantId).first<{ id: string; r2_key: string | null; category: string | null }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const now = new Date().toISOString();

  // Soft-delete the file record
  await c.env.DB.prepare(
    'UPDATE file_records SET deleted_at = ?, deleted_by = ? WHERE id = ? AND user_id = ?'
  ).bind(now, user.id, c.req.param('id'), tenantId).run();

  // Cascade: if this file was imported as a bank statement, soft-delete that statement too
  // (avoids orphan "pending review" drafts pointing to a deleted PDF)
  let statementsRemoved = 0;
  let transactionsRemoved = 0;
  if (existing.r2_key) {
    const stmtRes = await c.env.DB.prepare(
      'UPDATE bank_statements SET deleted_at = ?, deleted_by = ? WHERE r2_key = ? AND user_id = ? AND deleted_at IS NULL'
    ).bind(now, user.id, existing.r2_key, tenantId).run();
    statementsRemoved = stmtRes.meta?.changes || 0;
    if (statementsRemoved > 0) {
      // Also soft-delete the transactions on those statements
      const txRes = await c.env.DB.prepare(
        `UPDATE bank_transactions SET deleted_at = ?
         WHERE bank_statement_id IN (
           SELECT id FROM bank_statements WHERE r2_key = ? AND user_id = ?
         ) AND deleted_at IS NULL`
      ).bind(now, existing.r2_key, tenantId).run();
      transactionsRemoved = txRes.meta?.changes || 0;
    }
    // Also hard-delete any pending_review invoice records linked to this file.
    // invoices has no deleted_at column — we hard-delete them so orphan drafts
    // don't linger in the list. invoice_items cascade automatically via FK.
    await c.env.DB.prepare(
      'DELETE FROM invoices WHERE file_id = ? AND user_id = ?'
    ).bind(c.req.param('id'), tenantId).run();
  }

  await auditLog(c.env.DB, user.id, 'delete', 'file', c.req.param('id'), { category: existing.category, statements_removed: statementsRemoved });

  return c.json({
    success: true,
    restorable_until: new Date(Date.now() + 30 * 86400_000).toISOString(),
    statements_removed: statementsRemoved,
    transactions_removed: transactionsRemoved,
  });
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

          // Use GLM-OCR for both PDFs and images
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          const mimeType = row.file_type || 'application/pdf';
          if (c.env.GLM_API_KEY) {
            try {
              const glmResp = await fetch('https://api.z.ai/api/paas/v4/layout_parsing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.env.GLM_API_KEY}` },
                body: JSON.stringify({ model: 'glm-ocr', file: `data:${mimeType};base64,${base64}` }),
              });
              if (glmResp.ok) {
                const glmData = await glmResp.json() as any;
                ocrText = typeof glmData === 'string' ? glmData : JSON.stringify(glmData);
                ocrStatus = ocrText.length > 20 ? 'completed' : 'unclear';
              } else {
                ocrStatus = 'failed';
              }
            } catch { ocrStatus = 'failed'; }
          } else {
            ocrStatus = 'skipped';
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
  // DISABLED — /import-document is the sole trigger for creating statements/invoices.
  const updatedCategory = category || (row as any)?.category || '';
  const updatedOcrStatus = ocr_status || (row as any)?.ocr_status || '';
  if (false && (updatedCategory === 'bank_statement' || updatedCategory === 'bank') && updatedOcrStatus === 'completed') {
    c.executionCtx.waitUntil(
      importStatementFromFile(id, tenantId, db, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY, c.env.GLM_API_KEY)
    );
  }
  if (false && updatedCategory === 'invoice' && updatedOcrStatus === 'completed') {
    c.executionCtx.waitUntil(
      importInvoiceFromFile(id, tenantId, db, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY, c.env.GLM_API_KEY)
    );
  }

  return c.json(row);
});

// Import a file as a bank statement (OCR + AI parse → bank_statement + bank_transactions)
files.post('/:id/import-statement', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const result = await importStatementFromFile(
    c.req.param('id'), tenantId, c.env.DB, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY, c.env.GLM_API_KEY
  );
  if (!result.success) {
    const status = result.error === 'File not found' ? 404 : result.error === 'Statement already imported' ? 409 : 422;
    return c.json({ error: result.error, statement_id: result.statement_id, duplicate_info: result.duplicate_info }, status as any);
  }
  return c.json(result, 201);
});

// Import a file as an invoice (OCR + AI parse → invoice + invoice_items)
files.post('/:id/import-invoice', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const result = await importInvoiceFromFile(
    c.req.param('id'), tenantId, c.env.DB, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY, c.env.GLM_API_KEY
  );
  if (!result.success) {
    const status = result.error === 'File not found' ? 404 : result.error?.includes('already exists') || result.error?.includes('already been imported') ? 409 : 422;
    return c.json({ error: result.error, invoice_id: result.invoice_id, duplicate_info: result.duplicate_info }, status as any);
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
  const tenantId = c.get('client_user_id') || user.id;
  const id = c.req.param('id');

  const fileRow = await c.env.DB.prepare(
    'SELECT id, r2_key, filename, original_name, file_type, ocr_text FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(id, tenantId).first<{ id: string; r2_key: string; filename: string; original_name: string; file_type: string; ocr_text: string }>();
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

// ── Smart document import: detect bank statement vs invoice, dispatch to right importer ──
files.post('/:id/import-document', async (c) => {
  const user = c.get('user');
  const tenantId = c.get('client_user_id') || user.id;
  const fileId = c.req.param('id');
  const db = c.env.DB;
  const force = c.req.query('force') === 'true';

  // Get the file's OCR text (or run OCR first if missing)
  // Retry up to 3 times with 500ms delay — D1 has eventual consistency
  let fileRow: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    fileRow = await db.prepare(
      'SELECT id, r2_key, original_name, file_type, ocr_text, category FROM file_records WHERE id = ? AND user_id = ?'
    ).bind(fileId, tenantId).first();
    if (fileRow) break;
    if (attempt < 2) await new Promise(r => setTimeout(r, 600));
  }
  if (!fileRow) return c.json({ error: 'File not found' }, 404);

  // force=true: user explicitly said "upload again" on duplicate warning.
  // Delete any existing invoice OR bank statement linked to this file so re-import succeeds cleanly.
  if (force) {
    // Delete linked invoices (invoice_items cascade via FK)
    await db.prepare('DELETE FROM invoices WHERE file_id = ? AND user_id = ?').bind(fileId, tenantId).run();
    // Soft-delete linked bank statements (by r2_key)
    if (fileRow.r2_key) {
      const existingStmt = await db.prepare(
        'SELECT id FROM bank_statements WHERE r2_key = ? AND user_id = ? AND deleted_at IS NULL'
      ).bind(fileRow.r2_key, tenantId).first<{ id: string }>();
      if (existingStmt) {
        const now = new Date().toISOString();
        await db.prepare('UPDATE bank_statements SET deleted_at = ?, deleted_by = ? WHERE id = ? AND user_id = ?')
          .bind(now, user.id, existingStmt.id, tenantId).run();
        await db.prepare('UPDATE bank_transactions SET deleted_at = ? WHERE bank_statement_id = ? AND user_id = ? AND deleted_at IS NULL')
          .bind(now, existingStmt.id, tenantId).run();
      }
    }
    // Clear OCR cache so it re-runs fresh
    await db.prepare("UPDATE file_records SET ocr_text = '', ocr_status = 'pending' WHERE id = ? AND user_id = ?")
      .bind(fileId, tenantId).run();
    // Re-fetch fileRow with cleared OCR
    fileRow = await db.prepare(
      'SELECT id, r2_key, original_name, file_type, ocr_text, category FROM file_records WHERE id = ? AND user_id = ?'
    ).bind(fileId, tenantId).first<{ id: string; r2_key: string; original_name: string; file_type: string; ocr_text: string; category: string }>() || fileRow;
  }

  // ── Filename-based pre-classification (runs before OCR, very reliable) ──────
  const fname = (fileRow.original_name || fileRow.filename || '').toLowerCase();
  let filenameBank = 0;
  let filenameInvoice = 0;
  if (/e[-_]?statement|bank.*statement|statement.*\d{6,8}/.test(fname)) filenameBank += 8;
  if (/deposit\s*(rs|jl|slip)|credit\s*advice/.test(fname)) filenameBank += 5;
  if (/invoice|receipt|inv\d|rec\d|#e\d|inv022|inv-/.test(fname)) filenameInvoice += 8;

  let ocrText = fileRow.ocr_text || '';
  if (!ocrText || ocrText.length < 20) {
    const obj = await c.env.FILE_BUCKET.get(fileRow.r2_key);
    if (obj) {
      const buffer = await obj.arrayBuffer();
      const mimeType = fileRow.file_type || 'application/pdf';

      // Attempt 1: GLM-OCR — best for all PDFs (tables, Chinese, scanned docs)
      if (c.env.GLM_API_KEY) {
        try {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const base64 = btoa(binary);
          const glmResp = await fetch('https://api.z.ai/api/paas/v4/layout_parsing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.env.GLM_API_KEY}` },
            body: JSON.stringify({ model: 'glm-ocr', file: `data:${mimeType};base64,${base64}` }),
          });
          if (glmResp.ok) {
            const glmData = await glmResp.json() as any;
            const candidate = typeof glmData === 'string' ? glmData : JSON.stringify(glmData);
            if (candidate && candidate.length > 20) {
              ocrText = candidate;
              await db.prepare("UPDATE file_records SET ocr_text = ?, ocr_status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(ocrText, fileId).run();
            }
          }
        } catch (e: any) {
          console.log('[SMART-IMPORT] GLM OCR error:', e?.message || e);
        }
      }

      // Attempt 2: Cloudflare AI toMarkdown — fast free fallback for text-layer PDFs
      if ((!ocrText || ocrText.length < 20) && c.env.AI) {
        try {
          const mdResult = await (c.env.AI as any).toMarkdown([{
            name: fileRow.original_name || fileRow.filename || 'file.pdf',
            blob: new Blob([buffer], { type: mimeType }),
          }]);
          const candidate = Array.isArray(mdResult)
            ? mdResult.map((r: any) => r?.data || r?.content || '').join('\n')
            : String(mdResult || '');
          if (candidate && candidate.length > 20) {
            ocrText = candidate;
            await db.prepare("UPDATE file_records SET ocr_text = ?, ocr_status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(ocrText, fileId).run();
          }
        } catch (e: any) {
          console.log('[SMART-IMPORT] toMarkdown failed:', e?.message || e);
        }
      }
    }
  }

  // If BOTH OCR methods failed but filename clearly says bank statement → create empty draft
  // If filename clearly says invoice → fall through to invoice empty draft below
  // If still no text and filename is ambiguous → create bank statement draft (safer default)
  if (!ocrText || ocrText.length < 10) {
    if (filenameInvoice > filenameBank) {
      // Let importInvoiceFromFile handle the empty invoice draft
      const result = await importInvoiceFromFile(
        fileId, tenantId, db, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY, c.env.GLM_API_KEY
      );
      return c.json({ type: 'invoice', ...result, scores: { bankScore: filenameBank, invoiceScore: filenameInvoice } }, result.success ? 201 : 422 as any);
    }
    // Default: bank statement empty draft
    const dupCheck = await db.prepare(
      'SELECT id, bank_name, period_start, period_end, file_name FROM bank_statements WHERE user_id = ? AND r2_key = ? AND deleted_at IS NULL'
    ).bind(tenantId, fileRow.r2_key).first<{ id: string; bank_name: string | null; period_start: string | null; period_end: string | null; file_name: string | null }>();
    if (dupCheck) {
      return c.json({
        type: 'bank_statement',
        error: 'Statement already imported',
        statement_id: dupCheck.id,
        duplicate_info: {
          type: 'bank_statement',
          bank_name: dupCheck.bank_name,
          period: dupCheck.period_start && dupCheck.period_end ? `${dupCheck.period_start} – ${dupCheck.period_end}` : null,
          file_name: dupCheck.file_name,
        },
      }, 409);
    }
    const emptyId = `bs-${crypto.randomUUID().slice(0, 8)}`;
    const inferredBank = inferBankName(fileRow.original_name || '');
    await db.prepare(
      `INSERT INTO bank_statements (id, user_id, file_name, r2_key, bank_name, currency, status,
       opening_balance, closing_balance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'HKD', 'draft', 0, 0, datetime('now'), datetime('now'))`
    ).bind(emptyId, tenantId, fileRow.original_name, fileRow.r2_key, inferredBank).run();
    return c.json({
      type: 'bank_statement',
      statement_id: emptyId,
      ocr_failed: true,
      message: 'Could not read this file automatically. Please enter the transactions manually on the review page.',
    }, 201);
  }

  // Detect document type from OCR text content (add filename pre-scores as baseline)
  const lower = ocrText.toLowerCase();
  let bankScore = filenameBank;
  let invoiceScore = filenameInvoice;
  if (/statement\s+of\s+account/i.test(ocrText)) bankScore += 3;
  if (/account\s+activities/i.test(ocrText)) bankScore += 3;
  if (/business\s+direct\s+statement/i.test(ocrText)) bankScore += 3;
  if (/opening\s+balance|closing\s+balance|b\/f\s*balance|c\/f\s*balance/i.test(ocrText)) bankScore += 2;
  if (/(deposit|withdrawal|debit|credit)/i.test(ocrText) && (lower.match(/balance/g) || []).length >= 2) bankScore += 2;
  if (/transaction\s+(details|date|history)/i.test(ocrText)) bankScore += 1;
  if (/(hsbc|standard\s+chartered|citibank|hang\s+seng|bank\s+of\s+china|dbs)/i.test(ocrText)) bankScore += 1;

  if (/\binvoice\b/i.test(ocrText)) invoiceScore += 2;
  if (/invoice\s*(no|number|#)/i.test(ocrText)) invoiceScore += 3;
  if (/bill\s*to/i.test(ocrText)) invoiceScore += 3;
  if (/\breceipt\b/i.test(ocrText)) invoiceScore += 2;
  if (/(due\s*date|payment\s*terms|net\s*\d+\s*days)/i.test(ocrText)) invoiceScore += 2;
  if (/(subtotal|total\s*due|total\s*amount)/i.test(ocrText)) invoiceScore += 1;
  if (/(unit\s*price|qty|quantity)/i.test(ocrText)) invoiceScore += 1;

  // Decide. Bank statements usually have many more transaction-like rows.
  const type = bankScore > invoiceScore ? 'bank_statement' : 'invoice';
  console.log(`[SMART-IMPORT] file=${fileId} bankScore=${bankScore} invoiceScore=${invoiceScore} → ${type}`);

  if (type === 'bank_statement') {
    const result = await importStatementFromFile(
      fileId, tenantId, db, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY, c.env.GLM_API_KEY
    );
    if (!result.success) {
      const status = result.error === 'File not found' ? 404 : result.error === 'Statement already imported' ? 409 : 422;
      return c.json({ type, error: result.error, statement_id: result.statement_id, duplicate_info: result.duplicate_info, scores: { bankScore, invoiceScore } }, status as any);
    }
    return c.json({ type, ...result, scores: { bankScore, invoiceScore } }, 201);
  } else {
    const result = await importInvoiceFromFile(
      fileId, tenantId, db, c.env.FILE_BUCKET, c.env.AI, c.env.DEEPSEEK_API_KEY, c.env.GLM_API_KEY
    );
    if (!result.success) {
      const status = result.error === 'File not found' ? 404 : result.error?.includes('already exists') || result.error?.includes('already been imported') ? 409 : 422;
      return c.json({ type, error: result.error, invoice_id: result.invoice_id, duplicate_info: result.duplicate_info, scores: { bankScore, invoiceScore } }, status as any);
    }
    return c.json({ type, ...result, scores: { bankScore, invoiceScore } }, 201);
  }
});

export { files as fileStorageRoutes };
