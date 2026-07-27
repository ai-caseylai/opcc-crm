-- Safe migration: adds columns only if they don't already exist
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE
-- so we use separate statements and ignore errors individually

-- Add status column (pending/active/suspended)
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- Add must_change_password flag
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

-- Add parent_user_id for staff accounts
ALTER TABLE users ADD COLUMN parent_user_id TEXT REFERENCES users(id);

-- Applications table for the apply flow
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(email);
