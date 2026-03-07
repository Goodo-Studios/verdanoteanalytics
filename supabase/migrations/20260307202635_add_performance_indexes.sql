-- Performance indexes for creatives table
-- idx_creatives_ad_id: speeds up lookups and joins on ad_id
-- idx_creatives_search_gin: full-text GIN index for ilike search on ad_name, unique_code, campaign_name

-- Composite index on account_id + spend (DESC) — matches the most common query pattern
-- (list creatives by account ordered by spend)
CREATE INDEX IF NOT EXISTS idx_creatives_account_spend
  ON creatives (account_id, spend DESC);

-- Index on ad_id for fast single-row lookups and batch IN queries
CREATE INDEX IF NOT EXISTS idx_creatives_ad_id
  ON creatives (ad_id);

-- GIN index for trigram search on ad_name, unique_code, campaign_name
-- Requires pg_trgm extension (enabled by default on Supabase)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_creatives_search_gin
  ON creatives USING GIN (
    (ad_name || ' ' || COALESCE(unique_code, '') || ' ' || COALESCE(campaign_name, '')) gin_trgm_ops
  );

-- Index on tag_source for untagged count queries
CREATE INDEX IF NOT EXISTS idx_creatives_tag_source
  ON creatives (account_id, tag_source);
