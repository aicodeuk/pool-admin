-- Add priority field to accounts for weighted random selection.
-- Higher priority = selected more often. Default 0 (all equal).
ALTER TABLE accounts ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
