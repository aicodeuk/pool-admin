-- Recreate accounts without any foreign key constraints.
-- The remote DB (migrated from the Go service) has FK constraints on group_name and other
-- columns that don't exist in this schema. Rebuild cleanly.
PRAGMA foreign_keys = OFF;

CREATE TABLE accounts_new (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  provider                  TEXT NOT NULL CHECK(provider IN ('claude','gpt','gemini')),
  email                     TEXT,
  name                      TEXT,
  access_token              TEXT,
  access_token_expires_at   TEXT,
  refresh_token             TEXT,
  refresh_token_expires_at  TEXT,
  proxy_id                  INTEGER,
  account_level             INTEGER NOT NULL DEFAULT 1,
  group_name                TEXT,
  user_id                   TEXT,
  multiplier                REAL NOT NULL DEFAULT 4.0,
  tier                      TEXT NOT NULL DEFAULT 'pro' CHECK(tier IN ('free','pro','max')),
  total_capacity            INTEGER NOT NULL DEFAULT 10,
  used_count                INTEGER NOT NULL DEFAULT 0,
  available_count           INTEGER GENERATED ALWAYS AS (total_capacity - used_count) VIRTUAL,
  status                    TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','problem','exhausted')),
  status_reason             TEXT,
  status_changed_at         TEXT,
  retry_after               TEXT,
  last_test_response        TEXT,
  is_third_party            INTEGER NOT NULL DEFAULT 0 CHECK(is_third_party IN (0,1)),
  third_party_api_url       TEXT,
  project                   TEXT,
  purchase_date             TEXT,
  expire_date               TEXT,
  usage_5h_pct              REAL,
  usage_5h_resets_at        TEXT,
  usage_7d_pct              REAL,
  usage_7d_resets_at        TEXT,
  usage_7d_sonnet_pct       REAL,
  usage_7d_sonnet_resets_at TEXT,
  usage_updated_at          TEXT,
  usage_error               TEXT,
  last_probed_at            TEXT,
  priority                  INTEGER NOT NULL DEFAULT 0,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  deleted_at                TEXT
);

INSERT INTO accounts_new (
  id, provider, email, name,
  access_token, access_token_expires_at, refresh_token, refresh_token_expires_at,
  proxy_id, account_level, group_name, user_id, multiplier, tier,
  total_capacity, used_count,
  status, status_reason, status_changed_at, retry_after, last_test_response,
  is_third_party, third_party_api_url, project,
  purchase_date, expire_date,
  usage_5h_pct, usage_5h_resets_at,
  usage_7d_pct, usage_7d_resets_at,
  usage_7d_sonnet_pct, usage_7d_sonnet_resets_at,
  usage_updated_at, usage_error,
  last_probed_at, priority,
  created_at, updated_at, deleted_at
)
SELECT
  id, provider, email, name,
  access_token, access_token_expires_at, refresh_token, refresh_token_expires_at,
  proxy_id, account_level, group_name, user_id, multiplier, tier,
  total_capacity, used_count,
  status, status_reason, status_changed_at, retry_after, last_test_response,
  is_third_party, third_party_api_url, project,
  purchase_date, expire_date,
  usage_5h_pct, usage_5h_resets_at,
  usage_7d_pct, usage_7d_resets_at,
  usage_7d_sonnet_pct, usage_7d_sonnet_resets_at,
  usage_updated_at, usage_error,
  last_probed_at, priority,
  created_at, updated_at, deleted_at
FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

CREATE INDEX idx_accounts_pick   ON accounts(provider, status, group_name, account_level);
CREATE INDEX idx_accounts_proxy  ON accounts(proxy_id);
CREATE INDEX idx_accounts_expire ON accounts(expire_date);
CREATE INDEX idx_accounts_deleted ON accounts(deleted_at);
CREATE INDEX idx_accounts_third  ON accounts(provider, is_third_party);

PRAGMA foreign_keys = ON;
