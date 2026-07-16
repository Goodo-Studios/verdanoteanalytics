-- US-003 (playable video guarantee): make the media_coverage failure_reason report
-- HONEST about WHY a video is unresolved.
--
-- Background: US-003 replaces the blanket 'no-video' sentinel with a distinct
-- video-failure taxonomy written to creatives.video_url when a video genuinely
-- cannot be resolved (see _shared/media-discovery.ts):
--   • 'no-video'             — unresolved / unknown (still worth re-attempting).
--   • 'no-video-permission'  — permission-blocked for our credentials (terminal).
--   • 'no-video-deleted'     — the underlying video/post is gone (terminal).
--
-- video_ok is UNCHANGED and NOT loosened: all three are plain strings, never a
-- '%/storage/v1/object/public/%' url, so the existing video_ok expression already
-- classifies every one of them as NOT video_ok. The ONLY change here is the
-- failure_reason CASE, so the coverage report's top-failure breakdown distinguishes
-- "permission-blocked" and "deleted" (genuinely-unresolvable residual, AC#4) from the
-- generic "unresolved" bucket — instead of the old view mislabeling the new sentinels
-- as 'video_uncached' (which means "a live CDN url that was never cached", a different
-- thing entirely).
--
-- Additive + idempotent (CREATE OR REPLACE VIEW): re-running `supabase db push` is a
-- safe no-op that reconciles the ledger cleanly. The view's column list is unchanged,
-- so the dependent get_media_coverage RPC does not need to be recreated. No edge
-- function is added/removed, so config.toml / deploy-functions.sh are untouched.
--
-- Numbering: 20260714000026 follows the latest applied migration
-- (…000025_creatives_image_quality).

CREATE OR REPLACE VIEW public.media_coverage AS
WITH eligible AS (
  SELECT
    c.ad_id,
    c.account_id,
    c.ad_name,
    c.ad_status,
    c.impressions,
    c.thumbnail_url,
    c.full_res_url,
    c.video_url
  FROM public.creatives c
  WHERE COALESCE(UPPER(c.ad_status), 'UNKNOWN') <> 'ARCHIVED'
    AND COALESCE(c.impressions, 0) > 0
),
classified AS (
  SELECT
    e.*,
    (
      e.full_res_url IS NOT NULL
      AND e.full_res_url <> 'no-thumbnail'
    ) AS image_ok,
    (
      e.video_url IS NOT NULL
    ) AS is_video_ad,
    -- video_ok: non-video ad (trivially ok) OR a cached, playable video. UNCHANGED
    -- from US-001: the cached signal is a Supabase Storage public URL. Every
    -- no-video* sentinel ('no-video', 'no-video-permission', 'no-video-deleted') is a
    -- plain string that fails the storage-url LIKE, so it is correctly NOT video_ok
    -- WITHOUT enumerating each sentinel here. (Enumerating them would be redundant and
    -- risk drift; the storage-url check is the single source of truth for "playable".)
    (
      e.video_url IS NULL
      OR e.video_url LIKE '%/storage/v1/object/public/%'
    ) AS video_ok
  FROM eligible e
),
frames AS (
  SELECT
    cl.*,
    TRUE AS frames_ok
  FROM classified cl
)
SELECT
  f.ad_id,
  f.account_id,
  f.ad_name,
  f.ad_status,
  f.impressions,
  f.image_ok,
  f.video_ok,
  f.frames_ok,
  f.is_video_ad,
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
    -- US-003: distinct honest video-failure reasons. Order matters — the terminal
    -- sentinels are checked before the generic 'no-video' and before the
    -- live-CDN-uncached fallthrough.
    WHEN NOT f.video_ok AND f.video_url = 'no-video-permission' THEN 'video_permission'
    WHEN NOT f.video_ok AND f.video_url = 'no-video-deleted' THEN 'video_deleted'
    WHEN NOT f.video_ok AND f.video_url = 'no-video' THEN 'video_unresolved'
    WHEN NOT f.video_ok THEN 'video_uncached'   -- live CDN url, never cached
    WHEN NOT f.frames_ok THEN 'frames_incomplete'
    ELSE 'unknown'
  END AS failure_reason
FROM frames f;

COMMENT ON VIEW public.media_coverage IS
  'US-001/US-003 (meta-media-completeness): per-creative media coverage over the ELIGIBLE universe (non-archived, impressions>0). image_ok = a cached full-res image; video_ok = non-video ad OR a cached playable storage video (every no-video* sentinel — no-video / no-video-permission / no-video-deleted — is NOT video_ok); frames_ok defaults TRUE until US-004. failure_reason distinguishes video_unresolved (generic, still re-attemptable), video_permission (permission-blocked, terminal), video_deleted (object gone, terminal), and video_uncached (a live CDN url never cached). covered + not-covered = eligible, always.';

-- ── Verify ──────────────────────────────────────────────────────────────────
--   SELECT failure_reason, count(*) FROM public.media_coverage
--     WHERE NOT video_ok GROUP BY failure_reason;   -- honest video-failure breakdown
--   SELECT * FROM public.get_media_coverage(NULL);  -- aggregate + per-account
