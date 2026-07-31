// Shared numbering utilities for invoices and receipts
// Used by both invoices.ts routes and file-storage.ts import flow

export async function generateInvoiceNumber(db: D1Database, userId: string): Promise<string> {
  const row = await db.prepare(
    'SELECT invoice_number_pattern FROM company_settings WHERE user_id = ?'
  ).bind(userId).first<{ invoice_number_pattern: string }>();

  return generateNumber(db, userId, row?.invoice_number_pattern || 'INV{YY}{MM}-{NNN}', 'invoice_number');
}

export async function generateReceiptNumber(db: D1Database, userId: string): Promise<string> {
  const row = await db.prepare(
    'SELECT receipt_number_pattern FROM company_settings WHERE user_id = ?'
  ).bind(userId).first<{ receipt_number_pattern: string }>();

  return generateNumber(db, userId, row?.receipt_number_pattern || 'REC{YY}{MM}-{NNN}', 'invoice_number');
}

async function generateNumber(db: D1Database, userId: string, pattern: string, column: string): Promise<string> {
  const now = new Date();
  const YYYY = now.getFullYear().toString();
  const YY = YYYY.slice(-2);
  const MM = (now.getMonth() + 1).toString().padStart(2, '0');
  const DD = now.getDate().toString().padStart(2, '0');

  let prefix = pattern
    .replace('{YYYY}', YYYY)
    .replace('{YY}', YY)
    .replace('{MM}', MM)
    .replace('{DD}', DD);

  const counterMatch = pattern.match(/\{(N+)\}/);
  const counterLen = counterMatch ? counterMatch[1].length : 4;
  prefix = prefix.replace(/\{N+\}/, '');

  const result = await db.prepare(
    `SELECT ${column} FROM invoices WHERE user_id = ? AND ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`
  ).bind(userId, `${prefix}%`).first<Record<string, string>>();

  let counter = 1;
  if (result) {
    const numPart = (result as any)[column]?.substring(prefix.length) || '';
    const num = parseInt(numPart, 10);
    if (!isNaN(num)) counter = num + 1;
  }

  return prefix + counter.toString().padStart(counterLen, '0');
}

function patternToRegex(pattern: string): RegExp | null {
  try {
    let escaped = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace('\\{YYYY\\}', '\\d{4}')
      .replace('\\{YY\\}', '\\d{2}')
      .replace('\\{MM\\}', '\\d{2}')
      .replace('\\{DD\\}', '\\d{2}')
      .replace('\\{N\\}', '\\d')
      .replace('\\{NN\\}', '\\d{2}')
      .replace('\\{NNN\\}', '\\d{3}')
      .replace('\\{NNNN\\}', '\\d{4}')
      .replace('\\{NNNNN\\}', '\\d{5}');
    return new RegExp(`^${escaped}$`, 'i');
  } catch {
    return null;
  }
}

export function detectOwnNumber(
  extractedNumber: string | null | undefined,
  invoicePattern: string | null | undefined,
  receiptPattern: string | null | undefined
): { isOurs: boolean; type: 'invoice' | 'receipt' | null } {
  if (!extractedNumber) return { isOurs: false, type: null };
  const invRegex = invoicePattern ? patternToRegex(invoicePattern) : null;
  const recRegex = receiptPattern ? patternToRegex(receiptPattern) : null;
  if (invRegex?.test(extractedNumber)) return { isOurs: true, type: 'invoice' };
  if (recRegex?.test(extractedNumber)) return { isOurs: true, type: 'receipt' };
  return { isOurs: false, type: null };
}
