-- Add provider dimension to kid_groups & kid_group_ranges.
-- A rule now applies only to its specified provider (claude / gpt / gemini).
-- Existing rows are discarded by request.

DROP TABLE IF EXISTS kid_groups;
CREATE TABLE kid_groups (
  kid        INTEGER NOT NULL,
  provider   TEXT    NOT NULL CHECK(provider IN ('claude','gpt','gemini')),
  group_name TEXT    NOT NULL,
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  PRIMARY KEY (kid, provider)
);
CREATE INDEX idx_kid_groups_name ON kid_groups(provider, group_name);

DROP TABLE IF EXISTS kid_group_ranges;
CREATE TABLE kid_group_ranges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kid_from   INTEGER NOT NULL,
  kid_to     INTEGER NOT NULL,
  provider   TEXT    NOT NULL CHECK(provider IN ('claude','gpt','gemini')),
  group_name TEXT    NOT NULL,
  note       TEXT,
  priority   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (kid_to >= kid_from)
);
CREATE INDEX idx_kid_group_ranges_lookup ON kid_group_ranges(provider, kid_from, kid_to);
