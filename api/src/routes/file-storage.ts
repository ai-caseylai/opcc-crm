import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, Variables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { wsBroadcast } from './ws';

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
  const folder = c.req.query('folder') || '';
  const q = c.req.query('q') || '';

  let sql = 'SELECT id, folder, filename, original_name, file_type, file_size, description, ocr_status, category, created_at, updated_at FROM file_records WHERE user_id = ?';
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
  const rows = await c.env.DB.prepare(
    'SELECT DISTINCT folder FROM file_records WHERE user_id = ? ORDER BY folder'
  ).bind(user.id).all();
  return c.json({ data: rows.results.map(r => r.folder) });
});

// Get files with issues (for nav badge)
files.get('/issues', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM file_records WHERE user_id = ? AND ocr_status IN ('failed', 'unclear')"
  ).bind(user.id).first<{ count: number }>();
  return c.json({ issues: row?.count || 0 });
});

// Upload file to R2 + store metadata in D1
files.post('/upload', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { filename, original_name, file_type, file_size, file_data, folder: reqFolder, description } = body;

  if (!file_data) return c.json({ error: 'file_data required (base64)' }, 400);

  const id = `fs-${uuidv4().slice(0, 8)}`;
  const safeName = original_name || filename || 'untitled';
  const r2Key = `${user.id}/${id}-${safeName}`;
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

  return c.json(row, 201);
});

// Batch upload multiple files
files.post('/upload-batch', async (c) => {
  const user = c.get('user');
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
    const r2Key = `${user.id}/${id}-${safeName}`;
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
  }

  return c.json({ uploaded: results.length, files: results }, 201);
});

// Get file metadata
files.get('/:id', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    'SELECT id, folder, filename, original_name, file_type, file_size, description, ocr_text, ocr_status, category, created_at, updated_at FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(c.req.param('id'), user.id).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

// Download from R2
files.get('/:id/download', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    'SELECT r2_key, file_type, original_name, filename FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(c.req.param('id'), user.id).first();
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
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT id FROM file_records WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first();
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
  params.push(id, user.id);

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
  const existing = await c.env.DB.prepare(
    'SELECT id, r2_key FROM file_records WHERE id = ? AND user_id = ?'
  ).bind(c.req.param('id'), user.id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.FILE_BUCKET.delete(existing.r2_key as string);
  await c.env.DB.prepare('DELETE FROM file_records WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).run();
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
  const db = c.env.DB;

  const rows = await db.prepare(
    "SELECT id, r2_key, filename, original_name, file_type FROM file_records WHERE user_id = ? AND (ocr_status IN ('pending','skipped','failed') OR category = '' OR category IS NULL) LIMIT 50"
  ).bind(user.id).all();

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
      ).bind(ocrText, ocrStatus, classification.category, classification.folder, row.id, user.id).run();

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
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.json();
  const { ocr_text, ocr_status, category, folder } = body as { ocr_text?: string; ocr_status?: string; category?: string; folder?: string };

  const existing = await db.prepare('SELECT id FROM file_records WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const sets: string[] = [];
  const params: unknown[] = [];
  if (ocr_text !== undefined) { sets.push('ocr_text = ?'); params.push(ocr_text); }
  if (ocr_status !== undefined) { sets.push('ocr_status = ?'); params.push(ocr_status); }
  if (category !== undefined) { sets.push('category = ?'); params.push(category); }
  if (folder !== undefined) { sets.push('folder = ?'); params.push(folder); }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(id, user.id);

  await db.prepare(`UPDATE file_records SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  const row = await db.prepare('SELECT id, filename, ocr_status, ocr_text, category, folder FROM file_records WHERE id = ?').bind(id).first();
  return c.json(row);
});

// ── Auto-match invoice files with bank transactions ──
files.post('/auto-match-invoices', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  // Get unmatched invoice files with amounts
  const invoiceFiles = await db.prepare(
    `SELECT id, filename, original_name, ocr_text, direction, amount, category
     FROM file_records
     WHERE user_id = ? AND category = 'invoice' AND payment_status = 'unmatched' AND amount IS NOT NULL AND amount > 0`
  ).bind(user.id).all();

  // Get unmatched bank transactions
  const deposits = await db.prepare(
    `SELECT id, transaction_date, description, deposit_amount
     FROM bank_transactions WHERE user_id = ? AND deposit_amount > 0 AND match_status = 'unmatched'`
  ).bind(user.id).all();

  const withdrawals = await db.prepare(
    `SELECT id, transaction_date, description, withdrawal_amount
     FROM bank_transactions WHERE user_id = ? AND withdrawal_amount > 0 AND match_status = 'unmatched'`
  ).bind(user.id).all();

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
  const id = c.req.param('id');
  const { direction } = await c.req.json();
  if (!['outgoing', 'incoming'].includes(direction)) {
    return c.json({ error: 'direction must be outgoing or incoming' }, 400);
  }
  await c.env.DB.prepare(
    'UPDATE file_records SET direction = ? WHERE id = ? AND user_id = ?'
  ).bind(direction, id, user.id).run();
  return c.json({ success: true });
});

export { files as fileStorageRoutes };
