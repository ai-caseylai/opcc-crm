# TeCS Development Progress

> Updated 2026-07-30

## Completed

### Direction & OCR
- Direction standardization (incoming/outgoing) — DB migration, API, frontend
- Server-side direction filtering (`?direction=incoming|outgoing`)
- AI OCR: regex pre-extraction for vendor/customer, improved prompt, post-AI correction
- Direction toggle on invoice review page

### Review Flags
- `needs_review` column: direction, company_not_detected, duplicate
- Icons in Invoices/AP/AR/Receipts list views with tooltips
- Banners on review page: direction unclear, company not detected, duplicate (active/deleted), auto-linked
- Flags passed through all navigation paths

### Receipts & Linking
- Flexible numbering: generateReceiptNumber, detectOwnNumber, counterparty_ref
- Shared lib: `api/src/lib/numbering.ts`
- Receipt-to-invoice auto-linking by amount (bidirectional AR+AP)
- Missing-receipt flag on AR list
- Receipt UI: tabs (All/Linked/Unlinked), create/view modals, link column

### Bank Matching
- Auto-match extended to receipts + invoices
- Dedup for linked pairs
- Journal dedup guard on confirm (journal_skipped flag)

### File Storage
- 5 folders: Bank Statements, Card Statements, Invoices, Receipts, Others
- Invoice delete cascades to file_record
- Card statement auto-detection

### Batch Upload
- FileUpload.tsx: skipNavigation + pushToQueue with sessionStorage queue
- FileStorage.tsx: onFileStorage guard prevents redirect when user navigated away
- Review pages: goNextInQueue() advances to next queued item on save/discard

### Duplicate Handling
- Never blocks — always creates pending_review and shows preview
- Duplicate status: active vs deleted (soft-deleted)
- Review page banner explains the distinction
- Content hash check as soft flag, not hard block

### Soft-Delete Audit
- 60+ queries fixed across bank-statements.ts, card-statements.ts, file-storage.ts, bookkeeping.ts
- `deleted_at IS NULL` filter on all read queries for soft-deletable tables

### UI/UX
- Sidebar: wider, company name wraps, fresh API data
- Demo Company 1 → "Proficiency and Reliance Company Limited"
- i18n: Send AR/AP direction-aware, button tooltips
- Bank statement confirm: idempotent (no "Already confirmed" error on double-click)

### DB Migrations
- receipt_number_pattern, counterparty_ref, linked_invoice_id, needs_review, content_hash

### Test Results
- **54/54 ALL PASSED**
- Direction: 18/18, Banks: 3/3, Invoices: 18/18, Receipts: 12/12, Links: 1, Matches: 3

---

## Deployment
- **Frontend**: `https://e75644da.opcc-crm-testing.pages.dev`
- **API**: `https://opcc-crm-api.ruhan-farhan.workers.dev`
- **GitHub**: `https://github.com/techconnsme/development_code.git`

## Pending
- [ ] Company-owned Cloudflare account migration
