-- ============================================================================
-- SECURITY: Tenant-isolation remediation (audit 2026-08-08)
--
-- Closes cross-tenant data leaks in SECURITY DEFINER report functions and three
-- table RLS policies. All of these let a `client` user of one account read
-- another account's data (spend / ROAS / revenue / briefs / changelog).
--
-- Guard pattern is the one already established in public.get_convention
-- (20260529000002): these functions are SECURITY DEFINER + GRANTed to
-- `authenticated`, so they BYPASS the per-account RLS on their source tables.
-- Without an in-function caller check, any logged-in client can pass another
-- account's id (or NULL, to get every account). service_role (edge functions
-- that have already run their own ownership check) stays exempt; agency staff
-- (builder/employee) legitimately see all accounts.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS, ADD COLUMN IF
-- NOT EXISTS. Function bodies below are byte-for-byte the originals with only a
-- caller-scoping gate prepended.
-- ============================================================================

-- ── C1. get_account_metrics: per-account guard ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_account_metrics(p_account_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  -- CALLER-SCOPING GATE — see header. Non-service-role, non-staff callers may
  -- only read an account they are a member of; NULL (all accounts) is staff-only.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'builder')
     AND NOT public.has_role(auth.uid(), 'employee') THEN
    IF p_account_id IS NULL
       OR p_account_id NOT IN (SELECT public.get_user_account_ids(auth.uid())) THEN
      RAISE EXCEPTION 'access denied to account %', COALESCE(p_account_id, '(all accounts)')
        USING ERRCODE = '42501';
    END IF;
  END IF;

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

-- ── C2a. get_period_metrics: per-account guard ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_period_metrics(
  p_account_id text DEFAULT NULL,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL
)
RETURNS TABLE (
  total_spend          numeric,
  total_impressions    bigint,
  total_clicks         bigint,
  total_purchases      bigint,
  total_purchase_value numeric,
  total_adds_to_cart   bigint,
  total_video_views    bigint,
  active_count         bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- CALLER-SCOPING GATE — see header.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'builder')
     AND NOT public.has_role(auth.uid(), 'employee') THEN
    IF p_account_id IS NULL
       OR p_account_id NOT IN (SELECT public.get_user_account_ids(auth.uid())) THEN
      RAISE EXCEPTION 'access denied to account %', COALESCE(p_account_id, '(all accounts)')
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(m.spend), 0)::numeric                                   AS total_spend,
    COALESCE(SUM(m.impressions), 0)::bigint                              AS total_impressions,
    COALESCE(SUM(m.clicks), 0)::bigint                                   AS total_clicks,
    COALESCE(SUM(m.purchases), 0)::bigint                                AS total_purchases,
    COALESCE(SUM(m.purchase_value), 0)::numeric                          AS total_purchase_value,
    COALESCE(SUM(m.adds_to_cart), 0)::bigint                             AS total_adds_to_cart,
    COALESCE(SUM(m.video_views), 0)::bigint                              AS total_video_views,
    COUNT(DISTINCT CASE WHEN m.spend > 0 THEN m.ad_id ELSE NULL END)     AS active_count
  FROM public.creative_daily_metrics m
  WHERE
    (p_account_id IS NULL OR m.account_id = p_account_id)
    AND (p_from IS NULL OR m.date >= p_from)
    AND (p_to   IS NULL OR m.date <= p_to);
END;
$$;

-- ── C2b. get_daily_trends: per-account guard ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_daily_trends(
  p_account_id text DEFAULT NULL,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL
)
RETURNS TABLE (
  trend_date           date,
  spend                numeric,
  impressions          bigint,
  clicks               bigint,
  purchases            bigint,
  purchase_value       numeric,
  adds_to_cart         bigint,
  video_views          bigint,
  avg_frequency        numeric,
  active_ad_count      bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- CALLER-SCOPING GATE — see header.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'builder')
     AND NOT public.has_role(auth.uid(), 'employee') THEN
    IF p_account_id IS NULL
       OR p_account_id NOT IN (SELECT public.get_user_account_ids(auth.uid())) THEN
      RAISE EXCEPTION 'access denied to account %', COALESCE(p_account_id, '(all accounts)')
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    m.date                                                                                AS trend_date,
    COALESCE(SUM(m.spend), 0)::numeric                                                   AS spend,
    COALESCE(SUM(m.impressions), 0)::bigint                                              AS impressions,
    COALESCE(SUM(m.clicks), 0)::bigint                                                   AS clicks,
    COALESCE(SUM(m.purchases), 0)::bigint                                                AS purchases,
    COALESCE(SUM(m.purchase_value), 0)::numeric                                          AS purchase_value,
    COALESCE(SUM(m.adds_to_cart), 0)::bigint                                             AS adds_to_cart,
    COALESCE(SUM(m.video_views), 0)::bigint                                              AS video_views,
    COALESCE(
      AVG(m.frequency) FILTER (WHERE m.frequency IS NOT NULL AND m.frequency > 0),
      0
    )::numeric                                                                           AS avg_frequency,
    COUNT(DISTINCT m.ad_id)                                                              AS active_ad_count
  FROM public.creative_daily_metrics m
  WHERE
    (p_account_id IS NULL OR m.account_id = p_account_id)
    AND (p_from IS NULL OR m.date >= p_from)
    AND (p_to   IS NULL OR m.date <= p_to)
  GROUP BY m.date
  ORDER BY m.date ASC;
END;
$$;

-- ── C3. get_creative_window_aggregates: per-account guard ───────────────────
-- p_account_id is already required (NOT NULL check exists); add ownership check.
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

  -- CALLER-SCOPING GATE — see header. Non-service-role, non-staff callers may
  -- only read an account they are a member of.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'builder')
     AND NOT public.has_role(auth.uid(), 'employee') THEN
    IF p_account_id NOT IN (SELECT public.get_user_account_ids(auth.uid())) THEN
      RAISE EXCEPTION 'access denied to account %', p_account_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT
      m.ad_id                                                             AS ad_id,
      COALESCE(SUM(m.spend), 0)::numeric                                  AS spend,
      COALESCE(SUM(m.impressions), 0)::bigint                             AS impressions,
      COALESCE(SUM(m.clicks), 0)::bigint                                  AS clicks,
      COALESCE(SUM(m.purchases), 0)::bigint                               AS purchases,
      COALESCE(SUM(m.purchase_value), 0)::numeric                         AS purchase_value,
      COALESCE(SUM(m.adds_to_cart), 0)::bigint                            AS adds_to_cart,
      COALESCE(SUM(m.video_views), 0)::bigint                             AS video_views,
      COALESCE(SUM(
        CASE WHEN m.hold_rate IS NOT NULL AND m.video_views IS NOT NULL
          THEN (m.hold_rate / 100.0) * m.video_views
          ELSE 0 END
      ), 0)::numeric                                                      AS thruplays,
      COALESCE(SUM(m.video_avg_play_time * m.video_views), 0)::numeric    AS vapt_weighted,
      COALESCE(SUM(m.frequency * m.impressions), 0)::numeric              AS freq_weighted
    FROM public.creative_daily_metrics m
    WHERE m.account_id = p_account_id
      AND m.date >= p_from
      AND m.date <= p_to
    GROUP BY m.ad_id
  ),
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
    (CASE WHEN a.impressions > 0 THEN a.freq_weighted / a.impressions ELSE 0 END)::numeric AS frequency,
    (CASE WHEN cv.ret_weight > 0 THEN cv.p25_num  / cv.ret_weight ELSE NULL END)::numeric AS retention_p25,
    (CASE WHEN cv.ret_weight > 0 THEN cv.p50_num  / cv.ret_weight ELSE NULL END)::numeric AS retention_p50,
    (CASE WHEN cv.ret_weight > 0 THEN cv.p75_num  / cv.ret_weight ELSE NULL END)::numeric AS retention_p75,
    (CASE WHEN cv.ret_weight > 0 THEN cv.p100_num / cv.ret_weight ELSE NULL END)::numeric AS retention_p100
  FROM agg a
  LEFT JOIN curve_agg cv ON cv.ad_id = a.ad_id
  ORDER BY a.spend DESC;
END;
$$;

-- ── C4. get_media_coverage: staff/service-role only ─────────────────────────
-- LANGUAGE sql (no body guard possible without a rewrite); it has zero frontend
-- and zero edge-function callers, and its sibling rpc_media_coverage() is
-- already service_role-only. Revoke the authenticated grant to match.
REVOKE EXECUTE ON FUNCTION public.get_media_coverage(text) FROM authenticated;

-- ── C5. get_agency_dashboard_summary: staff-only ────────────────────────────
-- Takes no account filter and returns EVERY account's daily metrics, so it is
-- inherently a staff view (the agency dashboard). Restrict to staff/service_role.
CREATE OR REPLACE FUNCTION public.get_agency_dashboard_summary(
  p_from      date DEFAULT NULL,
  p_to        date DEFAULT NULL,
  p_prior_from date DEFAULT NULL,
  p_prior_to   date DEFAULT NULL
)
RETURNS TABLE (
  account_id           text,
  period_spend         numeric,
  period_revenue       numeric,
  active_ad_count      bigint,
  prior_spend          numeric,
  ad_id                text,
  ad_name              text,
  thumbnail_url        text,
  ad_spend             numeric,
  ad_purchase_value    numeric,
  ad_impressions       bigint,
  ad_frequency_weighted  numeric,
  ad_frequency_impressions bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- STAFF-ONLY GATE — this returns all accounts; only agency staff or the
  -- service role may call it.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'builder')
     AND NOT public.has_role(auth.uid(), 'employee') THEN
    RAISE EXCEPTION 'access denied: agency dashboard is staff-only'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH current_by_ad AS (
    SELECT
      m.account_id,
      m.ad_id,
      COALESCE(SUM(m.spend), 0)::numeric           AS ad_spend,
      COALESCE(SUM(m.purchase_value), 0)::numeric  AS ad_purchase_value,
      COALESCE(SUM(m.impressions), 0)::bigint       AS ad_impressions,
      COALESCE(SUM(
        CASE WHEN m.frequency > 0 AND m.impressions > 0
             THEN m.frequency * m.impressions ELSE 0 END
      ), 0)::numeric                               AS ad_frequency_weighted,
      COALESCE(SUM(
        CASE WHEN m.frequency > 0 AND m.impressions > 0
             THEN m.impressions ELSE 0 END
      ), 0)::bigint                                AS ad_frequency_impressions
    FROM public.creative_daily_metrics m
    WHERE
      (p_from IS NULL OR m.date >= p_from)
      AND (p_to   IS NULL OR m.date <= p_to)
    GROUP BY m.account_id, m.ad_id
  ),
  prior_by_account AS (
    SELECT
      m.account_id,
      COALESCE(SUM(m.spend), 0)::numeric AS prior_spend
    FROM public.creative_daily_metrics m
    WHERE
      (p_prior_from IS NULL OR m.date >= p_prior_from)
      AND (p_prior_to   IS NULL OR m.date <= p_prior_to)
    GROUP BY m.account_id
  ),
  account_agg AS (
    SELECT
      ca.account_id,
      COALESCE(SUM(ca.ad_spend), 0)::numeric       AS period_spend,
      COALESCE(SUM(ca.ad_purchase_value), 0)::numeric AS period_revenue,
      COUNT(DISTINCT CASE WHEN ca.ad_spend > 0 THEN ca.ad_id ELSE NULL END)::bigint AS active_ad_count
    FROM current_by_ad ca
    GROUP BY ca.account_id
  )
  SELECT
    aa.account_id,
    aa.period_spend,
    aa.period_revenue,
    aa.active_ad_count,
    COALESCE(pa.prior_spend, 0)::numeric AS prior_spend,
    ca.ad_id,
    cr.ad_name,
    cr.thumbnail_url,
    ca.ad_spend,
    ca.ad_purchase_value,
    ca.ad_impressions,
    ca.ad_frequency_weighted,
    ca.ad_frequency_impressions
  FROM account_agg aa
  JOIN current_by_ad ca ON ca.account_id = aa.account_id
  LEFT JOIN public.creatives cr ON cr.ad_id = ca.ad_id AND cr.account_id = ca.account_id
  LEFT JOIN prior_by_account pa ON pa.account_id = aa.account_id
  ORDER BY aa.account_id, ca.ad_id;
END;
$$;

-- ── C6. briefs: stop world-readable share policy ────────────────────────────
-- The old policy `USING (share_token IS NOT NULL)` had no TO clause and matched
-- essentially every row (share_token defaults to a non-null uuid on insert), so
-- every brief was readable by anon + all roles. Replace with an explicit opt-in
-- flag defaulting false; existing rows become non-shared. A by-token public
-- share path must go through a service_role edge function.
ALTER TABLE public.briefs
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "Public can view shared briefs by token" ON public.briefs;
CREATE POLICY "Public can view briefs explicitly marked shared"
  ON public.briefs FOR SELECT
  USING (is_shared IS TRUE);

-- ── H-DB1. inspiration_items: stop financial snapshot leaking cross-tenant ──
-- The table now carries performance_snapshot (spend/roas/cpa/retention) and
-- source_account_id. A global `using (true)` SELECT let any client read every
-- tenant's saved-creative financials. Scope reads to agency staff (the actual
-- vault users) plus the user who saved each item. BEHAVIOR CHANGE: external
-- `client`-role users no longer see the full global library — only items they
-- saved. Adjust here if the vault is meant to be client-visible.
DROP POLICY IF EXISTS "inspiration_items_select" ON public.inspiration_items;
CREATE POLICY "inspiration_items_select" ON public.inspiration_items
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'builder')
    OR public.has_role(auth.uid(), 'employee')
    OR saved_by = auth.uid()
  );

-- ── H-DB2. performance_changelog: scope reads by account ────────────────────
DROP POLICY IF EXISTS "Auth users can view changelog" ON public.performance_changelog;
CREATE POLICY "Staff or account members can view changelog"
  ON public.performance_changelog FOR SELECT
  USING (
    public.has_role(auth.uid(), 'builder')
    OR public.has_role(auth.uid(), 'employee')
    OR account_id IN (SELECT public.get_user_account_ids(auth.uid()))
  );
