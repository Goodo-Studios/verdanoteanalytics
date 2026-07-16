-- US-006 (meta-media-completeness): Widen eligibility — archived + zero-impression ads.
--
-- Historical campaigns (ARCHIVED) and instantly-paused test creatives (impressions
-- = 0) are excluded by today's sync scope and therefore never counted in the
-- media_coverage universe (US-001). This migration adds two per-account opt-in
-- scope flags to public.ad_accounts and widens the media_coverage view's ELIGIBILITY
-- predicate to honor them, so that once an account opts in, its previously-excluded
-- ads are both ingested (Phase 1 sync — see supabase/functions/sync/index.ts) AND
-- measured against the intended universe (no silently-excluded ad is ever counted as
-- "covered", and none is silently dropped from the denominator either).
--
-- ── Per-account flags (default conservative) ──────────────────────────────────
--   ad_accounts.include_archived        BOOLEAN NOT NULL DEFAULT false
--   ad_accounts.include_zero_impression BOOLEAN NOT NULL DEFAULT false
-- Both default FALSE so behavior is byte-for-byte unchanged for every existing
-- account until an operator explicitly opts one in. This is the deliberate
-- rollout guard: enabling these widens BOTH what sync fetches AND what coverage
-- measures, and must be a conscious per-account decision.
--
-- ── Documented tradeoff (AC#5): storage / row growth ──────────────────────────
-- Enabling these flags can multiply the number of captured ads per account by a
-- large factor, because DTC accounts routinely accumulate far more archived and
-- zero-impression (instantly-paused test) creatives than live ones:
--   * include_archived        — pulls the full archived campaign history. On a
--     mature account this can be several times the active-ad count, each new ad
--     adding a creatives row, media_cache_queue enqueue, and cached image/video
--     bytes in Supabase Storage (deduped by content hash, so shared assets do not
--     re-download — but distinct creatives still add rows + net-new bytes).
--   * include_zero_impression — pulls creatives that never delivered. High-volume
--     testing accounts can have thousands of these.
-- Rule of thumb: expect 2x–10x creatives-row and storage growth on an opted-in
-- account with deep history. Enable per-account, run the one-time backfill
-- (sync with a widened scope), and watch the coverage metric + storage. The 18k+
-- ad large-account safeguards in sync/index.ts (campaign-by-campaign, bounded,
-- resumable) still apply and must not regress — the widened fetch reuses the exact
-- same paginated, rate-limit-aware, resumable machinery.
--
-- ── Eligibility predicate (single documented definition, reused everywhere) ────
-- US-001 defined eligibility as: NOT ARCHIVED AND impressions > 0. US-006 widens
-- it to be PER-ACCOUNT-FLAG-AWARE. An ad is now ELIGIBLE when, for its account's
-- flags (defaulting FALSE when no account row is joined):
--       (NOT archived  OR  account.include_archived)
--   AND (impressions>0  OR  account.include_zero_impression)
-- With both flags FALSE this is IDENTICAL to the US-001 predicate, so nothing
-- changes for accounts that have not opted in. The TS mirror in
-- supabase/functions/_shared/media-discovery.ts (isEligibleForCoverage) is updated
-- in the same story to take the same optional per-account flags, so the two sides
-- never drift (US-001 invariant).
--
-- Additive + backwards-compatible + idempotent: `ADD COLUMN IF NOT EXISTS` +
-- `CREATE OR REPLACE VIEW`. Re-running `supabase db push` is a safe no-op that
-- reconciles the ledger cleanly (verdanote-supabase-ledger-drift-reconcile-with-db-push).
-- The view's projected column list is UNCHANGED from …000027, so the read RPC
-- public.get_media_coverage does NOT need recreating (it reads this view).
--
-- No edge function is added/removed, so scripts/deploy-functions.sh and
-- supabase/config.toml are intentionally untouched (verdanote-supabase-add-function).
--
-- Numbering: 20260714000029 follows the latest applied migration
-- (…000028_media_refresh_self_heal) so ordering is preserved, and the ADD COLUMN
-- statements below appear strictly BEFORE the CREATE OR REPLACE VIEW that
-- references them (verdanote-supabase-migration-numbering-order-before-references).

-- ── 1. Per-account scope flags on ad_accounts ────────────────────────────────
ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS include_archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS include_zero_impression boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ad_accounts.include_archived IS
  'US-006 (meta-media-completeness): per-account opt-in. When TRUE, Phase 1 sync ingests ARCHIVED ads for this account and the media_coverage eligibility predicate counts them toward coverage. Defaults FALSE (conservative). Enabling can multiply this account''s creatives-row count and Supabase Storage bytes several-fold on a mature account with deep archived history — enable deliberately, run a one-time backfill, and watch the coverage metric + storage.';
COMMENT ON COLUMN public.ad_accounts.include_zero_impression IS
  'US-006 (meta-media-completeness): per-account opt-in. When TRUE, Phase 1 sync ingests ads with impressions = 0 (instantly-paused / test creatives) for this account and the media_coverage eligibility predicate counts them toward coverage. Defaults FALSE (conservative). High-volume testing accounts can have thousands of zero-impression ads — enable deliberately and expect row/storage growth.';

-- ── 2. Widen media_coverage eligibility (per-account-flag-aware) ──────────────
-- CREATE OR REPLACE the view, PRESERVING the entire US-004 (…000027)
-- classified / frame_counts / frames / failure_reason logic VERBATIM. The ONLY
-- change is the `eligible` CTE, which now LEFT JOINs each creative to its account's
-- flags and keeps the ad when it passes today's predicate OR the matching flag is
-- enabled. Flags COALESCE to FALSE for orphan creatives with no ad_accounts row, so
-- their behavior is unchanged (conservative). The projected column list is
-- identical, so get_media_coverage(text) is untouched.
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
    -- no-video* sentinel is a plain string that fails the storage-url LIKE.
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
    -- US-003: distinct honest video-failure reasons (terminal sentinels first).
    WHEN NOT f.video_ok AND f.video_url = 'no-video-permission' THEN 'video_permission'
    WHEN NOT f.video_ok AND f.video_url = 'no-video-deleted' THEN 'video_deleted'
    WHEN NOT f.video_ok AND f.video_url = 'no-video' THEN 'video_unresolved'
    WHEN NOT f.video_ok THEN 'video_uncached'   -- live CDN url, never cached
    -- US-004: a carousel/multi-frame ad missing at least one expected frame.
    WHEN NOT f.frames_ok THEN 'frames_incomplete'
    ELSE 'unknown'
  END AS failure_reason
FROM frames f;

COMMENT ON VIEW public.media_coverage IS
  'US-001/US-003/US-004/US-006 (meta-media-completeness): per-creative media coverage over the ELIGIBLE universe. Eligibility is PER-ACCOUNT-FLAG-AWARE (US-006): an ad is eligible when (NOT archived OR ad_accounts.include_archived) AND (impressions>0 OR ad_accounts.include_zero_impression); with both flags FALSE (default) this is exactly today''s scope (non-archived, impressions>0). image_ok = a cached full-res image; video_ok = non-video ad OR a cached playable storage video (every no-video* sentinel is NOT video_ok); frames_ok = the ad declares no multi-frame expectation (creatives.expected_frame_count NULL/<=1 → trivially TRUE, no regression) OR it expects N>1 frames and at least N public.creative_frames rows are captured (a carousel missing any frame is NOT frames_ok → failure_reason ''frames_incomplete''). covered = image_ok AND video_ok AND frames_ok. covered + not-covered = eligible, always.';

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running this migration, confirm with:
--   \d public.ad_accounts   -- include_archived / include_zero_impression present, default false
--   -- default scope unchanged: an account with both flags FALSE measures exactly
--   -- the pre-US-006 universe (non-archived, impressions>0):
--   SELECT count(*) FROM public.media_coverage;          -- unchanged when no flag is on
--   -- opt an account in, then confirm its archived / zero-impression ads appear:
--   UPDATE public.ad_accounts SET include_archived = true, include_zero_impression = true
--     WHERE id = '<account_id>';
--   SELECT count(*) FILTER (WHERE UPPER(ad_status) = 'ARCHIVED')  AS archived_now_eligible,
--          count(*) FILTER (WHERE COALESCE(impressions,0) = 0)    AS zero_imp_now_eligible
--     FROM public.media_coverage WHERE account_id = '<account_id>';
--   SELECT * FROM public.get_media_coverage(NULL);       -- aggregate + per-account
-- Invariant: with both flags FALSE the eligible set is byte-identical to US-001;
-- covered + (rows WHERE failure_reason IS NOT NULL) = eligible, always.
