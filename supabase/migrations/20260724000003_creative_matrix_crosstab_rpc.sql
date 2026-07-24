-- =============================================================================
-- US-006: Creative-matrix cross-tab read path — ONE SECURITY DEFINER RPC
-- (public.rpc_creative_matrix) generalizing rpc_hook_angle_leaderboard
-- (20260529100000) from a 1-D tag leaderboard to the 2-D board:
--   Theme/Persona (creatives.angle_id → public.angle_clusters, the REUSED
--   combined Theme/Persona list — US-001 owner decision, no parallel persona
--   model) × creative-type (creatives.creative_type).
-- React (via its edge fn), the external `api` edge fn, and verdanote-read-mcp
-- all call THIS RPC, so every surface consumes byte-identical values. This RPC
-- + its surface REPLACE the account-strategy-layer grid.
-- =============================================================================
-- ONE additive, idempotent FORWARD migration. Applied MANUALLY via
-- `supabase db push --linked` (CI does NOT run migrations — see MIGRATIONS.md);
-- this file ships schema only, no deploy. Safe to re-run: the function is
-- CREATE OR REPLACE, the indexes are IF NOT EXISTS, and the grants are
-- idempotent. NO table rewrites, NO DROP COLUMN.
--
-- Numbering: 20260724000003 follows the local + remote ledger frontier
-- (…20260724000002_account_taxonomy_read_rpc, US-002). Does NOT reuse, edit,
-- or repair any prior number. All referenced objects (public.creatives with
-- angle_id / creative_type from 20260724000001, public.angle_clusters with
-- test_status / archived_at from 20260724000002, public.creative_daily_metrics)
-- exist by this point in migration history.
--
-- ── Aggregation contract (mirrors rollup_creatives_from_daily, 20260714000002) ─
-- Aggregates the DAILY grain (public.creative_daily_metrics ⨝ public.creatives
-- for account scoping + dimensions). SUMMABLE base metrics (spend, impressions,
-- clicks, purchases, purchase_value) are summed per cell; RATIOS are DERIVED
-- from those sums — NEVER averaged from pre-computed ratio columns — so cell
-- ratios reconcile exactly with the summed bases:
--   roas = purchase_value / spend        cpa = spend / purchases
--   ctr  = clicks / impressions * 100    cpm = spend / impressions * 1000
-- (ctr is a true percentage at source.) Every division is zero-guarded.
-- Objective metrics: the daily grain has no objective-specific result columns,
-- so per the rollup convention result_count = summed purchases and
-- cost_per_result = cpa. The client picks ROAS/CPA vs cost_per_result via
-- objectiveConfig + ad_accounts.optimization_goal — this RPC just carries both.
-- p_date_from / p_date_to NULL ⇒ no date filter (all-time); when set they
-- filter dm.date >= / <= inclusively.
--
-- ── SPEND RANKING (HARD POLICY: verdanote-winners-decided-by-spend-first) ─────
-- Cells are RANKED by SUM(spend) DESC ONLY. spend_rank is RANK() over cells by
-- total_spend DESC with cells untagged on EITHER axis ranked after all tagged
-- cells (mirrors the leaderboard's untagged-last ordering). roas / cpa / ctr /
-- cpm are context only and MUST NOT influence ordering — and they do not.
--
-- ── UNTAGGED (explicit buckets on BOTH axes, never dropped) ──────────────────
-- angle_id IS NULL ⇒ the untagged Theme/Persona bucket; creative_type NULL or
-- '' (after btrim) ⇒ the untagged creative-type bucket. Untagged rows/columns
-- are flagged is_untagged_angle / is_untagged_type and labeled 'Untagged'.
--
-- ── RETURN SHAPE (RETURNS jsonb, house style = rpc_account_taxonomy) ─────────
--   {
--     "account_id": ..., "date_from": ..., "date_to": ...,
--     "angles":  [ { angle_id, label, test_status, archived, total_spend } …
--                  ordered spend DESC, untagged last ],
--     "creative_types": [ { creative_type, total_spend } …
--                  ordered spend DESC, untagged last ],
--     "cells":   [ { angle_id, angle_label, is_untagged_angle, test_status,
--                    creative_type, is_untagged_type, total_spend, n_ads, roas,
--                    cpa, ctr, cpm, purchases, total_purchase_value,
--                    result_count, cost_per_result, spend_rank } …
--                  ordered untagged-last then total_spend DESC ]
--   }
-- Axis arrays include their own untagged bucket entries (NULL angle_id /
-- label 'Untagged'; NULL creative_type) so the grid renders explicit untagged
-- rows/columns. Axis entries / cells appear only when at least one ad is in
-- scope, EXCEPT: every LIVE (archived_at IS NULL) angle_clusters row for the
-- account appears in "angles" even with zero ads (total_spend 0) so untested /
-- empty matrix rows still render. creative_types is data-driven only.
-- test_status / label / archived carry from public.angle_clusters (US-002);
-- untested test_status reads as NULL/empty free text.
--
-- ── IDOR posture (mirrors 20260724000002 §3) ─────────────────────────────────
-- SECURITY DEFINER + SET search_path = '' + STABLE. The RPC TRUSTS its
-- p_account_id argument (it bypasses RLS), so PUBLIC/authenticated EXECUTE is
-- withheld — service_role ONLY. The sanctioned callers are the edge functions,
-- which verify the caller's session JWT (or API key) and enforce account
-- ownership BEFORE invoking with the service role.
--
-- HARD POLICY (verdanote-rpc-returns-table-qualify-ambiguous-columns): every
-- table is aliased and every column reference fully qualified below.
-- =============================================================================

-- ─── 1. Supporting indexes so the dimension join/group-by is indexed ─────────
-- 20260724000001 shipped single-column indexes on creative_type / angle_id;
-- these composite (account_id, dim) indexes serve the account-scoped group-by
-- (same shape as idx_creatives_account_hook / _theme in 20260529100000).
CREATE INDEX IF NOT EXISTS idx_creatives_account_creative_type
  ON public.creatives (account_id, creative_type);
CREATE INDEX IF NOT EXISTS idx_creatives_account_angle_id
  ON public.creatives (account_id, angle_id);

-- ─── 2. rpc_creative_matrix — the 2-D cross-tab read path ────────────────────
CREATE OR REPLACE FUNCTION public.rpc_creative_matrix(
  p_account_id text,
  p_date_from  date DEFAULT NULL,
  p_date_to    date DEFAULT NULL
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
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'rpc_creative_matrix: p_account_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH
  -- Daily grain scoped to the account/window, joined to creatives for the two
  -- dimensions. Dimension normalization happens ONCE here:
  --   angle bucket = creatives.angle_id (NULL ⇒ untagged Theme/Persona);
  --   type bucket  = NULLIF(btrim(creative_type), '') (NULL/'' ⇒ untagged).
  scoped AS (
    SELECT
      cr.angle_id                                  AS angle_id,
      NULLIF(btrim(cr.creative_type), '')          AS creative_type,
      dm.ad_id                                     AS ad_id,
      COALESCE(dm.spend, 0)::numeric               AS spend,
      COALESCE(dm.impressions, 0)::bigint          AS impressions,
      COALESCE(dm.clicks, 0)::bigint               AS clicks,
      COALESCE(dm.purchases, 0)::bigint            AS purchases,
      COALESCE(dm.purchase_value, 0)::numeric      AS purchase_value
    FROM public.creative_daily_metrics dm
    JOIN public.creatives cr
      ON cr.ad_id = dm.ad_id
     AND cr.account_id = dm.account_id
    WHERE dm.account_id = p_account_id
      AND (p_date_from IS NULL OR dm.date >= p_date_from)
      AND (p_date_to   IS NULL OR dm.date <= p_date_to)
  ),
  -- One row per (angle, type) cell: summed bases + distinct-ad count.
  cells AS (
    SELECT
      s.angle_id                                   AS angle_id,
      s.creative_type                              AS creative_type,
      (s.angle_id IS NULL)                         AS is_untagged_angle,
      (s.creative_type IS NULL)                    AS is_untagged_type,
      COALESCE(SUM(s.spend), 0)::numeric           AS total_spend,
      COUNT(DISTINCT s.ad_id)::bigint              AS n_ads,
      COALESCE(SUM(s.impressions), 0)::bigint      AS impressions,
      COALESCE(SUM(s.clicks), 0)::bigint           AS clicks,
      COALESCE(SUM(s.purchases), 0)::bigint        AS purchases,
      COALESCE(SUM(s.purchase_value), 0)::numeric  AS total_purchase_value
    FROM scoped s
    GROUP BY s.angle_id, s.creative_type
  ),
  -- Cells + angle metadata + spend_rank. RANK() is PURE spend: untagged-on-
  -- either-axis last, then total_spend DESC. Nothing else enters the ORDER BY.
  ranked_cells AS (
    SELECT
      ce.angle_id                                  AS angle_id,
      CASE WHEN ce.is_untagged_angle THEN 'Untagged' ELSE acl.label END
                                                   AS angle_label,
      ce.is_untagged_angle                         AS is_untagged_angle,
      acl.test_status                              AS test_status,
      ce.creative_type                             AS creative_type,
      ce.is_untagged_type                          AS is_untagged_type,
      ce.total_spend                               AS total_spend,
      ce.n_ads                                     AS n_ads,
      ce.impressions                               AS impressions,
      ce.clicks                                    AS clicks,
      ce.purchases                                 AS purchases,
      ce.total_purchase_value                      AS total_purchase_value,
      RANK() OVER (
        ORDER BY (ce.is_untagged_angle OR ce.is_untagged_type) ASC,
                 ce.total_spend DESC
      )                                            AS spend_rank
    FROM cells ce
    LEFT JOIN public.angle_clusters acl
      ON acl.id = ce.angle_id
  ),
  -- Angle axis: every angle bucket with ≥1 ad in scope (data side, including
  -- the untagged bucket and archived angles that still have spend) FULL OUTER
  -- JOINed with every LIVE angle_clusters row for the account, so zero-ad live
  -- angles still render as matrix rows (total_spend 0).
  angle_data AS (
    SELECT
      ce.angle_id                                  AS angle_id,
      COALESCE(SUM(ce.total_spend), 0)::numeric    AS total_spend
    FROM cells ce
    GROUP BY ce.angle_id
  ),
  angle_axis AS (
    SELECT
      COALESCE(ad.angle_id, live.id)               AS angle_id,
      COALESCE(ad.total_spend, 0)::numeric         AS total_spend
    FROM angle_data ad
    FULL OUTER JOIN (
      SELECT acl.id AS id
      FROM public.angle_clusters acl
      WHERE acl.account_id = p_account_id
        AND acl.archived_at IS NULL
    ) live
      ON live.id = ad.angle_id
  ),
  -- Creative-type axis: data-driven only (types with ≥1 ad in scope, including
  -- the untagged bucket).
  type_axis AS (
    SELECT
      ce.creative_type                             AS creative_type,
      COALESCE(SUM(ce.total_spend), 0)::numeric    AS total_spend
    FROM cells ce
    GROUP BY ce.creative_type
  )
  SELECT jsonb_build_object(
    'account_id', p_account_id,
    'date_from',  p_date_from,
    'date_to',    p_date_to,
    -- ── Angle (Theme/Persona) axis: spend DESC, untagged last ───────────────
    'angles', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'angle_id',    ax.angle_id,
          'label',       CASE WHEN ax.angle_id IS NULL THEN 'Untagged' ELSE acl.label END,
          'test_status', acl.test_status,
          'archived',    (acl.archived_at IS NOT NULL),
          'total_spend', ax.total_spend
        )
        ORDER BY (ax.angle_id IS NULL) ASC, ax.total_spend DESC
      )
      FROM angle_axis ax
      LEFT JOIN public.angle_clusters acl
        ON acl.id = ax.angle_id
    ), '[]'::jsonb),
    -- ── Creative-type axis: spend DESC, untagged last ────────────────────────
    'creative_types', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'creative_type', tx.creative_type,
          'total_spend',   tx.total_spend
        )
        ORDER BY (tx.creative_type IS NULL) ASC, tx.total_spend DESC
      )
      FROM type_axis tx
    ), '[]'::jsonb),
    -- ── Cells: untagged-last then total_spend DESC (matches spend_rank) ─────
    'cells', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'angle_id',             rc.angle_id,
          'angle_label',          rc.angle_label,
          'is_untagged_angle',    rc.is_untagged_angle,
          'test_status',          rc.test_status,
          'creative_type',        rc.creative_type,
          'is_untagged_type',     rc.is_untagged_type,
          'total_spend',          rc.total_spend,
          'n_ads',                rc.n_ads,
          -- Derived ratios from the summed bases — never averaged; all
          -- divisions zero-guarded.
          'roas', CASE WHEN rc.total_spend > 0
                       THEN rc.total_purchase_value / rc.total_spend
                       ELSE 0 END,
          'cpa',  CASE WHEN rc.purchases > 0
                       THEN rc.total_spend / rc.purchases
                       ELSE 0 END,
          'ctr',  CASE WHEN rc.impressions > 0
                       THEN (rc.clicks::numeric / rc.impressions) * 100
                       ELSE 0 END,
          'cpm',  CASE WHEN rc.impressions > 0
                       THEN (rc.total_spend / rc.impressions) * 1000
                       ELSE 0 END,
          'purchases',            rc.purchases,
          'total_purchase_value', rc.total_purchase_value,
          -- Rollup convention (20260714000002): no objective-specific result
          -- columns at the daily grain ⇒ result_count aligns with purchases
          -- and cost_per_result with cpa. Client picks which to display.
          'result_count',         rc.purchases,
          'cost_per_result', CASE WHEN rc.purchases > 0
                                  THEN rc.total_spend / rc.purchases
                                  ELSE 0 END,
          'spend_rank',           rc.spend_rank
        )
        ORDER BY (rc.is_untagged_angle OR rc.is_untagged_type) ASC,
                 rc.total_spend DESC
      )
      FROM ranked_cells rc
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.rpc_creative_matrix(text, date, date) IS
  'US-006: 2-D creative-matrix cross-tab — Theme/Persona (creatives.angle_id → '
  'angle_clusters, the reused combined list) × creative-type '
  '(creatives.creative_type) — aggregated from creative_daily_metrics (summed '
  'bases, derived ratios; result_count=purchases, cost_per_result=cpa per the '
  'rollup convention). Cells ranked by SUM(spend) DESC only (spend-first '
  'policy), untagged-on-either-axis last; explicit Untagged buckets on both '
  'axes; every live angle_clusters row appears in the angles axis even with '
  'zero ads. Returns one jsonb object {account_id, date_from, date_to, angles, '
  'creative_types, cells}. SECURITY DEFINER, trusts p_account_id; EXECUTE is '
  'service_role-only (edge functions gate account ownership first).';

-- ─── 3. Grants — service_role ONLY (close the cross-account IDOR) ────────────
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default; revoke it and grant only
-- to service_role, mirroring 20260724000002 §3 exactly.
REVOKE ALL     ON FUNCTION public.rpc_creative_matrix(text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_creative_matrix(text, date, date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.rpc_creative_matrix(text, date, date) TO   service_role;

-- ── Verify (run manually after push) ─────────────────────────────────────────
--   SELECT jsonb_pretty(public.rpc_creative_matrix('<account_id>'));
--   SELECT jsonb_pretty(public.rpc_creative_matrix('<account_id>',
--                                                  '2026-06-01', '2026-06-30'));
--   -- spend_rank must be pure spend order (untagged last):
--   SELECT cell->>'spend_rank', cell->>'total_spend',
--          cell->>'is_untagged_angle', cell->>'is_untagged_type'
--     FROM jsonb_array_elements(
--            public.rpc_creative_matrix('<account_id>')->'cells') AS cell;
