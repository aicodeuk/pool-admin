CREATE TABLE IF NOT EXISTS kid_group_ranges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kid_from   INTEGER NOT NULL,
  kid_to     INTEGER NOT NULL,
  group_name TEXT    NOT NULL,
  note       TEXT,
  priority   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (kid_to >= kid_from)
);

CREATE INDEX IF NOT EXISTS idx_kid_group_ranges_kid ON kid_group_ranges (kid_from, kid_to);
