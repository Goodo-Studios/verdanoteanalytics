-- =============================================================================
-- Creative Intelligence (WS3 / US-014) — persist Meta creative/asset identifiers
-- =============================================================================
-- Idempotent + additive. Manual `supabase db push --linked`.
--
-- The sync already fetches creative{effective_object_story_id, object_story_spec,
-- asset_feed_spec}; this persists the identifiers inside them as SECONDARY entity
-- anchors (US-015). The PRIMARY within-account exact anchor remains
-- media_assets.asset_key (content SHA-256). Populated going forward by the sync
-- forward-fill (no new Meta calls); a scoped backfill can re-derive later.
-- =============================================================================

ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS meta_video_ids text[];          -- ordered; dynamic ads may have several
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS meta_image_hashes text[];
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS effective_object_story_id text; -- published post id (page_post)
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS meta_creative_id text;

COMMENT ON COLUMN public.creatives.meta_video_ids IS
  'Ordered Meta video ids from object_story_spec/asset_feed_spec (US-014). Secondary exact anchor for entity resolution; primary anchor is media_assets.asset_key.';
COMMENT ON COLUMN public.creatives.meta_image_hashes IS
  'Meta image hashes from the creative spec (US-014). Secondary exact anchor.';
COMMENT ON COLUMN public.creatives.effective_object_story_id IS
  'Published post id (page_id_post_id). Ads sharing a post are the same underlying creative — a strong entity signal (US-015).';

-- GIN indexes so "shares any video_id / image_hash" exact-match lookups (US-005/015)
-- are fast; btree on the post id for the shared-post grouping.
CREATE INDEX IF NOT EXISTS idx_creatives_meta_video_ids
  ON public.creatives USING gin (meta_video_ids);
CREATE INDEX IF NOT EXISTS idx_creatives_meta_image_hashes
  ON public.creatives USING gin (meta_image_hashes);
CREATE INDEX IF NOT EXISTS idx_creatives_effective_object_story_id
  ON public.creatives (account_id, effective_object_story_id)
  WHERE effective_object_story_id IS NOT NULL;
