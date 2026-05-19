-- One-time migrations (safe to ignore errors)
-- Run: npx wrangler d1 execute oppc-crm-db --remote --file=src/db/migrate-once.sql

ALTER TABLE bank_transactions ADD COLUMN account_code TEXT;
ALTER TABLE invoices ADD COLUMN br_number TEXT;

-- Compliance columns for company_settings
ALTER TABLE company_settings ADD COLUMN br_number TEXT;
ALTER TABLE company_settings ADD COLUMN br_expiry_date TEXT;
ALTER TABLE company_settings ADD COLUMN ci_number TEXT;
ALTER TABLE company_settings ADD COLUMN industry TEXT DEFAULT 'general';
ALTER TABLE company_settings ADD COLUMN employee_count INTEGER DEFAULT 0;
ALTER TABLE company_settings ADD COLUMN fiscal_year_end TEXT DEFAULT '03-31';
ALTER TABLE company_settings ADD COLUMN secretary_name TEXT;
ALTER TABLE company_settings ADD COLUMN secretary_contact TEXT;
ALTER TABLE company_settings ADD COLUMN auditor_name TEXT;
ALTER TABLE company_settings ADD COLUMN auditor_contact TEXT;
