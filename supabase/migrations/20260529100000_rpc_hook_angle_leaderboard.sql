-- PRD2 / US-001: Spend-ranked hook/angle leaderboard over an account's own creatives.
--
-- Aggregates EXISTING tags on public.creatives (PRD1 made creatives.hook /
-- creatives.theme the authoritative tags). This RPC does NOT extract or compute
-- any new AI tags — it only rolls up already-tagged spend.
--
-- Modeled on public.get_agency_dashboard_summary (20260518000003): a single
-- SECURITY DEFINER plpgsql GROUP BY aggregate with SET search_path = '' and
-- explicit account_id scoping consistent with existing creatives reads / RLS.
--
-- DIMENSION: p_dimension selects the tag column to group by:
--   'hook'  -> public.creatives.hook
--   'theme' -> public.creatives.theme   (theme == angle in product language)
-- Any other value raises a clear exception.
--
-- SPEND RANKING (decision log: "the more spend on the ad, the better the ad"):
--   Ordering is PURE SUM(spend) DESC. avg_roas / avg_ctr / n_ads are reported
--   for context but MUST NOT influence ordering, and they do not.
--
-- UNTAGGED: rows whose chosen tag column IS NULL or '' (after trim) are NOT
--   dropped — they are collapsed into a single explicit row labeled 'Untagged'
--   and flagged with is_untagged = true so callers render it separately. The
--   untagged row is sorted last regardless of its spend.
--
-- COVERAGE SHAPE DECISION:
--   Coverage metrics (tagged_spend / untagged_spend / tag_coverage_pct) are
--   exposed as a SEPARATE companion RPC rpc_hook_angle_coverage(...) returning a
--   single row. Rationale: keeping the leaderboard rows homogeneous (every row
--   is one tag bucket) lets the api / MCP / React surfaces consume the leaderboard
--   as a plain array, while coverage is a scalar header object — one fetch each,
--   no per-row coverage duplication, and identical shapes across all three
--   surfaces. The 'Untagged' leaderboard row already carries untagged spend, so
--   callers can also derive coverage from the rows if they prefer; the companion
--   RPC is the canonical, indexed-once source.
--
-- avg_roas / avg_ctr are spend-weighted averages (SUM(metric*spend)/SUM(spend))
-- so a $10k ad and a $5 ad don't count equally — consistent with the spend-first
-- philosophy. Falls back to a plain AVG when bucket spend is 0.

-- ---------------------------------------------------------------------------
-- Supporting indexes so the GROUP BY is indexed at agency scale (AC #7).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_creatives_account_hook
  ON public.creatives (account_id, hook);
CREATE INDEX IF NOT EXISTS idx_creatives_account_theme
  ON public.creatives (account_id, theme);

-- ---------------------------------------------------------------------------
-- Leaderboard RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_hook_angle_leaderboard(
  p_account_id text,
  p_dimension  text DEFAULT 'hook',
  p_limit      int  DEFAULT 100
)
RETURNS TABLE (
  label                text,
  is_untagged          boolean,
  total_spend          numeric,
  n_ads                bigint,
  avg_roas             numeric,
  avg_ctr              numeric,
  total_purchase_value numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_dimension NOT IN ('hook', 'theme') THEN
    RAISE EXCEPTION
      'rpc_hook_angle_leaderboard: invalid p_dimension %, expected ''hook'' or ''theme''',
      p_dimension
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  WITH tagged AS (
    SELECT
      c.account_id,
      -- normalize the chosen tag column to a canonical bucket key.
      -- empty / whitespace-only tags collapse into the NULL (untagged) bucket.
      NULLIF(
        btrim(
          CASE p_dimension
            WHEN 'hook'  THEN c.hook
            WHEN 'theme' THEN c.theme
          END
        ),
        ''
      ) AS bucket,
      c.spend,
      c.roas,
      c.ctr,
      c.purchase_value
    FROM public.creatives c
    WHERE c.account_id = p_account_id
  ),
  agg AS (
    SELECT
      t.bucket,
      (t.bucket IS NULL)                                AS is_untagged,
      COALESCE(SUM(t.spend), 0)::numeric                AS total_spend,
      COUNT(*)::bigint                                  AS n_ads,
      -- spend-weighted averages; fall back to plain AVG when no spend.
      CASE WHEN COALESCE(SUM(t.spend), 0) > 0
           THEN SUM(COALESCE(t.roas, 0) * COALESCE(t.spend, 0)) / SUM(t.spend)
           ELSE COALESCE(AVG(t.roas), 0)
      END::numeric                                      AS avg_roas,
      CASE WHEN COALESCE(SUM(t.spend), 0) > 0
           THEN SUM(COALESCE(t.ctr, 0) * COALESCE(t.spend, 0)) / SUM(t.spend)
           ELSE COALESCE(AVG(t.ctr), 0)
      END::numeric                                      AS avg_ctr,
      COALESCE(SUM(t.purchase_value), 0)::numeric       AS total_purchase_value
    FROM tagged t
    GROUP BY t.bucket
  )
  SELECT
    CASE WHEN a.is_untagged THEN 'Untagged' ELSE a.bucket END AS label,
    a.is_untagged,
    a.total_spend,
    a.n_ads,
    a.avg_roas,
    a.avg_ctr,
    a.total_purchase_value
  FROM agg a
  -- PURE spend ranking. is_untagged sorts last so the untagged bucket never
  -- crowds the top of the board regardless of its spend.
  ORDER BY a.is_untagged ASC, a.total_spend DESC
  LIMIT GREATEST(p_limit, 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- Companion coverage RPC (single row) — canonical coverage source (AC #5).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_hook_angle_coverage(
  p_account_id text,
  p_dimension  text DEFAULT 'hook'
)
RETURNS TABLE (
  total_spend     numeric,
  tagged_spend    numeric,
  untagged_spend  numeric,
  tag_coverage_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_dimension NOT IN ('hook', 'theme') THEN
    RAISE EXCEPTION
      'rpc_hook_angle_coverage: invalid p_dimension %, expected ''hook'' or ''theme''',
      p_dimension
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  WITH tagged AS (
    SELECT
      NULLIF(
        btrim(
          CASE p_dimension
            WHEN 'hook'  THEN c.hook
            WHEN 'theme' THEN c.theme
          END
        ),
        ''
      ) AS bucket,
      COALESCE(c.spend, 0) AS spend
    FROM public.creatives c
    WHERE c.account_id = p_account_id
  ),
  totals AS (
    SELECT
      COALESCE(SUM(spend), 0)::numeric                                          AS total_spend,
      COALESCE(SUM(spend) FILTER (WHERE bucket IS NOT NULL), 0)::numeric        AS tagged_spend,
      COALESCE(SUM(spend) FILTER (WHERE bucket IS NULL), 0)::numeric            AS untagged_spend
    FROM tagged
  )
  SELECT
    t.total_spend,
    t.tagged_spend,
    t.untagged_spend,
    CASE WHEN t.total_spend > 0
         THEN (t.tagged_spend / t.total_spend)::numeric
         ELSE 0::numeric
    END AS tag_coverage_pct
  FROM totals t;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants — mirror get_agency_dashboard_summary (authenticated + service_role).
-- account_id scoping inside the function keeps reads consistent with existing
-- creatives RLS even though SECURITY DEFINER bypasses row policies.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.rpc_hook_angle_leaderboard(text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_hook_angle_leaderboard(text, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_hook_angle_coverage(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_hook_angle_coverage(text, text) TO service_role;
