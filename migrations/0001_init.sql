-- Pool Admin D1 schema
-- Time format: TEXT 'YYYY-MM-DD HH:MM:SS' (UTC) for timestamps, 'YYYY-MM-DD' for dates
-- All AUTOINCREMENT id columns start from 1

-- ============================================================
-- proxies: HTTP / SOCKS5 proxy pool
-- ============================================================
CREATE TABLE proxies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT,
  host            TEXT NOT NULL,
  port            INTEGER NOT NULL,
  username        TEXT,
  password        TEXT,
  scheme          TEXT NOT NULL DEFAULT 'http' CHECK(scheme IN ('http','socks5')),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE UNIQUE INDEX uk_proxy_endpoint ON proxies(host, port, COALESCE(username,''));
CREATE INDEX idx_proxy_active ON proxies(is_active);


-- ============================================================
-- groups: free-text strings stored on accounts.group_name and kid_groups.group_name.
-- Behavior derives from name prefix:
--   'channel_*' = strict binding, no fallback
--   'org_*'     = may fallback to channel_max / channel_aws_chip / channel_api
--   anything else = normal
-- No registry table; admins type group names freely.
-- ============================================================


-- ============================================================
-- accounts: unified Claude / GPT / Gemini accounts
-- ============================================================
CREATE TABLE accounts (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider                    TEXT NOT NULL CHECK(provider IN ('claude','gpt','gemini')),
  email                       TEXT,
  name                        TEXT,                                       -- memo / remark

  -- OAuth tokens
  access_token                TEXT,
  access_token_expires_at     TEXT,                                       -- 'YYYY-MM-DD HH:MM:SS'
  refresh_token               TEXT,
  refresh_token_expires_at    TEXT,

  -- Egress
  proxy_id                    INTEGER REFERENCES proxies(id) ON DELETE SET NULL,

  -- Scheduling parameters
  account_level               INTEGER NOT NULL DEFAULT 1,
  group_name                  TEXT,
  user_id                     TEXT,                                       -- e.g. user_7f4b...
  multiplier                  REAL NOT NULL DEFAULT 4.0,
  tier                        TEXT NOT NULL DEFAULT 'pro' CHECK(tier IN ('free','pro','max')),

  -- Capacity
  total_capacity              INTEGER NOT NULL DEFAULT 10,
  used_count                  INTEGER NOT NULL DEFAULT 0,
  available_count             INTEGER GENERATED ALWAYS AS (total_capacity - used_count) VIRTUAL,

  -- Status (consolidated from is_active / is_available / has_problem)
  status                      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','problem','exhausted')),
  status_reason               TEXT,
  status_changed_at           TEXT,
  retry_after                 TEXT,
  last_test_response          TEXT,

  -- Third-party API fallback layer
  is_third_party              INTEGER NOT NULL DEFAULT 0 CHECK(is_third_party IN (0,1)),
  third_party_api_url         TEXT,

  -- Gemini-specific
  project                     TEXT,

  -- Renewal (default purchase = today, expire = +30 days)
  purchase_date               TEXT,                                       -- 'YYYY-MM-DD'
  expire_date                 TEXT,                                       -- 'YYYY-MM-DD'

  -- Claude usage snapshot
  usage_5h_pct                REAL,
  usage_5h_resets_at          TEXT,
  usage_7d_pct                REAL,
  usage_7d_resets_at          TEXT,
  usage_7d_sonnet_pct         REAL,
  usage_7d_sonnet_resets_at   TEXT,
  usage_updated_at            TEXT,
  usage_error                 TEXT,

  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  deleted_at                  TEXT
);

CREATE INDEX idx_accounts_pick     ON accounts(provider, status, group_name, account_level);
CREATE INDEX idx_accounts_proxy    ON accounts(proxy_id);
CREATE INDEX idx_accounts_expire   ON accounts(expire_date);
CREATE INDEX idx_accounts_deleted  ON accounts(deleted_at);
CREATE INDEX idx_accounts_third    ON accounts(provider, is_third_party);


-- ============================================================
-- kid_groups: API key (kid) -> group binding
-- ============================================================
CREATE TABLE kid_groups (
  kid             INTEGER PRIMARY KEY,
  group_name      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_kid_groups_name ON kid_groups(group_name);


-- ============================================================
-- kid_mappings: kid -> account assignment cache
-- ============================================================
CREATE TABLE kid_mappings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kid             INTEGER NOT NULL,
  provider        TEXT NOT NULL CHECK(provider IN ('claude','gpt','gemini')),
  account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE UNIQUE INDEX uk_kid_provider     ON kid_mappings(kid, provider);
CREATE INDEX idx_kid_mappings_account   ON kid_mappings(account_id);


-- ============================================================
-- audit_logs: admin operation history
-- ============================================================
CREATE TABLE audit_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  actor           TEXT,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       INTEGER,
  diff_json       TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_target  ON audit_logs(target_type, target_id);
