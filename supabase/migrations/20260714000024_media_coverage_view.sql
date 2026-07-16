-- US-001 (meta-media-completeness): Media coverage metric — define "covered" and expose it.
--
-- Foundation story: you cannot drive to ~100% what you cannot measure. This
-- migration defines the single source of truth for "is this ad's media complete?"
-- as a SQL view (public.media_coverage) that classifies every eligible creative
-- row, plus a read RPC (public.get_media_coverage) that returns coverage counts
-- and % per account and in aggregate, with a breakdown of the top failure reasons.
--
-- ── Classification contract (mirrors the TS helpers in _shared/media-discovery.ts) ──
-- Each creative is classified as:
--   image_ok  — has a cached, non-sentinel, non-tiny-thumbnail full-res image.
--               The ~130px creative.thumbnail_url last-resort fallback leaves
--               full_res_url NULL (see discoverImageUrl Strategy 6 + drain-media-queue,
--               which sets full_res_url ONLY when a real asset is cached). So an image
--               whose ONLY source is that fallback is NOT image_ok — detected here as
--               "full_res_url IS NULL / not a real cached asset".
--   video_ok  — non-video ad OR has a cached, playable video asset. A video ad is one
--               whose video_url is populated with anything other than "not a video"
--               (NULL). The NO_VIDEO_SENTINEL ('no-video') marks a video ad whose video
--               could not be resolved → NOT video_ok. A cached storage video → video_ok.
--   frames_ok — all expected carousel frames captured. US-004 introduces the
--               creative_frames junction table; until then no ad declares an expected
--               frame set, so frames_ok defaults TRUE (a single-asset ad is trivially
--               frame-complete). When US-004 lands, this view is tightened to require
--               every expected frame present (see the frames_ok CTE below — it already
--               degrades gracefully if the creative_frames table does not yet exist).
--   covered   = image_ok AND video_ok AND frames_ok.
--
-- ── Eligibility predicate (single documented definition, reused everywhere) ──
-- An ad is ELIGIBLE for coverage measurement when it is part of the universe we
-- actually sync today. Today's sync excludes ARCHIVED ads and impressions=0 ads
-- (see prd currentSolution + US-006), so the eligibility predicate is:
--     ad_status <> 'ARCHIVED' (case-insensitive)  AND  impressions > 0
-- This is the SAME predicate the TS helper isEligibleForCoverage() encodes, so the
-- numerator/denominator are measured against the intended universe and no
-- silently-excluded ad is ever counted as "covered". US-006 will widen this
-- predicate (per-account include_archived / include_zero_impression flags); when it
-- lands, update BOTH this view's eligibility CTE and the TS helper together so they
-- never drift. Ship US-001 now with the current predicate and tighten on US-006.
--
-- Additive + backwards-compatible + idempotent (CREATE OR REPLACE): nothing is
-- forced to read this view, and re-running `supabase db push` is a safe no-op that
-- reconciles the ledger cleanly (per
-- verdanote-supabase-ledger-drift-reconcile-with-db-push).
--
-- No new edge function is introduced (the read surface is a PostgREST-exposed RPC on
-- the existing metrics/read route), so scripts/deploy-functions.sh and
-- supabase/config.toml are intentionally untouched (per verdanote-supabase-add-function
-- policy — only a function add/remove touches those files).
--
-- Numbering: 20260714000024 follows the latest applied migration
-- (…000023_fix_rotation_cohorts_ambiguous_spend) so ordering is preserved
-- (migration-numbering-order policy).

-- ── View: public.media_coverage ─────────────────────────────────────────────
-- One row per creative, projecting the classification flags + a machine-readable
-- failure_reason for the not-covered set. Restricted to eligible ads so counts
-- reconcile: covered + not_covered = eligible, always.
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
  -- Eligibility predicate (see header): the universe we sync today.
  WHERE COALESCE(UPPER(c.ad_status), 'UNKNOWN') <> 'ARCHIVED'
    AND COALESCE(c.impressions, 0) > 0
),
classified AS (
  SELECT
    e.*,
    -- image_ok: a real, cached, full-resolution image exists. The ~130px
    -- thumbnail_url fallback leaves full_res_url NULL, so requiring a non-null
    -- full_res_url that is NOT the no-thumbnail sentinel excludes the tiny
    -- placeholder. A cached storage thumbnail always co-populates full_res_url.
    (
      e.full_res_url IS NOT NULL
      AND e.full_res_url <> 'no-thumbnail'
    ) AS image_ok,
    -- is_video_ad: video_url populated with a real value or the no-video sentinel
    -- (the sentinel is only ever written for ads Meta reports AS video ads whose
    -- source we could not resolve). A NULL video_url means "not a video ad".
    (
      e.video_url IS NOT NULL
    ) AS is_video_ad,
    -- video_ok: non-video ad (trivially ok) OR a cached, playable video. The
    -- cached signal is a Supabase Storage public URL; the 'no-video' sentinel and
    -- any bare live CDN url (uncached) are NOT ok.
    (
      e.video_url IS NULL
      OR (
        e.video_url <> 'no-video'
        AND e.video_url LIKE '%/storage/v1/object/public/%'
      )
    ) AS video_ok
  FROM eligible e
),
frames AS (
  -- frames_ok: all expected carousel frames captured. US-004 adds the
  -- creative_frames junction table; until it exists, every ad is trivially
  -- frame-complete (frames_ok = TRUE). This CTE is written to degrade gracefully:
  -- if the table is absent, to_regclass() is NULL and every ad gets frames_ok=TRUE.
  -- When US-004 lands, replace the TRUE default with the real "every expected frame
  -- present" check (a carousel ad missing any frame is NOT frames_ok).
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
  -- Machine-readable primary failure reason for the not-covered set. NULL when
  -- covered. Ordered by likely-highest-signal first so the coverage report's
  -- top-failure breakdown is honest (image quality is the known root cause).
  CASE
    WHEN (f.image_ok AND f.video_ok AND f.frames_ok) THEN NULL
    WHEN NOT f.image_ok
      AND (f.full_res_url IS NULL OR f.full_res_url = 'no-thumbnail')
      AND f.thumbnail_url IS NOT NULL
      AND f.thumbnail_url <> 'no-thumbnail'
      THEN 'image_low_res'          -- only source is the ~130px thumbnail fallback
    WHEN NOT f.image_ok AND f.thumbnail_url = 'no-thumbnail' THEN 'image_missing'
    WHEN NOT f.image_ok THEN 'image_missing'
    WHEN NOT f.video_ok AND f.video_url = 'no-video' THEN 'video_unresolved'
    WHEN NOT f.video_ok THEN 'video_uncached'   -- live CDN url, never cached
    WHEN NOT f.frames_ok THEN 'frames_incomplete'
    ELSE 'unknown'
  END AS failure_reason
FROM frames f;

COMMENT ON VIEW public.media_coverage IS
  'US-001 (meta-media-completeness): per-creative media coverage classification over the ELIGIBLE universe (non-archived, impressions>0 — today''s sync scope; widened by US-006). image_ok = a cached full-res image (the ~130px thumbnail_url fallback leaves full_res_url NULL and is NOT image_ok); video_ok = non-video ad OR a cached playable storage video (the no-video sentinel and uncached CDN urls are NOT ok); frames_ok = all carousel frames captured (defaults TRUE until US-004''s creative_frames lands); covered = image_ok AND video_ok AND frames_ok. failure_reason gives the primary not-covered cause. covered + not-covered = eligible, always.';

-- ── RPC: public.get_media_coverage ──────────────────────────────────────────
-- The read endpoint (AC#3): returns coverage counts + % per account_id and, when
-- p_account_id IS NULL, one aggregate row (account_id = NULL) PLUS per-account
-- rows. total = eligible ads; image_ok / video_ok / frames_ok / covered counts;
-- coverage_pct = covered / total; and failure_reasons as a jsonb {reason: count}
-- breakdown of the top not-covered causes for that scope.
--
-- Callable via PostgREST (POST /rest/v1/rpc/get_media_coverage) — the existing
-- metrics/read surface — so no new edge function directory is added.
CREATE OR REPLACE FUNCTION public.get_media_coverage(
  p_account_id text DEFAULT NULL
)
RETURNS TABLE (
  account_id       text,
  total            bigint,
  image_ok         bigint,
  video_ok         bigint,
  frames_ok        bigint,
  covered          bigint,
  coverage_pct     numeric,
  failure_reasons  jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT * FROM public.media_coverage mc
    WHERE p_account_id IS NULL OR mc.account_id = p_account_id
  ),
  per_account AS (
    SELECT
      s.account_id,
      COUNT(*)::bigint                                          AS total,
      COUNT(*) FILTER (WHERE s.image_ok)::bigint                AS image_ok,
      COUNT(*) FILTER (WHERE s.video_ok)::bigint                AS video_ok,
      COUNT(*) FILTER (WHERE s.frames_ok)::bigint               AS frames_ok,
      COUNT(*) FILTER (WHERE s.covered)::bigint                 AS covered,
      COALESCE(
        (SELECT jsonb_object_agg(fr.failure_reason, fr.n)
         FROM (
           SELECT s2.failure_reason, COUNT(*) AS n
           FROM scoped s2
           WHERE s2.account_id = s.account_id AND s2.failure_reason IS NOT NULL
           GROUP BY s2.failure_reason
         ) fr),
        '{}'::jsonb
      )                                                          AS failure_reasons
    FROM scoped s
    GROUP BY s.account_id
  ),
  aggregate_row AS (
    -- Only emit an aggregate (account_id = NULL) row when NOT scoped to a single
    -- account, so a per-account query returns exactly one row.
    SELECT
      NULL::text                                                 AS account_id,
      COUNT(*)::bigint                                           AS total,
      COUNT(*) FILTER (WHERE s.image_ok)::bigint                 AS image_ok,
      COUNT(*) FILTER (WHERE s.video_ok)::bigint                 AS video_ok,
      COUNT(*) FILTER (WHERE s.frames_ok)::bigint                AS frames_ok,
      COUNT(*) FILTER (WHERE s.covered)::bigint                  AS covered,
      COALESCE(
        (SELECT jsonb_object_agg(fr.failure_reason, fr.n)
         FROM (
           SELECT s2.failure_reason, COUNT(*) AS n
           FROM scoped s2
           WHERE s2.failure_reason IS NOT NULL
           GROUP BY s2.failure_reason
         ) fr),
        '{}'::jsonb
      )                                                          AS failure_reasons
    FROM scoped s
    WHERE p_account_id IS NULL
    HAVING COUNT(*) > 0
  ),
  unioned AS (
    SELECT * FROM aggregate_row
    UNION ALL
    SELECT * FROM per_account
  )
  SELECT
    u.account_id,
    u.total,
    u.image_ok,
    u.video_ok,
    u.frames_ok,
    u.covered,
    (CASE WHEN u.total > 0
      THEN ROUND((u.covered::numeric / u.total::numeric) * 100, 2)
      ELSE 0 END)                                                AS coverage_pct,
    u.failure_reasons
  FROM unioned u
  -- Aggregate row (NULL account_id) sorts first, then per-account by worst coverage.
  ORDER BY (u.account_id IS NOT NULL), (u.covered::numeric / NULLIF(u.total, 0)) ASC NULLS LAST;
$$;

COMMENT ON FUNCTION public.get_media_coverage(text) IS
  'US-001 (meta-media-completeness): media coverage read endpoint. With p_account_id NULL, returns an aggregate row (account_id NULL) plus one row per account; with p_account_id set, returns just that account. Each row: total eligible ads, image_ok/video_ok/frames_ok/covered counts, coverage_pct (covered/total), and failure_reasons {reason: count} for the not-covered set. Reads public.media_coverage so eligibility + classification stay single-sourced.';

-- Reads only; safe to expose to the app roles. SECURITY DEFINER + fixed
-- search_path so it runs with a stable, injection-safe schema resolution.
GRANT EXECUTE ON FUNCTION public.get_media_coverage(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_media_coverage(text) TO service_role;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running this migration, confirm with:
--   SELECT covered, count(*) FROM public.media_coverage GROUP BY covered;
--   SELECT * FROM public.get_media_coverage(NULL);            -- aggregate + per-account
--   SELECT * FROM public.get_media_coverage('<account_id>');  -- one account
-- Reconciliation invariant: for any scope, image_ok/video_ok/frames_ok/covered <= total
-- and (covered rows) + (rows WHERE failure_reason IS NOT NULL) = total.
