-- Add balance verification audit columns to bank_statements and card_statements
-- balance_status: 'unchecked' | 'ok' | 'mismatch' | 'manual'
-- balance_check: JSON string { expected, actual, diff, corrected_by_user }

ALTER TABLE bank_statements ADD COLUMN balance_status TEXT DEFAULT 'unchecked';
ALTER TABLE bank_statements ADD COLUMN balance_check TEXT;

ALTER TABLE card_statements ADD COLUMN balance_status TEXT DEFAULT 'unchecked';
ALTER TABLE card_statements ADD COLUMN balance_check TEXT;
