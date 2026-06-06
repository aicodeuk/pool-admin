-- Per-account RPM (requests-per-minute) rate limiting.
-- rpm_limit: admin-set cap, 0 = unlimited (default; existing accounts keep old behavior).
-- rpm_current: measured RPM, refreshed every minute by the rpm-sync cron from
--   Elasticsearch (last-2-min request count / 2 across claude-* and request-*).
-- The scheduler skips an account for NEW assignments when rpm_limit > 0 AND
-- rpm_current >= rpm_limit.
ALTER TABLE accounts ADD COLUMN rpm_limit      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN rpm_current    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN rpm_updated_at TEXT;
