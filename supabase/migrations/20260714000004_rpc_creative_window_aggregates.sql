-- US-005: On-demand long-range per-ad aggregates computed from daily rows.
--
-- Long-range views (30/90/180/365d) are query-time, not stored. This RPC
-- aggregates public.creative_daily_metrics into per-ad rows for an arbitrary
-- window (<= RETENTION_DAYS = 365 days) using the SAME summable+derived logic as
-- the US-003 rollup_creatives_from_daily snapshot — the difference is US-003
-- WRITES the snapshot onto public.creatives, while this RETURNS per-ad rows for
-- the UI without materializing a wide stored snapshot. That is what makes a full
-- year cheap to hold: we never store one column per window, we sum daily grain on
-- demand, backed by idx_daily_metrics_account_date (account_id, date).
--
-- Contract (identical to US-003):
--   * SUMMABLE base metrics (spend, impressions, clicks, purchases,
--     purchase_value, adds_to_cart, video_views) are summed across the window.
--   * RATIOS (roas, cpa, ctr, cpm, cpc, cost_per_add_to_cart, thumb_stop_rate,
--     hold_rate, video_avg_play_time) are DERIVED from those sums — never
--     averaged — so aggregate ratios reconcile exactly with the summed base
--     metrics (roas = purchase_value / spend, etc.).
--   * retention_p25/p50/p75/p100 are reconstructed video-view weighted (a
--     high-volume day dominates), matching how Meta aggregates.
--   * frequency is APPROXIMATE (impression-weighted mean daily frequency): the
--     daily grain has no reach column, and summed daily reach overcounts. Same
--     accepted product tradeoff as US-003 (prd nonGoals: "No exact freq/reach").
--
-- Window guard: p_to - p_from must be <= 365 days (RETENTION_DAYS). A wider
-- request is rejected rather than silently scanning beyond the retained window.
--
-- Idempotent: CREATE OR REPLACE; re-applying is a no-op reconcilable with
-- `supabase db push`. Numbered AFTER 20260714000001 so the daily play-curve /
-- retention columns it reads already exist (migration-numbering-order policy),
-- and AFTER 20260714000003 to keep the long-horizon batch ordered.
--
-- No new function directory is added by this story, so config.toml /
-- deploy-functions.sh are intentionally untouched (this is a DB RPC only).

CREATE OR REPLACE FUNCTION public.get_creative_window_aggregates(
  p_account_id text,
  p_from       date,
  p_to         date
)
RETURNS TABLE (
  ad_id                 text,
  spend                 numeric,
  impressions           bigint,
  clicks                bigint,
  purchases             bigint,
  purchase_value        numeric,
  adds_to_cart          bigint,
  video_views           bigint,
  roas                  numeric,
  cpa                   numeric,
  ctr                   numeric,
  cpm                   numeric,
  cpc                   numeric,
  cost_per_add_to_cart  numeric,
  thumb_stop_rate       numeric,
  hold_rate             numeric,
  video_avg_play_time   numeric,
  frequency             numeric,
  retention_p25         numeric,
  retention_p50         numeric,
  retention_p75         numeric,
  retention_p100        numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'get_creative_window_aggregates: p_account_id is required';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'get_creative_window_aggregates: p_from and p_to are required';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'get_creative_window_aggregates: p_to (%) is before p_from (%)', p_to, p_from;
  END IF;
  -- Cap the window at RETENTION_DAYS = 365 (inclusive endpoints => 364-day span).
  IF (p_to - p_from) > 365 THEN
    RAISE EXCEPTION 'get_creative_window_aggregates: window (% days) exceeds RETENTION_DAYS=365', (p_to - p_from);
  END IF;

  RETURN QUERY
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
      -- Reconstruct daily thruplays (hold_rate = thruplays / video_views) so
      -- aggregate hold_rate derives from summed base metrics (see US-003).
      COALESCE(SUM(
        CASE WHEN m.hold_rate IS NOT NULL AND m.video_views IS NOT NULL
          THEN (m.hold_rate / 100.0) * m.video_views
          ELSE 0 END
      ), 0)::numeric                                                      AS thruplays,
      -- view-weighted mean avg play time (approximate — Meta reports per-day avg).
      COALESCE(SUM(m.video_avg_play_time * m.video_views), 0)::numeric    AS vapt_weighted,
      -- APPROXIMATE frequency: impression-weighted mean daily frequency.
      COALESCE(SUM(m.frequency * m.impressions), 0)::numeric              AS freq_weighted
    FROM public.creative_daily_metrics m
    WHERE m.account_id = p_account_id
      AND m.date >= p_from
      AND m.date <= p_to
    GROUP BY m.ad_id
  ),
  -- ── Retention rollup (view-weighted, US-001 daily columns) ───────────
  curve_agg AS (
    SELECT
      m.ad_id AS ad_id,
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
      AND m.date >= p_from
      AND m.date <= p_to
    GROUP BY m.ad_id
  )
  SELECT
    a.ad_id,
    a.spend,
    a.impressions,
    a.clicks,
    a.purchases,
    a.purchase_value,
    a.adds_to_cart,
    a.video_views,
    -- ── Derived ratios (never averaged) ──────────────────────────────
    (CASE WHEN a.spend > 0 THEN a.purchase_value / a.spend ELSE 0 END)::numeric        AS roas,
    (CASE WHEN a.purchases > 0 THEN a.spend / a.purchases ELSE 0 END)::numeric         AS cpa,
    (CASE WHEN a.impressions > 0 THEN (a.clicks::numeric / a.impressions) * 100 ELSE 0 END)::numeric AS ctr,
    (CASE WHEN a.impressions > 0 THEN (a.spend / a.impressions) * 1000 ELSE 0 END)::numeric AS cpm,
    (CASE WHEN a.clicks > 0 THEN a.spend / a.clicks ELSE 0 END)::numeric               AS cpc,
    (CASE WHEN a.adds_to_cart > 0 THEN a.spend / a.adds_to_cart ELSE 0 END)::numeric   AS cost_per_add_to_cart,
    (CASE WHEN a.impressions > 0 AND a.video_views > 0
      THEN (a.video_views::numeric / a.impressions) * 100 ELSE 0 END)::numeric         AS thumb_stop_rate,
    (CASE WHEN a.video_views > 0 AND a.thruplays > 0
      THEN (a.thruplays / a.video_views) * 100 ELSE 0 END)::numeric                    AS hold_rate,
    (CASE WHEN a.video_views > 0 THEN a.vapt_weighted / a.video_views ELSE 0 END)::numeric AS video_avg_play_time,
    -- APPROXIMATE frequency (see header).
    (CASE WHEN a.impressions > 0 THEN a.freq_weighted / a.impressions ELSE 0 END)::numeric AS frequency,
    -- ── Retention (view-weighted) ────────────────────────────────────
    (CASE WHEN cv.ret_weight > 0 THEN cv.p25_num  / cv.ret_weight ELSE NULL END)::numeric AS retention_p25,
    (CASE WHEN cv.ret_weight > 0 THEN cv.p50_num  / cv.ret_weight ELSE NULL END)::numeric AS retention_p50,
    (CASE WHEN cv.ret_weight > 0 THEN cv.p75_num  / cv.ret_weight ELSE NULL END)::numeric AS retention_p75,
    (CASE WHEN cv.ret_weight > 0 THEN cv.p100_num / cv.ret_weight ELSE NULL END)::numeric AS retention_p100
  FROM agg a
  LEFT JOIN curve_agg cv ON cv.ad_id = a.ad_id
  ORDER BY a.spend DESC;
END;
$$;

COMMENT ON FUNCTION public.get_creative_window_aggregates(text, date, date) IS
  'US-005: On-demand per-ad aggregates over creative_daily_metrics for an arbitrary window (<= RETENTION_DAYS=365). Same summable+derived logic as rollup_creatives_from_daily (US-003) but RETURNS per-ad rows instead of writing the snapshot, so long-range views are query-time (not stored). frequency APPROXIMATE (no local reach). Backed by idx_daily_metrics_account_date.';

GRANT EXECUTE ON FUNCTION public.get_creative_window_aggregates(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_creative_window_aggregates(text, date, date) TO service_role;
