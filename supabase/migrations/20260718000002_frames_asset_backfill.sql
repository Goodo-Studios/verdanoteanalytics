-- =============================================================================
-- Carousel-frame ASSET backfill: honest frames_ok + a feeder path for pending frames
-- =============================================================================
-- Idempotent + additive. Manual `supabase db push --linked`.
--
-- Problem: a carousel frame shows "Frame pending" in the UI when its creative_frames
-- row exists but asset_id is NULL (no card image cached). Sync writes the frame ledger
-- best-effort within a per-batch budget and leaves late frames unlinked, and NOTHING
-- re-caches them. Worse, media_coverage.frames_ok counted the ROW
-- (COUNT(*) >= expected_frame_count), not whether the image was cached — so a fully-
-- pending carousel read as "covered" and was invisible to the self-heal feeder
-- (frames_incomplete was 0 even with unlinked frames). This migration:
--   1. makes frames_ok count only frames whose ASSET is cached (asset_id IS NOT NULL);
--   2. adds a per-ad frame retry clock (frames_retry_count / frames_retry_after) so the
--      drain can back off a genuinely-unresolvable frame gap (churn guard);
--   3. adds 'frames_incomplete' to the self-heal feeder (honoring that backoff), so
--      carousels with pending frames are enqueued for the drain's new frame-asset
--      backfill (drain-media-queue backfillFrameAssets).
--
-- NO REGRESSION: an ad with expected_frame_count NULL/<=1 is still trivially frames_ok
-- (single-asset ads, and every pre-frames row). Only genuine multi-frame ads are held
-- to "every expected frame's image is cached". Coverage will honestly RECLASSIFY some
-- carousels that were previously (wrongly) "covered" into 'frames_incomplete' — that is
-- the point: the gap becomes visible and self-heals.
--
-- Numbering: 20260718000002 follows 20260718000001_media_meta_cache.
-- =============================================================================

-- ── 1. Per-ad frame retry clock (mirrors thumb_/video_retry_after) ────────────
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS frames_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frames_retry_after timestamptz;

COMMENT ON COLUMN public.creatives.frames_retry_after IS
  'Carousel-frame backfill backoff (mirrors thumb_/video_retry_after). Set by drain-media-queue when a frame image cannot be resolved this pass; the feeder skips the ad until it passes. NULL = due now. Churn guard for frames_incomplete.';

-- ── 2. frames_ok = every expected frame''s IMAGE ASSET is cached ───────────────
-- Only the frame_counts CTE changes vs 20260714000027: count frames with a linked
-- asset, not bare rows. The view''s column list is IDENTICAL, so the dependent
-- get_media_coverage RPC does not need recreating.
CREATE OR REPLACE VIEW public.media_coverage AS
WITH eligible AS (
  SELECT
    c.ad_id, c.account_id, c.ad_name, c.ad_status, c.impressions,
    c.thumbnail_url, c.full_res_url, c.video_url, c.expected_frame_count
  FROM public.creatives c
  WHERE COALESCE(UPPER(c.ad_status), 'UNKNOWN') <> 'ARCHIVED'
    AND COALESCE(c.impressions, 0) > 0
),
classified AS (
  SELECT
    e.*,
    (e.full_res_url IS NOT NULL AND e.full_res_url <> 'no-thumbnail') AS image_ok,
    (e.video_url IS NOT NULL) AS is_video_ad,
    (e.video_url IS NULL OR e.video_url LIKE '%/storage/v1/object/public/%') AS video_ok
  FROM eligible e
),
frame_counts AS (
  -- US-#3: count only frames whose IMAGE ASSET is actually cached (asset_id set). A
  -- "Frame pending" card (row present, asset_id NULL) must NOT count toward frames_ok.
  SELECT cf.ad_id, COUNT(*) FILTER (WHERE cf.asset_id IS NOT NULL)::int AS captured_frames
  FROM public.creative_frames cf
  GROUP BY cf.ad_id
),
frames AS (
  SELECT
    cl.*,
    COALESCE(fc.captured_frames, 0) AS captured_frames,
    (
      cl.expected_frame_count IS NULL
      OR cl.expected_frame_count <= 1
      OR COALESCE(fc.captured_frames, 0) >= cl.expected_frame_count
    ) AS frames_ok
  FROM classified cl
  LEFT JOIN frame_counts fc ON fc.ad_id = cl.ad_id
)
SELECT
  f.ad_id, f.account_id, f.ad_name, f.ad_status, f.impressions,
  f.image_ok, f.video_ok, f.frames_ok, f.is_video_ad,
  (f.image_ok AND f.video_ok AND f.frames_ok) AS covered,
  CASE
    WHEN (f.image_ok AND f.video_ok AND f.frames_ok) THEN NULL
    WHEN NOT f.image_ok
      AND (f.full_res_url IS NULL OR f.full_res_url = 'no-thumbnail')
      AND f.thumbnail_url IS NOT NULL
      AND f.thumbnail_url <> 'no-thumbnail'
      THEN 'image_low_res'
    WHEN NOT f.image_ok AND f.thumbnail_url = 'no-thumbnail' THEN 'image_missing'
    WHEN NOT f.image_ok THEN 'image_missing'
    WHEN NOT f.video_ok AND f.video_url = 'no-video-permission' THEN 'video_permission'
    WHEN NOT f.video_ok AND f.video_url = 'no-video-deleted' THEN 'video_deleted'
    WHEN NOT f.video_ok AND f.video_url = 'no-video' THEN 'video_unresolved'
    WHEN NOT f.video_ok THEN 'video_uncached'
    WHEN NOT f.frames_ok THEN 'frames_incomplete'
    ELSE 'unknown'
  END AS failure_reason
FROM frames f;

COMMENT ON VIEW public.media_coverage IS
  'Per-creative media coverage over the ELIGIBLE universe (non-archived, impressions>0). image_ok = a cached full-res image; video_ok = non-video ad OR a cached playable storage video; frames_ok = the ad declares no multi-frame expectation (expected_frame_count NULL/<=1 → trivially TRUE) OR every expected frame''s IMAGE ASSET is cached (creative_frames.asset_id set; a "Frame pending" row does NOT count — US-#3). covered = image_ok AND video_ok AND frames_ok.';

-- ── 3. Feeder enqueues frames_incomplete (honoring the frame backoff) ──────────
-- Only change vs 20260717000004: add 'frames_incomplete' to the re-cacheable set and a
-- frames_retry_after backoff predicate. Still scoped to media_backfill_enabled accounts.
CREATE OR REPLACE FUNCTION public.enqueue_media_refresh_candidates(
  p_limit         integer DEFAULT 100,
  p_max_attempts  integer DEFAULT 5
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now       timestamptz := now();
  v_enqueued  integer := 0;
BEGIN
  WITH candidates AS (
    SELECT c.ad_id, c.account_id
    FROM public.media_coverage mc
    JOIN public.creatives c ON c.ad_id = mc.ad_id
    WHERE NOT mc.covered
      AND mc.failure_reason IN (
        'video_uncached', 'image_low_res', 'image_missing', 'video_unresolved',
        'video_permission', 'frames_incomplete'
      )
      AND EXISTS (
        SELECT 1 FROM public.ad_accounts a
        WHERE a.id = c.account_id AND a.media_backfill_enabled
      )
      AND (c.thumb_retry_after  IS NULL OR c.thumb_retry_after  <= v_now)
      AND (c.video_retry_after  IS NULL OR c.video_retry_after  <= v_now)
      AND (c.frames_retry_after IS NULL OR c.frames_retry_after <= v_now)
    ORDER BY c.media_last_refresh_at ASC NULLS FIRST, c.ad_id ASC
    LIMIT GREATEST(p_limit, 0)
  ),
  enqueue AS (
    INSERT INTO public.media_cache_queue (ad_id, account_id, status, attempts, enqueued_at, updated_at)
    SELECT cand.ad_id, cand.account_id, 'pending', 0, v_now, v_now
    FROM candidates cand
    ON CONFLICT (ad_id) DO UPDATE
      SET status = 'pending', attempts = 0, enqueued_at = v_now, updated_at = v_now, last_error = NULL
      WHERE public.media_cache_queue.status IN ('done', 'failed')
    RETURNING ad_id
  ),
  stamp AS (
    UPDATE public.creatives c
    SET media_last_refresh_at = v_now
    FROM candidates cand
    WHERE c.ad_id = cand.ad_id
    RETURNING c.ad_id
  )
  SELECT COUNT(*) INTO v_enqueued FROM stamp;
  RETURN COALESCE(v_enqueued, 0);
END;
$$;

COMMENT ON FUNCTION public.enqueue_media_refresh_candidates(integer, integer) IS
  'Bounded, prioritized self-healing feeder for media_cache_queue. Enqueues not-covered ads with a RE-CACHEABLE failure_reason (video_uncached / image_low_res / image_missing / video_unresolved / video_permission / frames_incomplete — NOT terminal video_deleted), SCOPED to ad_accounts.media_backfill_enabled, OLDEST-UNVERIFIED FIRST, honoring thumb_/video_/frames_retry_after backoff. frames_incomplete added 20260718000002 (drain backfillFrameAssets).';

-- =============================================================================
-- Verify:
--   SELECT failure_reason, count(*) FROM public.media_coverage GROUP BY 1 ORDER BY 2 DESC;
--   -- 'frames_incomplete' should now be non-zero where carousels have pending frames.
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='creatives' AND column_name LIKE 'frames_retry%';
-- =============================================================================
