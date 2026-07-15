-- Landing Pages report (Creative Terminal — Phase 1, Feature 1), US-004: destination drill-in.
--
-- get_landing_pages_report (US-002) rolls creative_daily_metrics up to the
-- DESTINATION grain (creatives.destination_key). This RPC is the drill-in: for ONE
-- destination_key it returns the per-CREATIVE rows whose destination_key matches,
-- for an account + window — so clicking a destination card opens the list of ads
-- pointing at that page.
--
-- Same summable-base + derived-ratio contract as get_creative_window_aggregates
-- (US-005) and get_landing_pages_report (US-002): base metrics (spend, impressions,
-- clicks, purchases, purchase_value) are SUMMED across the window; ratios
-- (roas, cpa, ctr, cpc) are DERIVED from those sums, never averaged, so a creative's
-- roas/cpa reconcile exactly with its summed spend/purchases and with the parent
-- destination card. Percentage fields (ctr) are true percentages at source
-- (per verdanote-pct-fields-true-percentage-at-source).
--
-- Playable-media columns (thumbnail_url / preview_url / video_url) come straight
-- off public.creatives (the render source of truth) so the drill-in can show a
-- thumbnail / play the ad without a second query. ad_name is the display name.
--
-- SECURITY DEFINER + TRUSTS p_account_id, exactly like get_landing_pages_report:
-- authenticated EXECUTE is REVOKEd so a signed-in user cannot pass an arbitrary
-- p_account_id and read another tenant's creatives (the same cross-account IDOR
-- class closed in 20260714000013). The session-authed `landing-pages` edge function
-- is the only sanctioned caller — it verifies the JWT + account ownership, then
-- invokes this via service role.
--
-- Idempotent (CREATE OR REPLACE). Backed by idx_creatives_account_destination
-- (account_id, destination_key) and idx_daily_metrics_account_date. Window capped
-- at RETENTION_DAYS=365. All columns qualified.
--
-- NOTE FOR ORCHESTRATOR: numbered 20260718000001 as a PLACEHOLDER. It lands after
-- prod's already-applied …000010–…000013 today; renumber to the next free slot at
-- deploy time if a collision exists (per
-- verdanote-db-push-matches-by-version-number-collision-skips).

CREATE OR REPLACE FUNCTION public.get_landing_page_creatives(
  p_account_id      text,
  p_from            date,
  p_to              date,
  p_destination_key text
)
RETURNS TABLE (
  ad_id           text,
  ad_name         text,
  thumbnail_url   text,
  preview_url     text,
  video_url       text,
  spend           numeric,
  impressions     bigint,
  clicks          bigint,
  purchases       bigint,
  purchase_value  numeric,
  roas            numeric,
  cpa             numeric,
  ctr             numeric,
  cpc             numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'get_landing_page_creatives: p_account_id is required';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'get_landing_page_creatives: p_from and p_to are required';
  END IF;
  IF p_destination_key IS NULL OR p_destination_key = '' THEN
    RAISE EXCEPTION 'get_landing_page_creatives: p_destination_key is required (NULL/'''' are not real destinations)';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'get_landing_page_creatives: p_to (%) is before p_from (%)', p_to, p_from;
  END IF;
  IF (p_to - p_from) > 365 THEN
    RAISE EXCEPTION 'get_landing_page_creatives: window (% days) exceeds RETENTION_DAYS=365', (p_to - p_from);
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT
      m.ad_id                                       AS ad_id,
      COALESCE(SUM(m.spend), 0)::numeric            AS spend,
      COALESCE(SUM(m.impressions), 0)::bigint       AS impressions,
      COALESCE(SUM(m.clicks), 0)::bigint            AS clicks,
      COALESCE(SUM(m.purchases), 0)::bigint         AS purchases,
      COALESCE(SUM(m.purchase_value), 0)::numeric   AS purchase_value
    FROM public.creative_daily_metrics m
    JOIN public.creatives c ON c.ad_id = m.ad_id
    WHERE m.account_id = p_account_id
      AND c.destination_key = p_destination_key
      AND m.date >= p_from
      AND m.date <= p_to
    GROUP BY m.ad_id
  )
  SELECT
    a.ad_id,
    c.ad_name                                       AS ad_name,
    c.thumbnail_url                                 AS thumbnail_url,
    c.preview_url                                   AS preview_url,
    c.video_url                                     AS video_url,
    a.spend,
    a.impressions,
    a.clicks,
    a.purchases,
    a.purchase_value,
    -- Derived ratios (never averaged); mirrors get_creative_window_aggregates.
    (CASE WHEN a.spend > 0 THEN a.purchase_value / a.spend ELSE 0 END)::numeric        AS roas,
    (CASE WHEN a.purchases > 0 THEN a.spend / a.purchases ELSE 0 END)::numeric         AS cpa,
    (CASE WHEN a.impressions > 0 THEN (a.clicks::numeric / a.impressions) * 100 ELSE 0 END)::numeric AS ctr,
    (CASE WHEN a.clicks > 0 THEN a.spend / a.clicks ELSE 0 END)::numeric               AS cpc
  FROM agg a
  JOIN public.creatives c ON c.ad_id = a.ad_id
  ORDER BY a.spend DESC;
END;
$$;

COMMENT ON FUNCTION public.get_landing_page_creatives(text, date, date, text) IS
  'US-004 Landing Pages drill-in: per-creative rows for one destination_key over an account+window (<= 365d). Summable base + derived ratios (never averaged) matching get_creative_window_aggregates; joins creatives for ad_name + playable media (thumbnail/preview/video). SECURITY DEFINER, authenticated EXECUTE revoked (IDOR): only the session-authed landing-pages edge fn calls it via service role.';

-- SECURITY DEFINER + trusts p_account_id: revoke authenticated so no signed-in user
-- can read another account's creatives by passing a different p_account_id.
REVOKE EXECUTE ON FUNCTION public.get_landing_page_creatives(text, date, date, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_landing_page_creatives(text, date, date, text) TO service_role;
