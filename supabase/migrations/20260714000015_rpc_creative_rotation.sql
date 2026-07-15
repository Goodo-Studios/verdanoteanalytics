-- Feature 3 (Creative Rotation report) — read RPCs over creative_daily_metrics
-- + F2 lifecycle dates (20260715000001).
--
-- All aggregation/ranking lives here (single source of truth); the edge fn
-- (creative-rotation) and React page render rows verbatim. Mirrors the
-- summable-base / derived-ratio contract of rollup_creatives_from_daily
-- (20260714000002) and get_creative_window_aggregates (20260714000004):
--   * base metrics (spend, purchases, purchase_value) are SUMMED over the window;
--   * ratios (cpa = spend/purchases, roas = purchase_value/spend) are DERIVED
--     from those sums — never averaged.
-- CTR and other percentages are already true percentages upstream; nothing here
-- multiplies a ratio by 100 erroneously — freshness "% of spend" percentages are
-- computed as share*100 of summed spend, which is a genuine percentage.
--
-- "Creative age" for a spend day = that day's date minus the ad's launch_date
-- (F2). A creative is "fresh" on a given day if its age that day <= p_fresh_days
-- (the 7/14/30 toggle), else "stale". Age is measured PER SPEND DAY, not from a
-- single as-of date, so spend-weighted age and fresh/stale CPA reconcile with the
-- window's daily grain. Ads with no launch_date (should be none after F2 derive)
-- are excluded from age math but still counted in raw spend totals via COALESCE.
--
-- Three SECURITY DEFINER RPCs, all trusting p_account_id → IDOR-gated: EXECUTE
-- revoked from authenticated, granted to service_role only, exposed through the
-- session-authed creative-rotation edge fn (auth.getUser + verifyAccountOwnership).
-- Idempotent: CREATE OR REPLACE.

-- ── 1. Freshness KPIs + weekly spend-share-by-age + freshness-vs-CPA trend ────
-- Returns ONE row per ISO week in the window plus a synthetic 'TOTAL' bucket, so
-- the caller gets both the weekly stacked-area series AND the window-level KPIs
-- from a single call. Age buckets: fresh (<= p_fresh_days), mid, stale.
CREATE OR REPLACE FUNCTION public.rpc_creative_rotation_freshness(
  p_account_id text,
  p_from       date,
  p_to         date,
  p_fresh_days integer DEFAULT 14
)
RETURNS TABLE (
  bucket            text,     -- 'week' | 'total'
  week_start        date,     -- Monday of the ISO week (NULL for total row)
  total_spend       numeric,
  fresh_spend       numeric,  -- age <= p_fresh_days
  mid_spend         numeric,  -- p_fresh_days < age <= 2*p_fresh_days
  stale_spend       numeric,  -- age > 2*p_fresh_days
  fresh_spend_pct   numeric,  -- true percentage of total_spend
  spend_weighted_age numeric, -- Σ(age*spend)/Σ(spend), days
  fresh_purchases   bigint,
  fresh_spend_conv  numeric,  -- spend on days age<=fresh with purchases path
  stale_purchases   bigint,
  fresh_cpa         numeric,  -- derived: fresh_spend / fresh_purchases
  stale_cpa         numeric   -- derived: stale_spend / stale_purchases
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'rpc_creative_rotation_freshness: p_account_id is required';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'rpc_creative_rotation_freshness: p_from and p_to are required';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'rpc_creative_rotation_freshness: p_to (%) is before p_from (%)', p_to, p_from;
  END IF;
  IF (p_to - p_from) > 365 THEN
    RAISE EXCEPTION 'rpc_creative_rotation_freshness: window (% days) exceeds RETENTION_DAYS=365', (p_to - p_from);
  END IF;
  IF p_fresh_days IS NULL OR p_fresh_days <= 0 THEN
    p_fresh_days := 14;
  END IF;

  RETURN QUERY
  WITH day_rows AS (
    SELECT
      m.date                                            AS d,
      date_trunc('week', m.date)::date                  AS wk,
      COALESCE(m.spend, 0)::numeric                     AS spend,
      COALESCE(m.purchases, 0)::bigint                  AS purchases,
      -- age of the creative on THIS spend day
      (m.date - c.launch_date)                          AS age_days
    FROM public.creative_daily_metrics m
    JOIN public.creatives c
      ON c.ad_id = m.ad_id AND c.account_id = m.account_id
    WHERE m.account_id = p_account_id
      AND m.date >= p_from
      AND m.date <= p_to
  ),
  classed AS (
    SELECT
      d, wk, spend, purchases, age_days,
      CASE
        WHEN age_days IS NULL THEN NULL
        WHEN age_days <= p_fresh_days THEN 'fresh'
        WHEN age_days <= (2 * p_fresh_days) THEN 'mid'
        ELSE 'stale'
      END AS age_class
    FROM day_rows
  ),
  weekly AS (
    SELECT
      'week'::text                                                       AS bucket,
      wk                                                                 AS week_start,
      SUM(spend)                                                         AS total_spend,
      SUM(spend) FILTER (WHERE age_class = 'fresh')                      AS fresh_spend,
      SUM(spend) FILTER (WHERE age_class = 'mid')                        AS mid_spend,
      SUM(spend) FILTER (WHERE age_class = 'stale')                      AS stale_spend,
      SUM(spend * age_days) FILTER (WHERE age_days IS NOT NULL)          AS age_spend_num,
      SUM(spend) FILTER (WHERE age_days IS NOT NULL)                     AS age_spend_den,
      SUM(purchases) FILTER (WHERE age_class = 'fresh')                  AS fresh_purchases,
      SUM(purchases) FILTER (WHERE age_class = 'stale')                  AS stale_purchases
    FROM classed
    GROUP BY wk
  ),
  total AS (
    SELECT
      'total'::text                                                      AS bucket,
      NULL::date                                                         AS week_start,
      SUM(spend)                                                         AS total_spend,
      SUM(spend) FILTER (WHERE age_class = 'fresh')                      AS fresh_spend,
      SUM(spend) FILTER (WHERE age_class = 'mid')                        AS mid_spend,
      SUM(spend) FILTER (WHERE age_class = 'stale')                      AS stale_spend,
      SUM(spend * age_days) FILTER (WHERE age_days IS NOT NULL)          AS age_spend_num,
      SUM(spend) FILTER (WHERE age_days IS NOT NULL)                     AS age_spend_den,
      SUM(purchases) FILTER (WHERE age_class = 'fresh')                  AS fresh_purchases,
      SUM(purchases) FILTER (WHERE age_class = 'stale')                  AS stale_purchases
    FROM classed
  ),
  unioned AS (
    SELECT * FROM weekly
    UNION ALL
    SELECT * FROM total
  )
  SELECT
    u.bucket,
    u.week_start,
    COALESCE(u.total_spend, 0)::numeric                                            AS total_spend,
    COALESCE(u.fresh_spend, 0)::numeric                                            AS fresh_spend,
    COALESCE(u.mid_spend, 0)::numeric                                              AS mid_spend,
    COALESCE(u.stale_spend, 0)::numeric                                            AS stale_spend,
    (CASE WHEN COALESCE(u.total_spend,0) > 0
      THEN (COALESCE(u.fresh_spend,0) / u.total_spend) * 100 ELSE 0 END)::numeric  AS fresh_spend_pct,
    (CASE WHEN COALESCE(u.age_spend_den,0) > 0
      THEN u.age_spend_num / u.age_spend_den ELSE 0 END)::numeric                  AS spend_weighted_age,
    COALESCE(u.fresh_purchases, 0)::bigint                                         AS fresh_purchases,
    COALESCE(u.fresh_spend, 0)::numeric                                            AS fresh_spend_conv,
    COALESCE(u.stale_purchases, 0)::bigint                                         AS stale_purchases,
    (CASE WHEN COALESCE(u.fresh_purchases,0) > 0
      THEN COALESCE(u.fresh_spend,0) / u.fresh_purchases ELSE 0 END)::numeric      AS fresh_cpa,
    (CASE WHEN COALESCE(u.stale_purchases,0) > 0
      THEN COALESCE(u.stale_spend,0) / u.stale_purchases ELSE 0 END)::numeric      AS stale_cpa
  FROM unioned u
  ORDER BY (u.bucket = 'total'), u.week_start;  -- weeks first (chron), total last
END;
$$;

COMMENT ON FUNCTION public.rpc_creative_rotation_freshness(text, date, date, integer) IS
  'Feature 3: weekly spend-by-creative-age (fresh/mid/stale) + window freshness KPIs (fresh %spend, spend-weighted age, fresh vs stale CPA). Age = spend-day date - launch_date (F2). Ratios derived from sums.';

-- ── 2. Launch-cohort table ────────────────────────────────────────────────
-- Creatives grouped by launch WEEK: how many launched, how many still live, and
-- their windowed performance. "still_live" = ad_status ILIKE 'ACTIVE' on the
-- creatives snapshot. Spend/purchases summed over the window from daily grain.
CREATE OR REPLACE FUNCTION public.rpc_creative_rotation_cohorts(
  p_account_id text,
  p_from       date,
  p_to         date
)
RETURNS TABLE (
  launch_week    date,     -- Monday of the ad's launch week
  creative_count bigint,
  still_live     bigint,
  spend          numeric,
  spend_share    numeric,  -- true percentage of window total spend
  purchases      bigint,
  purchase_value numeric,
  cpa            numeric,  -- derived
  roas           numeric   -- derived
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'rpc_creative_rotation_cohorts: p_account_id is required';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'rpc_creative_rotation_cohorts: p_from and p_to are required';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'rpc_creative_rotation_cohorts: p_to (%) is before p_from (%)', p_to, p_from;
  END IF;

  RETURN QUERY
  WITH windowed AS (
    SELECT
      m.ad_id                            AS ad_id,
      SUM(COALESCE(m.spend, 0))          AS spend,
      SUM(COALESCE(m.purchases, 0))      AS purchases,
      SUM(COALESCE(m.purchase_value, 0)) AS purchase_value
    FROM public.creative_daily_metrics m
    WHERE m.account_id = p_account_id
      AND m.date >= p_from
      AND m.date <= p_to
    GROUP BY m.ad_id
  ),
  joined AS (
    SELECT
      date_trunc('week', c.launch_date)::date AS launch_week,
      c.ad_id,
      (c.ad_status ILIKE 'ACTIVE')            AS is_live,
      COALESCE(w.spend, 0)::numeric           AS spend,
      COALESCE(w.purchases, 0)::bigint        AS purchases,
      COALESCE(w.purchase_value, 0)::numeric  AS purchase_value
    FROM public.creatives c
    LEFT JOIN windowed w ON w.ad_id = c.ad_id
    WHERE c.account_id = p_account_id
      AND c.launch_date IS NOT NULL
  ),
  totals AS (
    SELECT NULLIF(SUM(spend), 0) AS grand_spend FROM joined
  )
  SELECT
    j.launch_week,
    COUNT(*)::bigint                                                   AS creative_count,
    COUNT(*) FILTER (WHERE j.is_live)::bigint                          AS still_live,
    SUM(j.spend)::numeric                                             AS spend,
    (COALESCE(SUM(j.spend) / (SELECT grand_spend FROM totals), 0) * 100)::numeric AS spend_share,
    SUM(j.purchases)::bigint                                          AS purchases,
    SUM(j.purchase_value)::numeric                                    AS purchase_value,
    (CASE WHEN SUM(j.purchases) > 0 THEN SUM(j.spend) / SUM(j.purchases) ELSE 0 END)::numeric AS cpa,
    (CASE WHEN SUM(j.spend) > 0 THEN SUM(j.purchase_value) / SUM(j.spend) ELSE 0 END)::numeric AS roas
  FROM joined j
  GROUP BY j.launch_week
  ORDER BY j.launch_week;
END;
$$;

COMMENT ON FUNCTION public.rpc_creative_rotation_cohorts(text, date, date) IS
  'Feature 3: launch-cohort table — creatives grouped by launch week with count, still-live, windowed spend/share/purchases/CPA/ROAS. Ratios derived from sums.';

-- ── 3. "New ads added over time" timeline ────────────────────────────────
-- Count of creatives whose launch_date falls in each ISO week (independent of
-- the metrics window — this is the account's creative-intake cadence). p_from/
-- p_to bound the timeline horizon.
CREATE OR REPLACE FUNCTION public.rpc_creative_rotation_new_ads_timeline(
  p_account_id text,
  p_from       date,
  p_to         date
)
RETURNS TABLE (
  week_start   date,
  new_ads      bigint,
  cumulative   bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'rpc_creative_rotation_new_ads_timeline: p_account_id is required';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'rpc_creative_rotation_new_ads_timeline: p_from and p_to are required';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'rpc_creative_rotation_new_ads_timeline: p_to (%) is before p_from (%)', p_to, p_from;
  END IF;

  RETURN QUERY
  WITH weekly AS (
    SELECT
      date_trunc('week', c.launch_date)::date AS week_start,
      COUNT(*)::bigint                        AS new_ads
    FROM public.creatives c
    WHERE c.account_id = p_account_id
      AND c.launch_date IS NOT NULL
      AND c.launch_date >= p_from
      AND c.launch_date <= p_to
    GROUP BY date_trunc('week', c.launch_date)::date
  )
  SELECT
    w.week_start,
    w.new_ads,
    SUM(w.new_ads) OVER (ORDER BY w.week_start
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::bigint AS cumulative
  FROM weekly w
  ORDER BY w.week_start;
END;
$$;

COMMENT ON FUNCTION public.rpc_creative_rotation_new_ads_timeline(text, date, date) IS
  'Feature 3: "new ads added over time" — count of creatives by launch week within [p_from,p_to], with running cumulative.';

-- ── IDOR gating (all three trust p_account_id) ────────────────────────────
REVOKE ALL     ON FUNCTION public.rpc_creative_rotation_freshness(text, date, date, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_creative_rotation_freshness(text, date, date, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.rpc_creative_rotation_freshness(text, date, date, integer) TO service_role;

REVOKE ALL     ON FUNCTION public.rpc_creative_rotation_cohorts(text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_creative_rotation_cohorts(text, date, date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.rpc_creative_rotation_cohorts(text, date, date) TO service_role;

REVOKE ALL     ON FUNCTION public.rpc_creative_rotation_new_ads_timeline(text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_creative_rotation_new_ads_timeline(text, date, date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.rpc_creative_rotation_new_ads_timeline(text, date, date) TO service_role;
