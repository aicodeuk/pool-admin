-- Quality tier for tier-based account allocation.
-- Higher = better-quality channel; users may only consume accounts with
-- quality_tier <= their own user tier (passed via &user_tier= on /v2 sync endpoints).
-- 0 = default (broadest access); range typically 0..10.
ALTER TABLE accounts ADD COLUMN quality_tier INTEGER NOT NULL DEFAULT 0;

-- Composite index to accelerate the "filter by status/provider, order by quality_tier DESC" path.
CREATE INDEX idx_accounts_quality_tier
  ON accounts(provider, status, quality_tier);
