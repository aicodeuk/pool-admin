-- cron_config: per-job enable flag (checked at runtime; cron still fires but exits early if disabled)
CREATE TABLE cron_config (
  job        TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

INSERT INTO cron_config (job) VALUES ('status_sync'), ('token_refresh'), ('usage_sync');

-- cron_logs: execution history
CREATE TABLE cron_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job         TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  status      TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','ok','error')),
  result_json TEXT,
  error_text  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_cron_logs_job ON cron_logs(job, started_at DESC);
CREATE INDEX idx_cron_logs_started ON cron_logs(started_at DESC);
