-- =============================================================================
-- Creative Intelligence (WS3 / US-005 + US-015) — persistent entity identity
-- =============================================================================
-- Idempotent + additive. Manual `supabase db push --linked`.
--
-- Turns creative_clusters into a DURABLE entity registry: cluster-creatives now
-- resolves creatives to EXISTING entities (match-not-regenerate) instead of the
-- delete+reinsert-with-new-uuid it did before. To support that the entity row
-- carries its centroid + anchor set (asset_keys + meta ids) + last_seen_at, and a
-- new 'exact' confidence tier marks entities grouped by a shared underlying asset
-- (US-005, zero model cost).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- 'exact' tier for asset-anchored (shared-asset) entities. Existing values stay
-- valid (subset), so re-adding the widened CHECK never fails on current rows.
ALTER TABLE public.creative_clusters
  DROP CONSTRAINT IF EXISTS creative_clusters_confidence_tier_check;
ALTER TABLE public.creative_clusters
  ADD CONSTRAINT creative_clusters_confidence_tier_check
  CHECK (confidence_tier IN ('exact', 'corroborated', 'probable', 'visual_only'));

ALTER TABLE public.creatives
  DROP CONSTRAINT IF EXISTS creatives_cluster_confidence_check;
ALTER TABLE public.creatives
  ADD CONSTRAINT creatives_cluster_confidence_check
  CHECK (cluster_confidence IS NULL
         OR cluster_confidence IN ('exact', 'corroborated', 'probable', 'visual_only'));

-- Persistent-identity columns on the entity registry.
ALTER TABLE public.creative_clusters
  ADD COLUMN IF NOT EXISTS centroid vector(512);           -- stored mean embedding for re-match
ALTER TABLE public.creative_clusters
  ADD COLUMN IF NOT EXISTS asset_keys text[];              -- PRIMARY exact anchors (media_assets.asset_key)
ALTER TABLE public.creative_clusters
  ADD COLUMN IF NOT EXISTS meta_video_ids text[];          -- secondary exact anchors (US-014)
ALTER TABLE public.creative_clusters
  ADD COLUMN IF NOT EXISTS meta_image_hashes text[];
ALTER TABLE public.creative_clusters
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;       -- bumped each run an entity is observed

COMMENT ON COLUMN public.creative_clusters.centroid IS
  'Mean embedding of the entity members; used to re-match creatives to this entity on later runs (US-015).';
COMMENT ON COLUMN public.creative_clusters.asset_keys IS
  'Entity anchor set (media_assets.asset_key). A creative sharing any anchor resolves to this SAME entity id — never a regenerated one.';
