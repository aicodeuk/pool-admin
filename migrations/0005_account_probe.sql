-- Track last time an account was probed after a client problem report.
-- Used to debounce repeated probes for the same account.
ALTER TABLE accounts ADD COLUMN last_probed_at TEXT;
