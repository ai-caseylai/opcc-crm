-- Card Statements feature — schema
-- Mirrors bank_statements but with card-specific fields
-- All statement-level fields are nullable — card statements vary by issuer

CREATE TABLE IF NOT EXISTS card_statements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  file_name TEXT,
  file_type TEXT DEFAULT 'application/pdf',
  file_data TEXT DEFAULT '',
  r2_key TEXT,
  card_issuer TEXT,              -- e.g. 'HSBC', 'Standard Chartered', 'Amex'
  card_network TEXT,             -- 'Visa', 'MasterCard', 'Amex', 'UnionPay'
  card_number_last4 TEXT,        -- last 4 digits (often shown on statement)
  cardholder_name TEXT,          -- name on card
  currency TEXT DEFAULT 'HKD',
  statement_year INTEGER,
  statement_month INTEGER,
  period_start TEXT,
  period_end TEXT,
  credit_limit REAL,             -- may not appear on every statement
  opening_balance REAL,          -- may not appear on every statement
  closing_balance REAL,
  minimum_payment REAL,          -- may not appear on every statement
  payment_due_date TEXT,
  ocr_text TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- 'draft' | 'active'
  deleted_at TEXT,               -- soft-delete
  deleted_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_transactions (
  id TEXT PRIMARY KEY,
  card_statement_id TEXT NOT NULL REFERENCES card_statements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  transaction_date TEXT NOT NULL,
  posting_date TEXT,             -- transaction posted date (may differ from transaction_date)
  description TEXT NOT NULL,
  amount REAL DEFAULT 0,         -- single amount (card transactions are always positive amounts)
  transaction_type TEXT,         -- 'purchase', 'payment', 'refund', 'fee', 'interest', 'cash_advance'
  foreign_currency TEXT,         -- original currency if foreign transaction
  foreign_amount REAL,           -- amount in foreign currency
  category TEXT,                 -- card issuer category (e.g. 'Dining', 'Travel', 'Shopping')
  reference TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  expense_account_code TEXT,     -- COA expense account code for categorization
  match_status TEXT NOT NULL DEFAULT 'unmatched',  -- 'unmatched' | 'categorized' | 'reviewed'
  deleted_at TEXT,               -- soft-delete
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_card_statements_user ON card_statements(user_id);
CREATE INDEX IF NOT EXISTS idx_card_statements_period ON card_statements(user_id, statement_year, statement_month);
CREATE INDEX IF NOT EXISTS idx_card_transactions_stmt ON card_transactions(card_statement_id);
CREATE INDEX IF NOT EXISTS idx_card_transactions_user ON card_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_card_transactions_date ON card_transactions(user_id, transaction_date);
