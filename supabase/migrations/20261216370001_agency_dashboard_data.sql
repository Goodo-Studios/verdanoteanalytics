-- Audit plan item 7.3, part 9: the agency dashboard in one value.
--
-- get_agency_dashboard_summary returns one row per (account, ad): about 6,000 rows for a month
-- in production. PostgREST returns at most max_rows (1,000) rows, so the dashboard silently
-- lost whole accounts (no spend, revenue or card numbers) and most ads.
--
-- get_agency_dashboard_data returns the same figures as ONE jsonb value, which the row cap
-- does not touch:
--   accounts: one entry per account with spend in the range (period spend and revenue, active
--             ad count, prior-range spend)
--   ads:      one entry per ad with spend > 0 in the range (name, thumbnail, spend, value,
--             impressions, impression-weighted frequency parts), ordered by account and ad
--
-- Same staff-only gate as get_agency_dashboard_summary. The old function is left in place so
-- the deployed frontend keeps working until the new one ships; drop it in a later release.

CREATE OR REPLACE FUNCTION public.get_agency_dashboard_data(
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL,
  p_prior_from date DEFAULT NULL,
  p_prior_to   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- STAFF-ONLY GATE: this returns every account.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'builder')
     AND NOT public.has_role(auth.uid(), 'employee') THEN
    RAISE EXCEPTION 'access denied: agency dashboard is staff-only'
      USING ERRCODE = '42501';
  END IF;

  WITH current_by_ad AS (
    SELECT
      m.account_id,
      m.ad_id,
      COALESCE(SUM(m.spend), 0)::numeric          AS ad_spend,
      COALESCE(SUM(m.purchase_value), 0)::numeric AS ad_purchase_value,
      COALESCE(SUM(m.impressions), 0)::bigint     AS ad_impressions,
      COALESCE(SUM(CASE WHEN m.frequency > 0 AND m.impressions > 0
                        THEN m.frequency * m.impressions ELSE 0 END), 0)::numeric AS ad_frequency_weighted,
      COALESCE(SUM(CASE WHEN m.frequency > 0 AND m.impressions > 0
                        THEN m.impressions ELSE 0 END), 0)::bigint                AS ad_frequency_impressions
    FROM public.creative_daily_metrics m
    WHERE (p_from IS NULL OR m.date >= p_from)
      AND (p_to   IS NULL OR m.date <= p_to)
    GROUP BY m.account_id, m.ad_id
  ),
  prior_by_account AS (
    SELECT m.account_id, COALESCE(SUM(m.spend), 0)::numeric AS prior_spend
    FROM public.creative_daily_metrics m
    WHERE (p_prior_from IS NULL OR m.date >= p_prior_from)
      AND (p_prior_to   IS NULL OR m.date <= p_prior_to)
    GROUP BY m.account_id
  ),
  account_agg AS (
    SELECT
      ca.account_id,
      COALESCE(SUM(ca.ad_spend), 0)::numeric          AS period_spend,
      COALESCE(SUM(ca.ad_purchase_value), 0)::numeric AS period_revenue,
      COUNT(*) FILTER (WHERE ca.ad_spend > 0)::bigint AS active_ad_count
    FROM current_by_ad ca
    GROUP BY ca.account_id
  )
  SELECT jsonb_build_object(
    'accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'account_id',      aa.account_id,
               'period_spend',    aa.period_spend,
               'period_revenue',  aa.period_revenue,
               'active_ad_count', aa.active_ad_count,
               'prior_spend',     COALESCE(pa.prior_spend, 0)
             ) ORDER BY aa.account_id)
      FROM account_agg aa
      LEFT JOIN prior_by_account pa ON pa.account_id = aa.account_id
    ), '[]'::jsonb),
    'ads', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'ad_id',                 ca.ad_id,
               'account_id',            ca.account_id,
               'ad_name',               cr.ad_name,
               'thumbnail_url',         cr.thumbnail_url,
               'spend',                 ca.ad_spend,
               'purchase_value',        ca.ad_purchase_value,
               'impressions',           ca.ad_impressions,
               'frequency_weighted',    ca.ad_frequency_weighted,
               'frequency_impressions', ca.ad_frequency_impressions
             ) ORDER BY ca.account_id, ca.ad_id)
      FROM current_by_ad ca
      LEFT JOIN public.creatives cr ON cr.ad_id = ca.ad_id AND cr.account_id = ca.account_id
      WHERE ca.ad_spend > 0
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_agency_dashboard_data(date, date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_dashboard_data(date, date, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_dashboard_data(date, date, date, date) TO service_role;
