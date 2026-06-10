-- session_abuse_block: auto-block kids whose session is shared across >10 api keys.
-- Runs every 10 minutes (registered on the */10 cron trigger in src/worker/index.ts).
-- enabled defaults to 1 → on by default.
INSERT INTO cron_config (job) VALUES ('session_abuse_block');
