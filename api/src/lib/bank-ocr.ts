/**
 * Bank Statement OCR Pipeline
 * Dual OCR (pdftotext + GLM-OCR) → cross-validate → auto-import
 */

export interface ExtractedCompany {
  name?: string;
  address?: string;
  address2?: string;
}

export interface ExtractedBank {
  bank_name?: string;
  account_number?: string;
  branch?: string;
  currency?: string;
}

export interface OcrResult {
  text: string;
  source: 'pdftotext' | 'glm-ocr' | 'workers-ai';
  status: 'completed' | 'failed' | 'unclear';
}

export interface CrossValidation {
  total_pdftotext: number;
  total_glm: number;
  matched: number;
  amount_diffs: number;
  discrepancies: { date?: string; desc?: string; pdftotext?: any; glm?: any }[];
  summary: string;
}

/**
 * Extract company name and address from OCR text.
 */
export function extractCompanyInfo(text: string): ExtractedCompany {
  const result: ExtractedCompany = {};

  // Company name: uppercase words ending with LIMITED/LTD/CO./CORP
  const namePatterns = [
    /([A-Z][A-Z\s]{3,}(?:LIMITED|LTD|COMPANY|CO\.|CORP|INCORPORATED))/i,
    /([A-Z][A-Z\s]{5,}(?:LIMITED|LTD))/i,
  ];
  for (const pat of namePatterns) {
    const m = text.match(pat);
    if (m) { result.name = m[1].trim(); break; }
  }

  // Address: ROOM/FLAT/RM pattern
  const addrMatch = text.match(/(?:ROOM|FLAT|RM)\s+\d+[^,\n]{0,80}/i);
  if (addrMatch) result.address = addrMatch[0].trim();

  // Second line: building/street
  const addr2Match = text.match(/(\d+[-\s]\d+\s+[A-Z\s]+(?:STREET|ROAD|BUILDING|INDUSTRIAL)[^,\n]{0,60})/i);
  if (addr2Match) result.address2 = addr2Match[1].trim();

  // District
  const districtMatch = text.match(/([A-Z]+\s+(?:KOWLOON|HONG\s*KONG|N\.T\.|NEW\s*TERRITORIES))/i);
  if (districtMatch) {
    const district = districtMatch[1].trim();
    if (result.address2 && !result.address2.includes(district)) {
      result.address2 += ', ' + district;
    } else if (!result.address2) {
      result.address2 = district;
    }
  }

  return result;
}

/**
 * Extract bank info from OCR text.
 */
export function extractBankInfo(text: string): ExtractedBank {
  const result: ExtractedBank = {};

  // Bank name detection
  const bankPatterns = [
    { pat: /HSBC|Hongkong\s+and\s+Shanghai/i, name: 'HSBC' },
    { pat: /OCBC|Oversea-Chinese/i, name: 'OCBC' },
    { pat: /BOC|Bank\s+of\s+China/i, name: 'BOC' },
    { pat: /Hang\s+Seng/i, name: 'Hang Seng' },
    { pat: /Standard\s+Chartered|渣打/i, name: 'Standard Chartered' },
  ];
  for (const { pat, name } of bankPatterns) {
    if (pat.test(text)) { result.bank_name = name; break; }
  }

  // Account number
  const acctPatterns = [
    /(?:A\/C|ACCOUNT)\s*(?:NO\.?|Number|號碼)?\s*[:：]?\s*(\d{3,4}[-\s]\d{3,6}[-\s]\d{1,3})/i,
    /(\d{3}-\d{6}-\d{3})/,  // HSBC format
    /(\d{3,4}-\d{3,4}-\d{3,4})/,  // Generic format
  ];
  for (const pat of acctPatterns) {
    const m = text.match(pat);
    if (m) { result.account_number = m[1].trim(); break; }
  }

  // Currency
  if (/HKD|港元|港幣/i.test(text)) result.currency = 'HKD';
  else if (/USD|美元/i.test(text)) result.currency = 'USD';
  else if (/CNY|RMB|人民幣/i.test(text)) result.currency = 'CNY';

  // Branch
  const branchMatch = text.match(/(?:BRANCH|分行)\s*[:：]?\s*([A-Za-z\s]{3,30}?)(?:\s{3,}|\n|總行|HEAD)/i);
  if (branchMatch) result.branch = branchMatch[1].trim();

  return result;
}

/**
 * Cross-validate pdftotext and GLM-OCR transaction results.
 */
export function crossValidate(
  pdftotextTxs: any[],
  glmOcrTxs: any[],
): CrossValidation {
  const result: CrossValidation = {
    total_pdftotext: pdftotextTxs.length,
    total_glm: glmOcrTxs.length,
    matched: 0,
    amount_diffs: 0,
    discrepancies: [],
    summary: '',
  };

  if (!glmOcrTxs || glmOcrTxs.length === 0) {
    result.summary = 'GLM-OCR returned no transactions — using pdftotext only';
    return result;
  }

  const glmCopy = [...glmOcrTxs];

  for (const pt of pdftotextTxs) {
    const ptDate = pt.transaction_date || '';
    const ptDep = pt.deposit_amount || 0;
    const ptWit = pt.withdrawal_amount || 0;
    const ptAmt = ptDep + ptWit;

    let found = false;
    for (let i = 0; i < glmCopy.length; i++) {
      const gt = glmCopy[i];
      const gtDate = gt.transaction_date || '';
      const gtDep = parseFloat(gt.deposit_amount || 0);
      const gtWit = parseFloat(gt.withdrawal_amount || 0);
      const gtAmt = gtDep + gtWit;

      if (ptDate === gtDate && Math.abs(ptAmt - gtAmt) < 0.02) {
        if (Math.abs(ptDep - gtDep) > 0.02 || Math.abs(ptWit - gtWit) > 0.02) {
          result.discrepancies.push({
            date: ptDate,
            desc: (pt.description || '').slice(0, 60),
            pdftotext: { dep: ptDep, wit: ptWit },
            glm: { dep: gtDep, wit: gtWit },
          });
          result.amount_diffs++;
        }
        result.matched++;
        glmCopy.splice(i, 1);
        found = true;
        break;
      }
    }

    if (!found && ptAmt > 0) {
      result.discrepancies.push({
        date: ptDate,
        desc: (pt.description || '').slice(0, 60),
        pdftotext: { dep: ptDep, wit: ptWit },
        glm: null,
      });
    }
  }

  const matchRate = pdftotextTxs.length > 0
    ? Math.round(result.matched / pdftotextTxs.length * 100)
    : 0;

  if (result.amount_diffs === 0 && result.matched === pdftotextTxs.length) {
    result.summary = `All ${pdftotextTxs.length} transactions validated (100% match)`;
  } else if (matchRate >= 80) {
    result.summary = `${result.matched}/${pdftotextTxs.length} matched (${matchRate}%), ${result.amount_diffs} amount diffs`;
  } else {
    result.summary = `Low match rate (${matchRate}%) — using pdftotext only. GLM-OCR found ${glmOcrTxs.length} tx`;
  }

  return result;
}

/**
 * Complete bank statement processing pipeline.
 * Called after file upload or OCR result update.
 */
export async function processBankStatement(
  fileId: string,
  fileRecord: any,
  ocrText: string,
  db: D1Database,
  fileBucket: R2Bucket,
  ai: any,
  deepseekKey: string,
): Promise<{
  company?: ExtractedCompany;
  bank?: ExtractedBank;
  validation?: CrossValidation;
  statement_id?: string;
  tx_count?: number;
  errors?: string[];
}> {
  const errors: string[] = [];

  // 1. Extract company info
  const company = extractCompanyInfo(ocrText);

  // 2. Extract bank info
  const bank = extractBankInfo(ocrText);

  // 3. Auto-fill company profile if empty
  if (company.name || company.address) {
    try {
      const existing = await db.prepare(
        'SELECT name, address FROM company_settings WHERE user_id = ?'
      ).bind(fileRecord.user_id).first<{ name: string; address: string | null }>();

      const sets: string[] = [];
      const params: any[] = [];

      if (company.name && (!existing?.name || existing.name === 'OPCC CRM')) {
        sets.push('name = ?, legal_name = ?');
        params.push(company.name, company.name);
      }
      if (company.address && (!existing?.address || !existing.address.trim() || existing.address === 'Hong Kong')) {
        sets.push('address = ?');
        params.push(company.address);
      }
      if (company.address2) {
        sets.push('address2 = ?');
        params.push(company.address2);
      }

      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        params.push(fileRecord.user_id);
        await db.prepare(
          `UPDATE company_settings SET ${sets.join(', ')} WHERE user_id = ?`
        ).bind(...params).run();
      }
    } catch { /* non-critical */ }
  }

  // 4. Auto-fill bank info if missing
  if (bank.bank_name || bank.account_number) {
    try {
      const existing = await db.prepare(
        'SELECT bank_name, bank_account FROM company_settings WHERE user_id = ?'
      ).bind(fileRecord.user_id).first<{ bank_name: string; bank_account: string }>();

      const sets: string[] = [];
      const params: any[] = [];

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
        params.push(fileRecord.user_id);
        await db.prepare(
          `UPDATE company_settings SET ${sets.join(', ')} WHERE user_id = ?`
        ).bind(...params).run();
      }
    } catch { /* non-critical */ }
  }

  return { company, bank, errors };
}
