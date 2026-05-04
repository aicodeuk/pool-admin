-- Recreate kid_groups without any foreign key constraint.
-- kid is a free integer (API key ID from the gateway), not required to exist in any local table.
CREATE TABLE kid_groups_new (
  kid        INTEGER PRIMARY KEY,
  group_name TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
INSERT INTO kid_groups_new SELECT kid, group_name, note, created_at, updated_at FROM kid_groups;
DROP TABLE kid_groups;
ALTER TABLE kid_groups_new RENAME TO kid_groups;
CREATE INDEX idx_kid_groups_name ON kid_groups(group_name);
