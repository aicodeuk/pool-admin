CREATE TABLE sync_logs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  provider            TEXT NOT NULL,
  kid                 INTEGER,
  force_replace       INTEGER NOT NULL DEFAULT 0,
  is_max              INTEGER,
  aid                 INTEGER,
  assigned_account_id INTEGER,
  http_status         INTEGER NOT NULL,
  details             TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

CREATE INDEX idx_sync_logs_created ON sync_logs(created_at);
CREATE INDEX idx_sync_logs_force   ON sync_logs(force_replace, created_at);
CREATE INDEX idx_sync_logs_aid     ON sync_logs(aid);

-- Auto-cleanup: keep only last 24 hours
CREATE TRIGGER sync_logs_cleanup AFTER INSERT ON sync_logs
BEGIN
  DELETE FROM sync_logs WHERE created_at < strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-24 hours'));
END;
