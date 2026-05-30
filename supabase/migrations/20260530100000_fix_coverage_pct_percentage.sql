-- PRD2 / US-005 (coverage honesty): rpc_hook_angle_coverage returned
-- tag_coverage_pct as a 0..1 RATIO, but the field is named *_pct and every
-- consumer (api / MCP / React) treats it as a percentage. The React surface
-- rendered Math.round(0.573) = 1% when true coverage was 57%. That is a
-- dishonest coverage number on the surface users actually read.
--
-- FIX: redefine the canonical coverage RPC so tag_coverage_pct is a true
-- percentage in [0, 100], rounded to 2 decimals. Because all three surfaces
-- consume this single SQL source of truth unchanged, fixing it here corrects
-- api, MCP, and React simultaneously — no per-surface math, no drift.
--
-- Pure CREATE OR REPLACE; signature and every other column are unchanged, so
-- this is additive and non-destructive.

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
    -- True percentage in [0, 100], rounded to 2dp. Honest on every surface.
    CASE WHEN t.total_spend > 0
         THEN round((t.tagged_spend / t.total_spend) * 100, 2)
         ELSE 0::numeric
    END AS tag_coverage_pct
  FROM totals t;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_hook_angle_coverage(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_hook_angle_coverage(text, text) TO service_role;
