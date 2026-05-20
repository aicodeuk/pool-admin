-- Add keep_active flag to prevent automatic offline/termination of special accounts
ALTER TABLE accounts ADD COLUMN keep_active INTEGER NOT NULL DEFAULT 0 CHECK(keep_active IN (0,1));
CREATE INDEX idx_accounts_keep_active ON accounts(keep_active);
