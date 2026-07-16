-- US-007 (meta-media-completeness): Oversized videos (>200MB) — capture instead of
-- leaving on the CDN, and report the genuinely-unhandleable residual honestly.
--
-- Two changes, both additive + idempotent:
--
-- ── 1. Raise the ad-videos bucket file_size_limit to 2 GB ─────────────────────
-- The drain-media-queue worker STREAMS video downloads straight to storage
-- (duplex:"half", peeked chunk + untouched remainder), so worker memory stays FLAT
-- regardless of file size. The old 200 MB wire (drain-media-queue MAX_VIDEO_SIZE and
-- this bucket's file_size_limit, set in …20260602000002) was therefore a MEMORY guard
-- that no longer applies once uploads stream — it just stranded large-but-cacheable
-- videos on an expiring Meta CDN url (the US-007 gap). MAX_VIDEO_SIZE is raised to a
-- deliberate 2 GB STORAGE/BANDWIDTH ceiling (see the rationale in
-- supabase/functions/drain-media-queue/index.ts); this migration raises the bucket cap
-- to match so the streaming upload is not rejected by storage at 200 MB.
--
-- NOTE (unchanged caveat from …20260602000002): if the PROJECT-level storage upload
-- limit (Dashboard → Storage → Settings) is lower than 2 GB, THAT becomes the true
-- binding ceiling — the streaming upload then fails with an upload-error (recorded, not
-- a silent truncation) rather than storing a partial file. SQL cannot raise the
-- project-level cap; raise it in the Dashboard if genuine >bucket-limit ad videos exist.
UPDATE storage.buckets
SET file_size_limit = 2147483648  -- 2 GB (2 * 1024^3), matches drain-media-queue MAX_VIDEO_SIZE
WHERE id = 'ad-videos';

-- ── 2. media_coverage: distinct 'video_oversized' failure reason ──────────────
-- A video that resolves + is playable but exceeds the 2 GB capture ceiling is written
-- the new NO_VIDEO_OVERSIZED_SENTINEL ('no-video-oversized') to creatives.video_url by
-- the worker (see _shared/media-discovery.ts NO_VIDEO_SENTINELS + drain-media-queue's
-- too-large handling). Like every other no-video* sentinel it is a plain string that
-- fails the storage-url LIKE, so video_ok is ALREADY correctly FALSE for it — video_ok
-- is UNCHANGED and NOT loosened. The ONLY change here is one new failure_reason CASE
-- arm so the coverage report's top-failure breakdown shows 'video_oversized' (genuinely
-- too large to capture under policy — an honest, terminal residual for AC#3/#4) instead
-- of mislabeling it as the generic 'video_uncached' (which means "a live CDN url never
-- cached", a re-attemptable state — the opposite of terminal).
--
-- CREATE OR REPLACE, preserving the entire US-006 (…000029) eligible / classified /
-- frame_counts / frames logic VERBATIM. The projected column list is UNCHANGED, so the
-- read RPC public.get_media_coverage(text) does NOT need recreating. No edge function is
-- added/removed, so scripts/deploy-functions.sh and supabase/config.toml are untouched.
-- Numbering: …000030 follows the latest applied migration (…000029_ad_accounts_scope_flags).
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
    c.video_url,
    c.expected_frame_count
  FROM public.creatives c
  -- US-006: per-account-flag-aware eligibility. LEFT JOIN so a creative with no
  -- matching ad_accounts row still classifies (flags COALESCE to FALSE = today's
  -- scope). With both flags FALSE this reduces to the US-001 predicate exactly.
  LEFT JOIN public.ad_accounts a ON a.id = c.account_id
  WHERE (
      COALESCE(UPPER(c.ad_status), 'UNKNOWN') <> 'ARCHIVED'
      OR COALESCE(a.include_archived, false)
    )
    AND (
      COALESCE(c.impressions, 0) > 0
      OR COALESCE(a.include_zero_impression, false)
    )
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
    -- from US-001/US-003: the cached signal is a Supabase Storage public URL; every
    -- no-video* sentinel (incl. US-007 'no-video-oversized') is a plain string that
    -- fails the storage-url LIKE, so it is correctly NOT video_ok without enumeration.
    (
      e.video_url IS NULL
      OR e.video_url LIKE '%/storage/v1/object/public/%'
    ) AS video_ok
  FROM eligible e
),
frame_counts AS (
  -- Captured frame count per ad. LEFT JOIN below so ads with no captured frames get 0.
  SELECT cf.ad_id, COUNT(*)::int AS captured_frames
  FROM public.creative_frames cf
  GROUP BY cf.ad_id
),
frames AS (
  -- US-004: frames_ok = the ad declares no multi-frame expectation
  -- (expected_frame_count IS NULL or <= 1 → single-asset, trivially frame-complete;
  -- NO REGRESSION for pre-US-004 rows), OR it expects N (>1) frames and at least N
  -- were captured. A carousel expecting N (>1) with fewer captured is NOT frames_ok.
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
    -- US-003/US-007: distinct honest video-failure reasons (terminal sentinels first).
    WHEN NOT f.video_ok AND f.video_url = 'no-video-permission' THEN 'video_permission'
    WHEN NOT f.video_ok AND f.video_url = 'no-video-deleted' THEN 'video_deleted'
    WHEN NOT f.video_ok AND f.video_url = 'no-video-oversized' THEN 'video_oversized'
    WHEN NOT f.video_ok AND f.video_url = 'no-video' THEN 'video_unresolved'
    WHEN NOT f.video_ok THEN 'video_uncached'   -- live CDN url, never cached
    -- US-004: a carousel/multi-frame ad missing at least one expected frame.
    WHEN NOT f.frames_ok THEN 'frames_incomplete'
    ELSE 'unknown'
  END AS failure_reason
FROM frames f;

COMMENT ON VIEW public.media_coverage IS
  'US-001/US-003/US-004/US-006/US-007 (meta-media-completeness): per-creative media coverage over the ELIGIBLE universe. Eligibility is PER-ACCOUNT-FLAG-AWARE (US-006): an ad is eligible when (NOT archived OR ad_accounts.include_archived) AND (impressions>0 OR ad_accounts.include_zero_impression); with both flags FALSE (default) this is exactly today''s scope (non-archived, impressions>0). image_ok = a cached full-res image; video_ok = non-video ad OR a cached playable storage video (every no-video* sentinel — no-video / no-video-permission / no-video-deleted / no-video-oversized — is NOT video_ok); frames_ok = the ad declares no multi-frame expectation (creatives.expected_frame_count NULL/<=1 → trivially TRUE, no regression) OR it expects N>1 frames and at least N public.creative_frames rows are captured (a carousel missing any frame is NOT frames_ok → failure_reason ''frames_incomplete''). failure_reason distinguishes video_oversized (US-007: playable but over the 2GB capture ceiling, terminal) from video_unresolved / video_permission / video_deleted / video_uncached. covered = image_ok AND video_ok AND frames_ok. covered + not-covered = eligible, always.';

-- ── Verify ──────────────────────────────────────────────────────────────────
--   SELECT file_size_limit FROM storage.buckets WHERE id = 'ad-videos';  -- 2147483648
--   SELECT failure_reason, count(*) FROM public.media_coverage
--     WHERE NOT video_ok GROUP BY failure_reason;   -- 'video_oversized' now distinct
--   SELECT * FROM public.get_media_coverage(NULL);  -- aggregate + per-account
-- Invariant: covered + (rows WHERE failure_reason IS NOT NULL) = eligible, always.
