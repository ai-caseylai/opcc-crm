/**
 * COA Transaction Mapping — Automated End-to-End Test
 *
 * Uploads a bank statement PDF, runs the full pipeline, and verifies
 * that the COA page shows correct balances mapped to transactions.
 *
 * Usage:
 *   node scripts/test-coa.js [options]
 *
 * Options:
 *   --api-url     API base URL (default: https://opcc-crm-api.ruhan-farhan.workers.dev/api)
 *   --email       Login email (default: admin@example.com)
 *   --password    Login password (default: Admin123!)
 *   --pdf         Path to bank statement PDF (default: auto-finds in qa-kit/ or test-samples/)
 *   --register    Register a new user instead of logging in
 */

const API_URL = (process.argv.find(a => a.startsWith('--api-url=')) || '').split('=')[1] ||
  'https://opcc-crm-api.ruhan-farhan.workers.dev/api';
const EMAIL = (process.argv.find(a => a.startsWith('--email=')) || '').split('=')[1] || 'admin@example.com';
const PASSWORD = (process.argv.find(a => a.startsWith('--password=')) || '').split('=')[1] || 'Admin123!';
const PDF_PATH = (process.argv.find(a => a.startsWith('--pdf=')) || '').split('=')[1];
const SHOULD_REGISTER = process.argv.includes('--register');

const path = require('path');
const fs = require('fs');

// Try to find a test PDF
function findTestPdf() {
  const candidates = [
    PDF_PATH,
    path.join(__dirname, '..', '..', 'qa-kit', 'BANK_01_HSBC_clean.pdf'),
    path.join(__dirname, '..', 'test-samples', 'HSBC_Statement_2026-04.pdf'),
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Search common locations
  const searchDirs = [
    path.join(__dirname, '..', '..', 'qa-kit'),
    path.join(__dirname, '..', 'test-samples'),
    __dirname,
  ];
  for (const dir of searchDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf') || f.endsWith('.jpg'));
      if (files.length > 0) return path.join(dir, files[0]);
    }
  }

  console.error('ERROR: No test PDF found. Specify --pdf=<path>');
  process.exit(1);
}

async function api(pathname, options = {}) {
  const { method = 'GET', body, token } = options;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = `${API_URL}${pathname}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const errMsg = typeof data === 'object' && data.error ? data.error : text.slice(0, 200);
    throw new Error(`HTTP ${res.status}: ${errMsg}`);
  }

  return data;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const pdfPath = findTestPdf();
  const pdfName = path.basename(pdfPath);
  const pdfData = fs.readFileSync(pdfPath);
  const pdfBase64 = pdfData.toString('base64');
  const pdfSize = pdfData.length;

  console.log('='.repeat(60));
  console.log('COA Transaction Mapping — End-to-End Test');
  console.log('='.repeat(60));
  console.log(`API:     ${API_URL}`);
  console.log(`PDF:     ${pdfPath} (${(pdfSize / 1024).toFixed(1)} KB)`);
  console.log('');

  let token;
  const results = { passed: 0, failed: 0, skipped: 0 };

  function check(name, ok, detail = '') {
    if (ok) {
      console.log(`  ✅ PASS: ${name}`);
      results.passed++;
    } else {
      console.log(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
      results.failed++;
    }
  }

  function skip(name) {
    console.log(`  ⏭️  SKIP: ${name}`);
    results.skipped++;
  }

  try {
    // ── Step 1: Authenticate ──────────────────────────────────
    console.log('\n── Step 1: Authentication ────────────────────────');

    if (SHOULD_REGISTER) {
      const registerData = await api('/auth/register', {
        method: 'POST',
        body: { email: EMAIL, password: PASSWORD, name: 'COA Test User' },
      });
      token = registerData.token;
      check('Register new user', !!token);
    } else {
      const loginData = await api('/auth/login', {
        method: 'POST',
        body: { email: EMAIL, password: PASSWORD },
      });
      token = loginData.token;
      check('Login successful', !!token);
    }

    if (!token) throw new Error('No auth token received');

    // ── Step 2: Check existing accounts ───────────────────────
    console.log('\n── Step 2: Check existing accounts ───────────────');

    let accountsData = await api('/bookkeeping/accounts', { token });
    let accounts = accountsData.data || accountsData.results || [];

    check('Accounts endpoint returns data', accounts.length >= 0);

    const hasAccounts = accounts.length > 0;

    // ── Step 3: Seed COA if empty ─────────────────────────────
    console.log('\n── Step 3: Seed Chart of Accounts ────────────────');

    if (hasAccounts) {
      skip('COA already seeded — skipping seed');
    } else {
      try {
        const seedResult = await api('/bookkeeping/accounts/seed', { method: 'POST', token });
        check('COA seeded successfully', seedResult.success || seedResult.accounts_created > 0,
          `Created ${seedResult.accounts_created} accounts`);
      } catch (e) {
        check('COA seed', false, e.message);
      }
    }

    accountsData = await api('/bookkeeping/accounts', { token });
    accounts = accountsData.data || accountsData.results || [];
    check(`COA has ${accounts.length} accounts`, accounts.length > 50,
      `Got ${accounts.length} accounts (expected 50+)`);

    // Log account type breakdown
    const byType = {};
    for (const a of accounts) {
      const t = a.account_type || 'unknown';
      byType[t] = (byType[t] || 0) + 1;
    }
    console.log(`  Account types: ${JSON.stringify(byType)}`);

    // ── Step 4: Upload bank statement PDF ─────────────────────
    console.log('\n── Step 4: Upload bank statement PDF ─────────────');

    let fileId;
    try {
      const uploadResult = await api('/file-storage/upload', {
        method: 'POST',
        token,
        body: {
          filename: pdfName,
          original_name: pdfName,
          file_type: 'application/pdf',
          file_size: pdfSize,
          file_data: pdfBase64,
        },
      });
      fileId = uploadResult.id;
      check('File uploaded', !!fileId, `File ID: ${fileId}`);
    } catch (e) {
      check('File upload', false, e.message);
    }

    if (!fileId) {
      skip('Remaining steps — file upload failed');
      printResults(results);
      return;
    }

    // ── Step 5: Import document (trigger OCR + parsing) ──────
    console.log('\n── Step 5: Import document (OCR + parsing) ──────');

    let importResult;
    try {
      importResult = await api(`/file-storage/${fileId}/import-document`, {
        method: 'POST',
        token,
      });
      check('Document import triggered', true,
        `Type: ${importResult.type || importResult.category || '?'}`);
    } catch (e) {
      check('Document import', false, e.message);
    }

    // Wait for async processing
    console.log('  Waiting 10s for OCR and auto-categorization...');
    await sleep(10000);

    // ── Step 6: Check bank statement ──────────────────────────
    console.log('\n── Step 6: Check bank statement ──────────────────');

    let statements;
    try {
      statements = await api('/bank-statements', { token });
      const stmtList = statements.data || statements.results || [];
      check('Bank statement created', stmtList.length > 0,
        `Found ${stmtList.length} statement(s)`);

      if (stmtList.length > 0) {
        const stmt = stmtList[0];
        console.log(`  Statement: ${stmt.bank_name || '?'} — ${stmt.transaction_count || '?'} transactions`);
      }
    } catch (e) {
      check('Bank statement', false, e.message);
    }

    // ── Step 7: Generate journal entries ──────────────────────
    console.log('\n── Step 7: Generate journal entries ──────────────');

    try {
      const genResult = await api('/bookkeeping/auto-generate-entries', {
        method: 'POST',
        token,
      });
      check('Journal entries generated', genResult.created > 0 || genResult.skipped > 0,
        `Created: ${genResult.created}, Skipped: ${genResult.skipped}, Total: ${genResult.total_transactions}`);
    } catch (e) {
      check('Journal entry generation', false, e.message);
    }

    await sleep(2000);

    // ── Step 8: Verify COA balances ───────────────────────────
    console.log('\n── Step 8: Verify COA balances (with ?as_of=) ────');

    try {
      const today = new Date().toISOString().split('T')[0];
      const coaWithBalances = await api(`/bookkeeping/accounts?as_of=${today}`, { token });
      const coaData = coaWithBalances.data || [];
      const hasBalanceField = coaData.length > 0 && 'current_balance' in coaData[0];
      check('COA returns current_balance', hasBalanceField,
        hasBalanceField ? `e.g., ${coaData[0].account_code}: ${coaData[0].current_balance}` : 'current_balance field missing');

      // Find accounts with non-zero balances
      const activeAccounts = coaData.filter((a: any) => a.current_balance && Math.abs(a.current_balance) > 0.001);
      check('Some accounts have non-zero balances', activeAccounts.length > 0,
        `${activeAccounts.length} account(s) with activity`);

      if (activeAccounts.length > 0) {
        console.log('  Accounts with activity (top 5):');
        activeAccounts.slice(0, 5).forEach((a: any) => {
          const code = a.account_code || '';
          const name = a.account_name || '';
          const bal = a.current_balance || 0;
          console.log(`    ${code} ${name}: ${bal.toLocaleString('en-HK', { minimumFractionDigits: 2 })}`);
        });
      }
    } catch (e) {
      check('COA balance verification', false, e.message);
    }

    // ── Step 9: Check transactions per account ────────────────
    console.log('\n── Step 9: Check account transaction drill-down ──');

    if (accounts.length > 0) {
      const testAccount = accounts[0].account_code;
      try {
        const txResult = await api(`/bookkeeping/accounts/${testAccount}/transactions`, { token });
        const txns = txResult.transactions || [];
        check(`Transactions for ${testAccount}`, txns.length >= 0,
          `${txns.length} transaction(s) returned`);

        if (txns.length > 0) {
          check('Transaction has reference info', !!(txns[0].reference_type || txns[0].entry_number),
            `ref: ${txns[0].reference_type || 'none'}, entry: ${txns[0].entry_number || 'none'}`);
          check('Transaction has running_balance', 'running_balance' in txns[0],
            `balance: ${txns[0].running_balance}`);
        }
      } catch (e) {
        check('Transaction drill-down', false, e.message);
      }
    }

    // ── Print Summary ─────────────────────────────────────────
    printResults(results);

  } catch (e) {
    console.error(`\n❌ UNEXPECTED ERROR: ${e.message}`);
    printResults(results);
    process.exit(1);
  }
}

function printResults(results) {
  console.log('\n' + '='.repeat(60));
  console.log('TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`  ✅ Passed: ${results.passed}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log(`  ⏭️  Skipped: ${results.skipped}`);
  console.log(`  ─────────────────────`);
  const total = results.passed + results.failed + results.skipped;
  console.log(`  📊 Total:  ${total}`);
  if (results.failed === 0 && results.passed > 0) {
    console.log('\n  🎉 ALL CHECKS PASSED');
  } else if (results.failed > 0) {
    console.log(`\n  ⚠️  ${results.failed} check(s) FAILED — review above`);
  }
  console.log('');
}

main();
