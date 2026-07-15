-- F6 (Performance-classification service) + Feature 4 (Creative Library data RPC).
--
-- PLACEHOLDER migration number 20260716000001 — the orchestrator renumbers this
-- to the next free slot and runs `supabase db push`. See MIGRATIONS.md.
--
-- Two SECURITY DEFINER RPCs over public.creative_daily_metrics (the 365d daily
-- grain) + public.creatives:
--
--   1. get_creative_classification(account, from, to)
--        Per-ad window roll-up PLUS a recent-vs-prior split (equal halves of the
--        window) so the shared F6 classifier (_shared/creative-classification.ts)
--        can label each ad Winner / Rising / Fatiguing. Aggregation is the SAME
--        summable-base + derived-ratio contract as US-003/US-005
--        (get_creative_window_aggregates): base metrics are SUMMED, ratios are
--        DERIVED from those sums (never averaged) so they reconcile with spend.
--
--   2. get_creative_library(account, from, to)
--        The Creative Library page's single query: every LIVE creative
--        (ad_status='ACTIVE') for the account joined to its window performance +
--        the recent/prior trend split + media/durability fields, so the page
--        renders playable cards with performance and the client can classify +
--        filter without N round-trips.
--
-- SECURITY (mirrors migration 20260530210000 + the leaderboard edge fn): both
-- RPCs are SECURITY DEFINER and TRUST their p_account_id argument, so a logged-in
-- user could otherwise read ANY account's data (cross-account IDOR). We therefore
-- REVOKE EXECUTE from `authenticated` and grant ONLY `service_role`. The
-- sanctioned caller is the session-authed `creative-library` edge function, which
-- verifies the JWT + enforces per-account ownership before invoking with the
-- service-role client (identical pattern to leaderboard / rpc_hook_angle_*).
--
-- Idempotent: CREATE OR REPLACE; re-applying is a safe no-op reconcilable with
-- `supabase db push`. Additive: reads existing columns only, creates no tables.
-- Window guard mirrors get_creative_window_aggregates (<= 365 days).
--
-- No new function DIRECTORY is added by THIS migration (the edge functions are
-- separate files registered in config.toml / deploy-functions.sh); this file is
-- DB RPCs only.

-- ── 1. Classification aggregates ───────────────────────────────────────────
-- Returns, per ad in the window: full-window summable base + derived ratios,
-- and the SAME derived ratios computed over the RECENT half and the PRIOR half
-- of the window (split at the window midpoint) for trend detection. The classer
-- turns these into a label; SQL stays rules-free (one source of truth for
-- thresholds lives in TypeScript, testable under deno test).
CREATE OR REPLACE FUNCTION public.get_creative_classification(
  p_account_id text,
  p_from       date,
  p_to         date
)
RETURNS TABLE (
  ad_id            text,
  spend            numeric,
  roas             numeric,
  cpa              numeric,
  ctr              numeric,
  thumb_stop_rate  numeric,
  purchases        bigint,
  frequency        numeric,
  recent_spend     numeric,
  prior_spend      numeric,
  recent_roas      numeric,
  prior_roas       numeric,
  recent_ctr       numeric,
  prior_ctr        numeric,
  recent_cpa       numeric,
  prior_cpa        numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mid date;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'get_creative_classification: p_account_id is required';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'get_creative_classification: p_from and p_to are required';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'get_creative_classification: p_to (%) is before p_from (%)', p_to, p_from;
  END IF;
  IF (p_to - p_from) > 365 THEN
    RAISE EXCEPTION 'get_creative_classification: window (% days) exceeds RETENTION_DAYS=365', (p_to - p_from);
  END IF;

  -- Split point: the recent half is [mid, to], the prior half is [from, mid).
  v_mid := p_from + ((p_to - p_from) / 2);

  RETURN QUERY
  WITH win AS (
    SELECT
      m.ad_id,
      COALESCE(SUM(m.spend), 0)::numeric          AS spend,
      COALESCE(SUM(m.impressions), 0)::bigint     AS impressions,
      COALESCE(SUM(m.clicks), 0)::bigint          AS clicks,
      COALESCE(SUM(m.purchases), 0)::bigint        AS purchases,
      COALESCE(SUM(m.purchase_value), 0)::numeric AS purchase_value,
      COALESCE(SUM(m.video_views), 0)::bigint     AS video_views,
      COALESCE(SUM(m.frequency * m.impressions), 0)::numeric AS freq_weighted
    FROM public.creative_daily_metrics m
    WHERE m.account_id = p_account_id AND m.date >= p_from AND m.date <= p_to
    GROUP BY m.ad_id
  ),
  recent AS (
    SELECT
      m.ad_id,
      COALESCE(SUM(m.spend), 0)::numeric          AS spend,
      COALESCE(SUM(m.impressions), 0)::bigint     AS impressions,
      COALESCE(SUM(m.clicks), 0)::bigint          AS clicks,
      COALESCE(SUM(m.purchases), 0)::bigint        AS purchases,
      COALESCE(SUM(m.purchase_value), 0)::numeric AS purchase_value
    FROM public.creative_daily_metrics m
    WHERE m.account_id = p_account_id AND m.date >= v_mid AND m.date <= p_to
    GROUP BY m.ad_id
  ),
  prior AS (
    SELECT
      m.ad_id,
      COALESCE(SUM(m.spend), 0)::numeric          AS spend,
      COALESCE(SUM(m.impressions), 0)::bigint     AS impressions,
      COALESCE(SUM(m.clicks), 0)::bigint          AS clicks,
      COALESCE(SUM(m.purchases), 0)::bigint        AS purchases,
      COALESCE(SUM(m.purchase_value), 0)::numeric AS purchase_value
    FROM public.creative_daily_metrics m
    WHERE m.account_id = p_account_id AND m.date >= p_from AND m.date < v_mid
    GROUP BY m.ad_id
  )
  SELECT
    w.ad_id,
    w.spend,
    (CASE WHEN w.spend > 0 THEN w.purchase_value / w.spend ELSE 0 END)::numeric        AS roas,
    (CASE WHEN w.purchases > 0 THEN w.spend / w.purchases ELSE 0 END)::numeric         AS cpa,
    (CASE WHEN w.impressions > 0 THEN (w.clicks::numeric / w.impressions) * 100 ELSE 0 END)::numeric AS ctr,
    (CASE WHEN w.impressions > 0 AND w.video_views > 0
      THEN (w.video_views::numeric / w.impressions) * 100 ELSE 0 END)::numeric         AS thumb_stop_rate,
    w.purchases,
    (CASE WHEN w.impressions > 0 THEN w.freq_weighted / w.impressions ELSE 0 END)::numeric AS frequency,
    -- Recent half
    COALESCE(r.spend, 0)::numeric                                                       AS recent_spend,
    COALESCE(p.spend, 0)::numeric                                                       AS prior_spend,
    (CASE WHEN COALESCE(r.spend,0) > 0 THEN r.purchase_value / r.spend ELSE 0 END)::numeric      AS recent_roas,
    (CASE WHEN COALESCE(p.spend,0) > 0 THEN p.purchase_value / p.spend ELSE 0 END)::numeric      AS prior_roas,
    (CASE WHEN COALESCE(r.impressions,0) > 0 THEN (r.clicks::numeric / r.impressions) * 100 ELSE 0 END)::numeric AS recent_ctr,
    (CASE WHEN COALESCE(p.impressions,0) > 0 THEN (p.clicks::numeric / p.impressions) * 100 ELSE 0 END)::numeric AS prior_ctr,
    (CASE WHEN COALESCE(r.purchases,0) > 0 THEN r.spend / r.purchases ELSE 0 END)::numeric       AS recent_cpa,
    (CASE WHEN COALESCE(p.purchases,0) > 0 THEN p.spend / p.purchases ELSE 0 END)::numeric       AS prior_cpa
  FROM win w
  LEFT JOIN recent r ON r.ad_id = w.ad_id
  LEFT JOIN prior  p ON p.ad_id = w.ad_id
  ORDER BY w.spend DESC;
END;
$$;

COMMENT ON FUNCTION public.get_creative_classification(text, date, date) IS
  'F6: per-ad window roll-up + recent/prior split over creative_daily_metrics for the shared Winner/Rising/Fatiguing classifier (_shared/creative-classification.ts). Summable base summed, ratios derived (never averaged); frequency APPROXIMATE (impression-weighted). SECURITY DEFINER, trusts p_account_id — authenticated EXECUTE revoked; only the session-authed creative-library edge fn (verifies JWT + account ownership) calls it via service_role.';

-- ── 2. Creative Library page query ─────────────────────────────────────────
-- Every LIVE creative for the account, joined to its window performance and the
-- recent/prior trend split + media + durability. One query powers the whole
-- Library grid (cards + performance + client-side F6 filter/sort).
CREATE OR REPLACE FUNCTION public.get_creative_library(
  p_account_id text,
  p_from       date,
  p_to         date
)
RETURNS TABLE (
  ad_id            text,
  account_id       text,
  ad_name          text,
  unique_code      text,
  platform         text,
  ad_status        text,
  hook             text,
  theme            text,
  product          text,
  tag_source       text,
  thumbnail_url    text,
  full_res_url     text,
  video_url        text,
  preview_url      text,
  landing_page_url text,
  created_time     timestamptz,
  first_seen       timestamptz,
  version          integer,
  video_views      bigint,
  -- Durability (F3): does this creative have a durably-archived media copy?
  archived         boolean,
  archive_id       uuid,
  in_vault         boolean,
  -- Window performance (derived, reconciles with spend)
  spend            numeric,
  roas             numeric,
  cpa              numeric,
  ctr              numeric,
  thumb_stop_rate  numeric,
  hold_rate        numeric,
  purchases        bigint,
  frequency        numeric,
  -- Recent/prior split for the F6 classifier
  recent_spend     numeric,
  prior_spend      numeric,
  recent_roas      numeric,
  prior_roas       numeric,
  recent_ctr       numeric,
  prior_ctr        numeric,
  recent_cpa       numeric,
  prior_cpa        numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'get_creative_library: p_account_id is required';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'get_creative_library: p_from and p_to are required';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'get_creative_library: p_to (%) is before p_from (%)', p_to, p_from;
  END IF;
  IF (p_to - p_from) > 365 THEN
    RAISE EXCEPTION 'get_creative_library: window (% days) exceeds RETENTION_DAYS=365', (p_to - p_from);
  END IF;

  RETURN QUERY
  WITH cls AS (
    SELECT * FROM public.get_creative_classification(p_account_id, p_from, p_to)
  ),
  agg_holds AS (
    -- hold_rate is view-weighted from the daily grain (same as US-005).
    SELECT
      m.ad_id,
      COALESCE(SUM(m.video_views), 0)::bigint AS video_views,
      COALESCE(SUM(
        CASE WHEN m.hold_rate IS NOT NULL AND m.video_views IS NOT NULL
          THEN (m.hold_rate / 100.0) * m.video_views ELSE 0 END
      ), 0)::numeric AS thruplays
    FROM public.creative_daily_metrics m
    WHERE m.account_id = p_account_id AND m.date >= p_from AND m.date <= p_to
    GROUP BY m.ad_id
  )
  SELECT
    c.ad_id,
    c.account_id,
    c.ad_name,
    c.unique_code,
    c.platform,
    c.ad_status,
    c.hook,
    c.theme,
    c.product,
    c.tag_source,
    c.thumbnail_url,
    c.full_res_url,
    c.video_url,
    c.preview_url,
    c.landing_page_url,
    c.created_time,
    c.created_at AS first_seen,
    COALESCE(c.version, 1) AS version,
    COALESCE(h.video_views, 0)::bigint AS video_views,
    (arc.id IS NOT NULL) AS archived,
    arc.id AS archive_id,
    (vi.id IS NOT NULL) AS in_vault,
    COALESCE(cl.spend, 0)::numeric           AS spend,
    COALESCE(cl.roas, 0)::numeric            AS roas,
    COALESCE(cl.cpa, 0)::numeric             AS cpa,
    COALESCE(cl.ctr, 0)::numeric             AS ctr,
    COALESCE(cl.thumb_stop_rate, 0)::numeric AS thumb_stop_rate,
    (CASE WHEN COALESCE(h.video_views,0) > 0 AND h.thruplays > 0
      THEN (h.thruplays / h.video_views) * 100 ELSE 0 END)::numeric AS hold_rate,
    COALESCE(cl.purchases, 0)::bigint        AS purchases,
    COALESCE(cl.frequency, 0)::numeric       AS frequency,
    COALESCE(cl.recent_spend, 0)::numeric    AS recent_spend,
    COALESCE(cl.prior_spend, 0)::numeric     AS prior_spend,
    COALESCE(cl.recent_roas, 0)::numeric     AS recent_roas,
    COALESCE(cl.prior_roas, 0)::numeric      AS prior_roas,
    COALESCE(cl.recent_ctr, 0)::numeric      AS recent_ctr,
    COALESCE(cl.prior_ctr, 0)::numeric       AS prior_ctr,
    COALESCE(cl.recent_cpa, 0)::numeric      AS recent_cpa,
    COALESCE(cl.prior_cpa, 0)::numeric       AS prior_cpa
  FROM public.creatives c
  LEFT JOIN cls cl        ON cl.ad_id = c.ad_id
  LEFT JOIN agg_holds h   ON h.ad_id = c.ad_id
  -- Durability: is there a KEPT (durable) media_archive row for this creative?
  LEFT JOIN LATERAL (
    SELECT a.id FROM public.media_archive a
    WHERE a.account_id = c.account_id AND a.ad_id = c.ad_id AND a.retention = 'keep'
    LIMIT 1
  ) arc ON true
  -- Vault presence: already saved into the global vault (dedupe by source_ad_id).
  LEFT JOIN LATERAL (
    SELECT ii.id FROM public.inspiration_items ii
    WHERE ii.source_ad_id = c.ad_id
    LIMIT 1
  ) vi ON true
  WHERE c.account_id = p_account_id
    AND c.ad_status = 'ACTIVE'
  ORDER BY COALESCE(cl.spend, 0) DESC;
END;
$$;

COMMENT ON FUNCTION public.get_creative_library(text, date, date) IS
  'Feature 4 (Creative Library): every LIVE (ad_status=ACTIVE) creative for the account joined to window performance + recent/prior trend split + media + durability (media_archive) + vault presence. One query powers the Library grid. SECURITY DEFINER, trusts p_account_id — authenticated EXECUTE revoked; only the session-authed creative-library edge fn calls it via service_role.';

-- ── Grants (tenant-boundary hardening) ─────────────────────────────────────
-- Both RPCs trust p_account_id, so a raw `authenticated` EXECUTE would be a
-- cross-account IDOR. Revoke it; the session-authed edge fn (service_role)
-- is the ONLY sanctioned caller. REVOKE from PUBLIC too (defensive).
REVOKE EXECUTE ON FUNCTION public.get_creative_classification(text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_creative_classification(text, date, date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_creative_classification(text, date, date) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_creative_library(text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_creative_library(text, date, date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_creative_library(text, date, date) TO service_role;

-- ── Verify ────────────────────────────────────────────────────────────────
--   SELECT count(*) FROM public.get_creative_library('<acct>', now()::date - 30, now()::date);
--   SELECT has_function_privilege('authenticated','public.get_creative_library(text,date,date)','EXECUTE'); -- expect false
--   SELECT has_function_privilege('service_role','public.get_creative_library(text,date,date)','EXECUTE');  -- expect true
