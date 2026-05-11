-- Seed data for oppc-crm
-- Default admin user (password: admin123 — CHANGE IN PRODUCTION)

INSERT OR IGNORE INTO users (id, email, password_hash, name, company_name, role)
VALUES (
  'u-admin-001',
  'admin@opcc-crm.techforliving.net',
  '$2a$10$XQxBj0gYK5VGhHzVzqJ8OO1F6G7FLhLM3QKGqPONCqLNH0dJqFOce',
  'Admin',
  'OPPC',
  'admin'
);

-- Default Chart of Accounts
INSERT OR IGNORE INTO accounts (id, user_id, account_code, account_name, account_type, parent_code) VALUES
('acc-001', 'u-admin-001', '1000', 'Assets', 'asset', NULL),
('acc-002', 'u-admin-001', '1100', 'Current Assets', 'asset', '1000'),
('acc-003', 'u-admin-001', '1101', 'Cash', 'asset', '1100'),
('acc-004', 'u-admin-001', '1102', 'Accounts Receivable', 'asset', '1100'),
('acc-005', 'u-admin-001', '1103', 'Inventory', 'asset', '1100'),
('acc-006', 'u-admin-001', '1200', 'Fixed Assets', 'asset', '1000'),
('acc-007', 'u-admin-001', '2000', 'Liabilities', 'liability', NULL),
('acc-008', 'u-admin-001', '2100', 'Current Liabilities', 'liability', '2000'),
('acc-009', 'u-admin-001', '2101', 'Accounts Payable', 'liability', '2100'),
('acc-010', 'u-admin-001', '3000', 'Equity', 'equity', NULL),
('acc-011', 'u-admin-001', '3100', 'Retained Earnings', 'equity', '3000'),
('acc-012', 'u-admin-001', '4000', 'Revenue', 'revenue', NULL),
('acc-013', 'u-admin-001', '4100', 'Sales Revenue', 'revenue', '4000'),
('acc-014', 'u-admin-001', '4200', 'Service Revenue', 'revenue', '4000'),
('acc-015', 'u-admin-001', '5000', 'Expenses', 'expense', NULL),
('acc-016', 'u-admin-001', '5100', 'Cost of Goods Sold', 'expense', '5000'),
('acc-017', 'u-admin-001', '5200', 'Operating Expenses', 'expense', '5000'),
('acc-018', 'u-admin-001', '5201', 'Rent', 'expense', '5200'),
('acc-019', 'u-admin-001', '5202', 'Utilities', 'expense', '5200'),
('acc-020', 'u-admin-001', '5203', 'Salaries', 'expense', '5200');
