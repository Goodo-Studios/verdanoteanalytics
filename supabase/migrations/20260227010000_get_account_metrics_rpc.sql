-- Server-side aggregation for account metrics
-- Handles accounts with 10k-22k+ creatives without hitting REST row limits
CREATE OR REPLACE FUNCTION public.get_account_metrics(p_account_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_creatives',     COUNT(*),
    'total_spend',         ROUND(COALESCE(SUM(spend), 0)::numeric, 2),
    'total_purchase_value',ROUND(COALESCE(SUM(purchase_value), 0)::numeric, 2),
    'total_impressions',   COALESCE(SUM(impressions), 0),
    'total_clicks',        COALESCE(SUM(clicks), 0),
    'total_purchases',     COALESCE(SUM(purchases), 0),
    'blended_roas',        CASE
                             WHEN COALESCE(SUM(spend), 0) > 0
                             THEN ROUND((COALESCE(SUM(purchase_value), 0) / SUM(spend))::numeric, 2)
                             ELSE 0
                           END,
    'avg_ctr',             CASE
                             WHEN COALESCE(SUM(impressions), 0) > 0
                             THEN ROUND(((COALESCE(SUM(clicks), 0)::numeric / SUM(impressions)) * 100)::numeric, 2)
                             ELSE 0
                           END,
    'avg_cpa',             CASE
                             WHEN COALESCE(SUM(purchases), 0) > 0
                             THEN ROUND((COALESCE(SUM(spend), 0) / SUM(purchases))::numeric, 2)
                             ELSE 0
                           END,
    'active_creatives',    COUNT(*) FILTER (WHERE ad_status = 'ACTIVE'),
    'with_spend',          COUNT(*) FILTER (WHERE spend > 0)
  )
  INTO result
  FROM public.creatives
  WHERE (p_account_id IS NULL OR account_id = p_account_id);

  RETURN result;
END;
$$;

-- Grant execute to authenticated users (RLS on creatives still applies for anon)
-- Service role used by edge function bypasses RLS
GRANT EXECUTE ON FUNCTION public.get_account_metrics(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_metrics(text) TO service_role;
