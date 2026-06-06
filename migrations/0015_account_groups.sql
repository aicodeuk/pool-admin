-- Multi-group support for accounts.
-- Previously each account belonged to exactly one group via accounts.group_name,
-- forcing one supplier credential to be duplicated across rows to join several groups.
-- This join table lets one account row belong to many groups.
--
-- accounts.group_name is kept for backward-compat but is no longer the source of
-- truth: all group reads/writes (including scheduling in pick.ts) use this table.

CREATE TABLE account_groups (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  group_name TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  PRIMARY KEY (account_id, group_name)
);

-- Scheduling looks up accounts by group: group_name -> account_id.
CREATE INDEX idx_account_groups_group ON account_groups(group_name, account_id);

-- Backfill: move each account's existing single group into the join table.
INSERT OR IGNORE INTO account_groups (account_id, group_name)
SELECT id, group_name FROM accounts
WHERE group_name IS NOT NULL AND group_name != '';
