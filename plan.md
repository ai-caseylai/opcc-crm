# TeCS Development Progress

> Updated 2026-07-30

---

## Completed Features

### Direction Standardization
- [x] Standardize `direction` to `incoming`/`outgoing` across DB, API, frontend
- [x] DB migration: 1 `income` row → `outgoing`, `file_records` NULLs fixed
- [x] Server-side filtering: `?direction=incoming|outgoing`
- [x] Direction toggle on Invoice Review page
- [x] AI OCR improvements: regex pre-extraction, improved prompt, post-AI correction

### Review Flags
- [x] `needs_review` column on invoices (direction, company_not_detected, duplicate)
- [x] Flag icons in Invoices, AP, AR list views with tooltips
- [x] Review page banners: direction unclear, company not detected, duplicate, auto-linked
- [x] Flags passed through all navigation paths (FileStorage, FileUpload, RecycleBin)

### Receipts & Linking
- [x] Flexible numbering: `generateReceiptNumber()`, `detectOwnNumber()`, `counterparty_ref`
- [x] Shared lib: `api/src/lib/numbering.ts`
- [x] `receipt_number_pattern` and `counterparty_ref` columns
- [x] Receipt-to-invoice auto-linking by amount (bidirectional AR+AP)
- [x] Missing-receipt flag on AR list (sent invoices without linked receipt)

### Bank Matching
- [x] Auto-match extended to receipts (category IN invoice,receipt)
- [x] Dedup for linked invoice-receipt pairs
- [x] `doc_type` field in match response

### File Storage
- [x] Reorganized into 5 folders: Bank Statements, Card Statements, Invoices, Receipts, Others
- [x] No more per-partner subfolders
- [x] Card statement auto-detection added
- [x] Invoice delete also removes linked file_record

### UI/UX
- [x] Sidebar: wider (280-340px), company name wraps
- [x] Company dropdown: fresh API data (not stale localStorage)
- [x] Demo Company 1 → "Proficiency and Reliance Company Limited" (DB fix)
- [x] i18n: Send AR/AP direction-aware, button tooltips use tr()
- [x] Review banner text mentions "AI OCR"

---

## Test Results (2026-07-30)
- **54/54 ALL PASSED** 🎉
- Direction detection: **18/18 correct** (100%)
- Bank import: **3/3** with 15+21+16 transactions
- Invoice import: **18/18** imported with correct direction
- Receipt import: **12/12** imported, ACME $30K auto-linked
- Auto-match: **3 matched** (BAKER_MCKENZIE $34K, RENT $99.5K ↔ bank withdrawals)

---

## Deployment URLs
- **Frontend**: `https://be377ae6.opcc-crm-testing.pages.dev`
- **API**: `https://opcc-crm-api.ruhan-farhan.workers.dev`
- **GitHub**: `https://github.com/techconnsme/development_code.git`

---

## Pending
- [x] Fix D1 bind bug in `importStatementFromFile` — INSERT SQL was accidentally deleted from empty draft fallback
- [x] Receipt UI rewrite — tabs (All/Linked/Unlinked), create form, view modal, review flags, link status column
- [ ] Company-owned Cloudflare account migration (see memory: tecs-deployment-state)
