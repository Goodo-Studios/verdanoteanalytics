-- Fix: rpc_creative_rotation_cohorts failed with 42702 "column reference \"spend\"
-- is ambiguous" — the `totals` CTE used an unqualified SUM(spend), which collides
-- with the function's `spend` OUT column (plpgsql variable_conflict = error).
-- Qualify it as joined.spend. Everything else is unchanged. This broke the
-- Creative Rotation report ("Internal error") for every account, not just large
-- ones. (Per verdanote-rpc-returns-table-qualify-ambiguous-columns.)
-- Idempotent CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.rpc_creative_rotation_cohorts(
  p_account_id text,
  p_from       date,
  p_to         date
)
RETURNS TABLE (
  launch_week    date,
  creative_count bigint,
  still_live     bigint,
  spend          numeric,
  spend_share    numeric,
  purchases      bigint,
  purchase_value numeric,
  cpa            numeric,
  roas           numeric
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
    SELECT NULLIF(SUM(joined.spend), 0) AS grand_spend FROM joined
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
