-- US-003: Local rollup of the per-ad snapshot from stored daily rows.
--
-- Replaces the Phase-2 full-window aggregate insights fetch to Meta. The daily
-- rows in creative_daily_metrics are immutable once the attribution window
-- closes (~28d) and are fetched once (US-004 backfill) or refreshed inside the
-- rolling recent window (US-002), so the aggregate snapshot on public.creatives
-- can be recomputed LOCALLY by summing the daily grain instead of re-pulling a
-- second full window from Meta.
--
-- Contract:
--   * SUMMABLE base metrics (spend, impressions, clicks, purchases,
--     purchase_value, adds_to_cart, video_views) are summed across the window.
--   * RATIOS (roas, cpa, ctr, cpm, cpc, thumb_stop_rate, hold_rate) are DERIVED
--     from those sums — never averaged — so aggregate ratios reconcile exactly
--     with the summed base metrics (roas = purchase_value / spend, etc.).
--   * play_curve + retention_p25/p50/p75/p100 are reconstructed by rolling up
--     the daily-grain play-curve columns from US-001, video-view weighted so a
--     high-volume day dominates a low-volume day (matches how Meta aggregates).
--   * frequency / reach are APPROXIMATE: creative_daily_metrics stores daily
--     frequency but NOT reach, and summed daily reach overcounts (the same user
--     reached on two days counts twice). We surface an impression-weighted mean
--     daily frequency as the best local estimate. This is an explicit product
--     decision (see prd nonGoals: "No exact frequency/reach"). Flagged below.
--
-- Idempotent: CREATE OR REPLACE; re-applying is a no-op reconcilable with
-- `supabase db push`. Numbered AFTER 20260714000001 so the daily play-curve
-- columns it reads already exist (migration-numbering-order policy).
--
-- 42702 note: this function does NOT use RETURNS TABLE OUT params that collide
-- with column names — it writes via UPDATE ... FROM a CTE and returns a scalar
-- count, so there is no ambiguous-column hazard.

CREATE OR REPLACE FUNCTION public.rollup_creatives_from_daily(
  p_account_id text,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'rollup_creatives_from_daily: p_account_id is required';
  END IF;

  WITH agg AS (
    SELECT
      m.ad_id                                                             AS ad_id,
      -- ── Summable base metrics ────────────────────────────────────────
      COALESCE(SUM(m.spend), 0)::numeric                                  AS spend,
      COALESCE(SUM(m.impressions), 0)::bigint                             AS impressions,
      COALESCE(SUM(m.clicks), 0)::bigint                                  AS clicks,
      COALESCE(SUM(m.purchases), 0)::bigint                               AS purchases,
      COALESCE(SUM(m.purchase_value), 0)::numeric                         AS purchase_value,
      COALESCE(SUM(m.adds_to_cart), 0)::bigint                            AS adds_to_cart,
      COALESCE(SUM(m.video_views), 0)::bigint                             AS video_views,
      -- Reconstruct daily thruplays (hold_rate = thruplays / video_views)
      -- so aggregate hold_rate can be derived from summed base metrics.
      -- The daily table stores hold_rate but not the raw thruplay count.
      COALESCE(SUM(
        CASE WHEN m.hold_rate IS NOT NULL AND m.video_views IS NOT NULL
          THEN (m.hold_rate / 100.0) * m.video_views
          ELSE 0 END
      ), 0)::numeric                                                      AS thruplays,
      -- video_avg_play_time: view-weighted mean (approximate — Meta reports an
      -- avg per day, so we weight by that day's video_views).
      COALESCE(SUM(m.video_avg_play_time * m.video_views), 0)::numeric    AS vapt_weighted,
      -- APPROXIMATE frequency (see header): impression-weighted mean daily
      -- frequency. No reach column exists to compute exact aggregate frequency.
      COALESCE(SUM(m.frequency * m.impressions), 0)::numeric              AS freq_weighted
    FROM public.creative_daily_metrics m
    WHERE m.account_id = p_account_id
      AND (p_from IS NULL OR m.date >= p_from)
      AND (p_to   IS NULL OR m.date <= p_to)
    GROUP BY m.ad_id
  ),
  -- ── Play-curve / retention rollup (US-001 daily columns) ─────────────
  -- video-view weighted average of the per-interval retention curves and the
  -- quartile scalars, so a high-volume day dominates. Days with a null curve /
  -- zero views are excluded rather than zero-filled (a zero curve would read as
  -- "everyone dropped off" and distort the aggregate).
  curve_agg AS (
    SELECT
      m.ad_id AS ad_id,
      -- Weighted retention scalars.
      SUM(m.retention_p25 * m.video_views) FILTER (
        WHERE m.retention_p25 IS NOT NULL AND m.video_views > 0)          AS p25_num,
      SUM(m.retention_p50 * m.video_views) FILTER (
        WHERE m.retention_p50 IS NOT NULL AND m.video_views > 0)          AS p50_num,
      SUM(m.retention_p75 * m.video_views) FILTER (
        WHERE m.retention_p75 IS NOT NULL AND m.video_views > 0)          AS p75_num,
      SUM(m.retention_p100 * m.video_views) FILTER (
        WHERE m.retention_p100 IS NOT NULL AND m.video_views > 0)         AS p100_num,
      SUM(m.video_views) FILTER (
        WHERE m.retention_p50 IS NOT NULL AND m.video_views > 0)          AS ret_weight
    FROM public.creative_daily_metrics m
    WHERE m.account_id = p_account_id
      AND (p_from IS NULL OR m.date >= p_from)
      AND (p_to   IS NULL OR m.date <= p_to)
    GROUP BY m.ad_id
  ),
  -- Reconstruct the full normalized play_curve JSONB as a per-interval
  -- video-view weighted average across days that carry a curve. Each day's
  -- curve is a JSON array of true percentages [0,100]; we unnest with ordinality
  -- so interval i lines up across days, weight by that day's video_views, and
  -- re-aggregate back into an ordered array.
  curve_points AS (
    SELECT
      m.ad_id                                    AS ad_id,
      elem.ord                                   AS ord,
      SUM((elem.val)::numeric * m.video_views)   AS num,
      SUM(m.video_views)                         AS den
    FROM public.creative_daily_metrics m
    CROSS JOIN LATERAL jsonb_array_elements_text(m.video_play_curve_actions)
      WITH ORDINALITY AS elem(val, ord)
    WHERE m.account_id = p_account_id
      AND (p_from IS NULL OR m.date >= p_from)
      AND (p_to   IS NULL OR m.date <= p_to)
      AND m.video_play_curve_actions IS NOT NULL
      AND jsonb_typeof(m.video_play_curve_actions) = 'array'
      AND m.video_views > 0
    GROUP BY m.ad_id, elem.ord
  ),
  curve_json AS (
    SELECT
      cp.ad_id AS ad_id,
      jsonb_agg(
        CASE WHEN cp.den > 0 THEN round(cp.num / cp.den, 4) ELSE 0 END
        ORDER BY cp.ord
      ) AS play_curve
    FROM curve_points cp
    GROUP BY cp.ad_id
  )
  UPDATE public.creatives c SET
    spend          = a.spend,
    impressions    = a.impressions,
    clicks         = a.clicks,
    purchases      = a.purchases,
    purchase_value = a.purchase_value,
    adds_to_cart   = a.adds_to_cart,
    video_views    = a.video_views,
    -- ── Derived ratios (never averaged) ────────────────────────────────
    roas = CASE WHEN a.spend > 0 THEN a.purchase_value / a.spend ELSE 0 END,
    cpa  = CASE WHEN a.purchases > 0 THEN a.spend / a.purchases ELSE 0 END,
    ctr  = CASE WHEN a.impressions > 0 THEN (a.clicks::numeric / a.impressions) * 100 ELSE 0 END,
    cpm  = CASE WHEN a.impressions > 0 THEN (a.spend / a.impressions) * 1000 ELSE 0 END,
    cpc  = CASE WHEN a.clicks > 0 THEN a.spend / a.clicks ELSE 0 END,
    cost_per_add_to_cart = CASE WHEN a.adds_to_cart > 0 THEN a.spend / a.adds_to_cart ELSE 0 END,
    thumb_stop_rate = CASE WHEN a.impressions > 0 AND a.video_views > 0
      THEN (a.video_views::numeric / a.impressions) * 100 ELSE 0 END,
    hold_rate = CASE WHEN a.video_views > 0 AND a.thruplays > 0
      THEN (a.thruplays / a.video_views) * 100 ELSE 0 END,
    video_avg_play_time = CASE WHEN a.video_views > 0
      THEN a.vapt_weighted / a.video_views ELSE 0 END,
    -- APPROXIMATE frequency — impression-weighted mean daily frequency. Summed
    -- daily reach would overcount, so there is no exact aggregate reach/frequency
    -- available locally. Accepted product tradeoff (prd nonGoals).
    frequency = CASE WHEN a.impressions > 0
      THEN a.freq_weighted / a.impressions ELSE 0 END,
    -- Generic outcome columns mirror purchases/cpa for PURCHASE accounts. The
    -- daily grain does not carry objective-specific result columns, so the
    -- rollup keeps result_count/cost_per_result aligned with purchases/cpa
    -- (the parseInsightsRow default). SESSION_CONVERSION accounts fall back to
    -- purchase-derived results in the local rollup.
    result_count    = a.purchases,
    cost_per_result = CASE WHEN a.purchases > 0 THEN a.spend / a.purchases ELSE 0 END,
    -- ── Retention rollup (view-weighted) ───────────────────────────────
    retention_p25  = CASE WHEN cv.ret_weight > 0 THEN cv.p25_num  / cv.ret_weight ELSE c.retention_p25  END,
    retention_p50  = CASE WHEN cv.ret_weight > 0 THEN cv.p50_num  / cv.ret_weight ELSE c.retention_p50  END,
    retention_p75  = CASE WHEN cv.ret_weight > 0 THEN cv.p75_num  / cv.ret_weight ELSE c.retention_p75  END,
    retention_p100 = CASE WHEN cv.ret_weight > 0 THEN cv.p100_num / cv.ret_weight ELSE c.retention_p100 END,
    play_curve     = COALESCE(cj.play_curve, c.play_curve)
  FROM agg a
  LEFT JOIN curve_agg  cv ON cv.ad_id = a.ad_id
  LEFT JOIN curve_json cj ON cj.ad_id = a.ad_id
  WHERE c.ad_id = a.ad_id
    AND c.account_id = p_account_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

COMMENT ON FUNCTION public.rollup_creatives_from_daily(text, date, date) IS
  'US-003: Recompute the public.creatives aggregate snapshot LOCALLY from creative_daily_metrics for one account/window, replacing the Phase-2 full-window Meta fetch. Sums summable base metrics; derives ratios from those sums; rolls up daily play-curve/retention (video-view weighted). frequency is APPROXIMATE (no local reach). Returns rows updated.';

GRANT EXECUTE ON FUNCTION public.rollup_creatives_from_daily(text, date, date) TO service_role;
