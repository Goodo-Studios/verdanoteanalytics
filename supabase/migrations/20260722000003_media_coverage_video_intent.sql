-- =============================================================================
-- media_coverage: classify video intent honestly (fix 14k misclassified image ads)
-- =============================================================================
-- Idempotent (CREATE OR REPLACE VIEW; output columns unchanged). Manual db push.
-- Numbered off the remote frontier (20260722000002 highest applied at authoring).
--
-- BUG (2026-07-21 media audit): is_video_ad was `video_url IS NOT NULL` — but
-- discovery writes the 'no-video' sentinel onto IMAGE ads too, so 14,169 image
-- ads were classified as video ads. Consequences:
--   • covered could never be true for them (no video will ever exist), freezing
--     the coverage metric at ~15% while the real number is ~56% — 11,136 of those
--     ads already have a cached image + complete frames;
--   • the self-heal feeder (which re-arms via this view's failure_reason) kept
--     re-enqueueing them forever as 'video_unresolved', burning most of the
--     drain's Meta budget on videos that do not exist (queue treadmill: done-count
--     rose ~570/h while covered stayed frozen and pending never shrank).
--
-- Fix mirrors the CreativeDetailModal disambiguation (PR #74): real video intent =
-- a non-sentinel video_url OR persisted Meta video ids (US-014).
--   • image ads ('no-video', no meta_video_ids): is_video_ad=false → video_ok=true
--     → covered = image_ok AND frames_ok (flips ~11k immediately; feeder drops them);
--   • video ads with unresolved sources ('no-video' + meta ids): video_ok=false,
--     failure_reason='video_unresolved' (unchanged — the feeder keeps chasing them);
--   • video ads with a NULL video_url but meta ids (source never discovered):
--     video_ok=false → 'video_uncached'. Previously these counted covered — that
--     was dishonest; the feeder now fetches their real video.
-- =============================================================================

CREATE OR REPLACE VIEW public.media_coverage AS
WITH eligible AS (
  SELECT
    c.ad_id, c.account_id, c.ad_name, c.ad_status, c.impressions,
    c.thumbnail_url, c.full_res_url, c.video_url, c.expected_frame_count,
    c.meta_video_ids
  FROM public.creatives c
  WHERE COALESCE(UPPER(c.ad_status), 'UNKNOWN') <> 'ARCHIVED'
    AND COALESCE(c.impressions, 0) > 0
),
classified AS (
  SELECT
    e.ad_id, e.account_id, e.ad_name, e.ad_status, e.impressions,
    e.thumbnail_url, e.full_res_url, e.video_url, e.expected_frame_count,
    (e.full_res_url IS NOT NULL AND e.full_res_url <> 'no-thumbnail') AS image_ok,
    -- Real video intent: a non-sentinel video_url (live/cached/blocked-terminal),
    -- OR persisted Meta video ids (US-014). 'no-video' alone = an image ad.
    (
      (e.video_url IS NOT NULL AND e.video_url <> 'no-video')
      OR COALESCE(array_length(e.meta_video_ids, 1), 0) > 0
    ) AS is_video_ad
  FROM eligible e
),
with_video_ok AS (
  SELECT
    cl.*,
    -- video_ok: image ads trivially pass; video ads need a cached storage copy.
    (
      NOT cl.is_video_ad
      OR COALESCE(cl.video_url, '') LIKE '%/storage/v1/object/public/%'
    ) AS video_ok
  FROM classified cl
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
  FROM with_video_ok cl
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
