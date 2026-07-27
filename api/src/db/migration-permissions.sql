-- Migration: two-tier permissions + soft delete + 30-day retention
-- Run: npx wrangler d1 execute opcc-crm-db --remote --file=src/db/migration-permissions.sql

-- 1. Add permission tier (normal / higher)
-- On firm_members: only 'higher' can hard-delete or permanently delete
ALTER TABLE firm_members ADD COLUMN permission_tier TEXT DEFAULT 'normal';
-- For non-firm users, we also carry it on users so an SME solo boss counts as 'higher'
ALTER TABLE users ADD COLUMN permission_tier TEXT DEFAULT 'higher';

-- 2. Soft delete timestamps on the main tables
ALTER TABLE bank_statements ADD COLUMN deleted_at TEXT;
ALTER TABLE bank_statements ADD COLUMN deleted_by TEXT;
ALTER TABLE bank_transactions ADD COLUMN deleted_at TEXT;
ALTER TABLE invoices ADD COLUMN deleted_at TEXT;
ALTER TABLE invoices ADD COLUMN deleted_by TEXT;
ALTER TABLE file_records ADD COLUMN deleted_at TEXT;
ALTER TABLE file_records ADD COLUMN deleted_by TEXT;

-- 3. Indexes for filtering
CREATE INDEX IF NOT EXISTS idx_bs_deleted ON bank_statements(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_bt_deleted ON bank_transactions(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_inv_deleted ON invoices(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_fr_deleted ON file_records(user_id, deleted_at);

-- 4. Set current user (opcc-crm.pages.dev owner) to 'higher' so they can access recycle bin
-- Set all existing firm_members admins to 'higher'
UPDATE firm_members SET permission_tier = 'higher' WHERE role = 'admin';
