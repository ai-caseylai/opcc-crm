ALTER TABLE file_records ADD COLUMN content_hash TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_file_records_hash ON file_records(user_id, content_hash);
