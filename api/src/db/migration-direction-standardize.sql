-- Migration: Standardize invoice direction values to 'incoming' / 'outgoing'
-- Run with: wrangler d1 execute opcc-crm-db --remote --file=migration-direction-standardize.sql
-- Safe to re-run: idempotent

-- 1. Migrate existing data
UPDATE invoices SET direction = 'outgoing' WHERE direction = 'income';
UPDATE invoices SET direction = 'incoming' WHERE direction = 'expense';

-- 2. Catch any NULLs or unknown values — default to 'outgoing'
UPDATE invoices SET direction = 'outgoing' WHERE direction IS NULL OR direction NOT IN ('incoming', 'outgoing');

-- 3. Also fix file_records (few NULLs from old uploads)
UPDATE file_records SET direction = 'outgoing' WHERE category = 'invoice' AND (direction IS NULL OR direction NOT IN ('incoming', 'outgoing'));
