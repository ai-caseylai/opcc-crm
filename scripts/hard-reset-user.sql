-- Hard reset: delete ALL data for a specific user
-- Replace USER_ID before running
-- Usage: wrangler d1 execute opcc-crm-db --remote --command="<paste each statement>"

-- 1. Break circular FKs
UPDATE invoices SET linked_invoice_id = NULL WHERE user_id = 'USER_ID';

-- 2. Delete child tables first (FK order)
DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE user_id = 'USER_ID');
DELETE FROM card_transactions WHERE user_id = 'USER_ID';
DELETE FROM bank_transactions WHERE user_id = 'USER_ID';
DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE user_id = 'USER_ID');

-- 3. Delete main tables
DELETE FROM invoices WHERE user_id = 'USER_ID';
DELETE FROM bank_statements WHERE user_id = 'USER_ID';
DELETE FROM card_statements WHERE user_id = 'USER_ID';
DELETE FROM journal_entries WHERE user_id = 'USER_ID';
DELETE FROM file_records WHERE user_id = 'USER_ID';

-- 4. Delete related entities
DELETE FROM customers WHERE user_id = 'USER_ID';
DELETE FROM suppliers WHERE user_id = 'USER_ID';
DELETE FROM products WHERE user_id = 'USER_ID';

-- 5. Optional: reset company settings to defaults
-- UPDATE company_settings SET name = NULL, address = NULL WHERE user_id = 'USER_ID';

-- 6. Verify
SELECT 'invoices' as tbl, COUNT(*) FROM invoices WHERE user_id = 'USER_ID'
UNION ALL SELECT 'bank_stmts', COUNT(*) FROM bank_statements WHERE user_id = 'USER_ID'
UNION ALL SELECT 'card_stmts', COUNT(*) FROM card_statements WHERE user_id = 'USER_ID'
UNION ALL SELECT 'journal', COUNT(*) FROM journal_entries WHERE user_id = 'USER_ID'
UNION ALL SELECT 'files', COUNT(*) FROM file_records WHERE user_id = 'USER_ID'
UNION ALL SELECT 'customers', COUNT(*) FROM customers WHERE user_id = 'USER_ID';
