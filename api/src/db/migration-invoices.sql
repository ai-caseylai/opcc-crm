-- Migration: Extend invoices for PDF-driven workflow + add expense invoice direction
-- Run with: wrangler d1 execute opcc-crm-db --remote --file=migration-invoices.sql
-- Safe to re-run: each ALTER TABLE will error on existing columns, but the rest will still run.

-- 1. Add customer_name (extracted text from PDF; resolved to customer_id later)
ALTER TABLE invoices ADD COLUMN customer_name TEXT;

-- 2. Link back to the originating PDF file
ALTER TABLE invoices ADD COLUMN file_id TEXT;

-- 3. Income (we billed someone) vs expense (vendor billed us)
ALTER TABLE invoices ADD COLUMN direction TEXT DEFAULT 'income';

-- 4. For expense invoices, who issued it (the vendor)
ALTER TABLE invoices ADD COLUMN supplier_name TEXT;

-- 5. Index for matching
CREATE INDEX IF NOT EXISTS idx_invoices_direction ON invoices(user_id, direction, status);
CREATE INDEX IF NOT EXISTS idx_invoices_file ON invoices(file_id);
