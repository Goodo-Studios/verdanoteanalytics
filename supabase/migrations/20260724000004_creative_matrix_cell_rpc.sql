-- =============================================================================
-- US-008: Creative-matrix CELL drill-down read path — ONE SECURITY DEFINER RPC
-- (public.rpc_creative_matrix_cell) that opens a single Theme/Persona ×
-- creative-type cell of rpc_creative_matrix (US-006) into its INNER hook × body
-- grid, plus the atomic ads behind each inner combo.
--
--   Outer cell  = (creatives.angle_id, creatives.creative_type)   ← US-006
--   Inner grid  = (creatives.hook, creatives.body)                ← THIS RPC
--   Atomic ad   = one public.creatives row (ad_name + playable media + state)
--
-- React (via its `matrix` edge fn), the external `api` edge fn, and
-- verdanote-read-mcp all call THIS RPC for the drill-down, so every surface
-- consumes byte-identical values — exactly the US-006 posture.
-- =============================================================================
-- ONE additive, idempotent FORWARD migration. Applied MANUALLY via
-- `supabase db push --linked` (CI does NOT run migrations — see MIGRATIONS.md);
-- this file ships schema only, no deploy. Safe to re-run: the function is
-- CREATE OR REPLACE, the index is IF NOT EXISTS, and the grants are idempotent.
-- NO table rewrites, NO DROP COLUMN.
--
-- Numbering: 20260724000004 follows the local + remote ledger frontier
-- (…20260724000003_creative_matrix_crosstab_rpc, US-006). Does NOT reuse, edit,
-- or repair any prior number. All referenced objects — public.creatives with
-- angle_id / creative_type / body / hook / ad_name / ad_status / thumbnail_url /
-- preview_url / video_url, public.angle_clusters, public.creative_daily_metrics
-- — exist by this point in migration history.
--
-- ── Cell scoping (unambiguous, mirrors US-006 normalization) ─────────────────
-- The drill-down always targets exactly ONE outer cell, and the outer board
-- always emits explicit untagged buckets on both axes, so:
--   • p_angle_id NULL      ⇒ the untagged Theme/Persona bucket (cr.angle_id IS NULL)
--   • p_angle_id non-NULL  ⇒ cr.angle_id = p_angle_id
--   • p_creative_type NULL ⇒ the untagged creative-type bucket
--                            (NULLIF(btrim(cr.creative_type),'') IS NULL)
--   • p_creative_type set  ⇒ NULLIF(btrim(cr.creative_type),'') = p_creative_type
-- Type normalization (NULLIF(btrim(...),'')) is byte-identical to US-006 so the
-- inner grid reconciles with the outer cell it came from.
--
-- ── Aggregation contract (identical to US-006 / rollup_creatives_from_daily) ─
-- Aggregates the DAILY grain (public.creative_daily_metrics ⨝ public.creatives).
-- SUMMABLE bases (spend, impressions, clicks, purchases, purchase_value) are
-- summed; RATIOS are DERIVED from those sums — NEVER averaged — every division
-- zero-guarded: roas = value/spend, cpa = spend/purchases,
-- ctr = clicks/impressions*100, cpm = spend/impressions*1000. Per the rollup
-- convention result_count = summed purchases and cost_per_result = cpa (no
-- objective-specific result columns at the daily grain). p_date_from /
-- p_date_to NULL ⇒ all-time; when set they filter dm.date >= / <= inclusively.
--
-- ── SPEND RANKING (HARD POLICY: verdanote-winners-decided-by-spend-first) ────
-- Inner cells are RANKED by SUM(spend) DESC ONLY. spend_rank is RANK() over the
-- inner cells by total_spend DESC with cells untagged on EITHER inner axis last.
-- The hook / body axes order spend DESC, untagged last. Atomic ads order spend
-- DESC. roas/cpa/ctr/cpm are context only and MUST NOT influence ordering.
--
-- ── UNTAGGED (explicit inner buckets on BOTH axes, never hidden) ─────────────
-- hook NULL/'' (after btrim) ⇒ untagged hook bucket; body NULL/'' ⇒ untagged
-- body bucket. Both are flagged is_untagged_hook / is_untagged_body and labeled
-- 'Untagged' client-side. Satisfies the US-008 AC "untagged hooks and bodies are
-- surfaced explicitly rather than hidden."
--
-- ── RETURN SHAPE (RETURNS jsonb, house style = rpc_creative_matrix) ──────────
--   {
--     "account_id","angle_id","creative_type","date_from","date_to",
--     "angle_label","test_status",          -- outer-cell Theme/Persona context
--     "hooks":  [ { hook, is_untagged, total_spend } … spend DESC, untagged last ],
--     "bodies": [ { body, is_untagged, total_spend } … spend DESC, untagged last ],
--     "cells":  [ { hook, body, is_untagged_hook, is_untagged_body, total_spend,
--                   n_ads, roas, cpa, ctr, cpm, purchases, total_purchase_value,
--                   result_count, cost_per_result, spend_rank } …
--                 untagged-last then total_spend DESC ],
--     "ads":    [ { ad_id, ad_name, ad_status, thumbnail_url, preview_url,
--                   video_url, hook, body, is_untagged_hook, is_untagged_body,
--                   total_spend, roas, cpa, ctr, cpm, purchases,
--                   total_purchase_value, result_count, cost_per_result } …
--                 spend DESC ]
--   }
-- The "ads" rows are the atomic units the inner-cell click opens: the client
-- filters ads to the selected (hook, body) inner cell and shows the ad's
-- Theme/Persona (angle_label above) + creative type (creative_type above) +
-- hook + body + spend + objective metric + state (ad_status) + thumbnail/preview.
--
-- ── IDOR posture (mirrors US-006 §IDOR exactly) ──────────────────────────────
-- SECURITY DEFINER + SET search_path = '' + STABLE. TRUSTS its p_account_id
-- argument (bypasses RLS), so PUBLIC/authenticated EXECUTE is withheld —
-- service_role ONLY. The sanctioned callers are the edge functions, which
-- verify the caller's session JWT (or API key) and enforce account ownership
-- BEFORE invoking with the service role.
--
-- HARD POLICY (verdanote-rpc-returns-table-qualify-ambiguous-columns): every
-- table is aliased and every column reference fully qualified below.
-- =============================================================================

-- ─── 1. Supporting index for the account-scoped inner group-by ───────────────
-- The scoped filter is (account_id, angle_id, creative_type) then GROUP BY
-- (hook, body); a composite (account_id, hook, body) index serves the inner
-- aggregation (mirrors idx_creatives_account_hook, 20260529100000).
CREATE INDEX IF NOT EXISTS idx_creatives_account_hook_body
  ON public.creatives (account_id, hook, body);

-- ─── 2. rpc_creative_matrix_cell — the inner hook×body + atomic-ad read path ─
CREATE OR REPLACE FUNCTION public.rpc_creative_matrix_cell(
  p_account_id    text,
  p_angle_id      uuid DEFAULT NULL,
  p_creative_type text DEFAULT NULL,
  p_date_from     date DEFAULT NULL,
  p_date_to       date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_type text := NULLIF(btrim(p_creative_type), '');  -- normalize like US-006
  v_result jsonb;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'rpc_creative_matrix_cell: p_account_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH
  -- Daily grain scoped to the account/window AND to the ONE outer cell
  -- (angle bucket × type bucket), joined to creatives for the inner dimensions
  -- and the atomic-ad display columns. Inner normalization happens ONCE here:
  --   hook bucket = NULLIF(btrim(cr.hook), '') (NULL/'' ⇒ untagged hook);
  --   body bucket = NULLIF(btrim(cr.body), '') (NULL/'' ⇒ untagged body).
  scoped AS (
    SELECT
      cr.ad_id                                     AS ad_id,
      cr.ad_name                                   AS ad_name,
      cr.ad_status                                 AS ad_status,
      cr.thumbnail_url                             AS thumbnail_url,
      cr.preview_url                               AS preview_url,
      cr.video_url                                 AS video_url,
      NULLIF(btrim(cr.hook), '')                   AS hook,
      NULLIF(btrim(cr.body), '')                   AS body,
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
      AND ( (p_angle_id IS NULL AND cr.angle_id IS NULL)
            OR cr.angle_id = p_angle_id )
      AND ( (v_type IS NULL AND NULLIF(btrim(cr.creative_type), '') IS NULL)
            OR NULLIF(btrim(cr.creative_type), '') = v_type )
      AND (p_date_from IS NULL OR dm.date >= p_date_from)
      AND (p_date_to   IS NULL OR dm.date <= p_date_to)
  ),
  -- One row per (hook, body) inner cell: summed bases + distinct-ad count.
  cells AS (
    SELECT
      s.hook                                       AS hook,
      s.body                                       AS body,
      (s.hook IS NULL)                             AS is_untagged_hook,
      (s.body IS NULL)                             AS is_untagged_body,
      COALESCE(SUM(s.spend), 0)::numeric           AS total_spend,
      COUNT(DISTINCT s.ad_id)::bigint              AS n_ads,
      COALESCE(SUM(s.impressions), 0)::bigint      AS impressions,
      COALESCE(SUM(s.clicks), 0)::bigint           AS clicks,
      COALESCE(SUM(s.purchases), 0)::bigint        AS purchases,
      COALESCE(SUM(s.purchase_value), 0)::numeric  AS total_purchase_value
    FROM scoped s
    GROUP BY s.hook, s.body
  ),
  -- Inner cells + spend_rank. RANK() is PURE spend: untagged-on-either-inner-
  -- axis last, then total_spend DESC. Nothing else enters the ORDER BY.
  ranked_cells AS (
    SELECT
      ce.hook, ce.body, ce.is_untagged_hook, ce.is_untagged_body,
      ce.total_spend, ce.n_ads, ce.impressions, ce.clicks, ce.purchases,
      ce.total_purchase_value,
      RANK() OVER (
        ORDER BY (ce.is_untagged_hook OR ce.is_untagged_body) ASC,
                 ce.total_spend DESC
      )                                            AS spend_rank
    FROM cells ce
  ),
  -- Hook axis: hooks with ≥1 ad in scope (incl. the untagged bucket).
  hook_axis AS (
    SELECT s.hook AS hook, COALESCE(SUM(s.spend), 0)::numeric AS total_spend
    FROM scoped s
    GROUP BY s.hook
  ),
  -- Body axis: bodies with ≥1 ad in scope (incl. the untagged bucket).
  body_axis AS (
    SELECT s.body AS body, COALESCE(SUM(s.spend), 0)::numeric AS total_spend
    FROM scoped s
    GROUP BY s.body
  ),
  -- Atomic ads: one row per ad in the cell (summed bases per ad_id + its
  -- display columns), spend DESC.
  ad_rows AS (
    SELECT
      s.ad_id,
      MAX(s.ad_name)        AS ad_name,
      MAX(s.ad_status)      AS ad_status,
      MAX(s.thumbnail_url)  AS thumbnail_url,
      MAX(s.preview_url)    AS preview_url,
      MAX(s.video_url)      AS video_url,
      -- hook/body are constant within an ad_id (per-creative tags), so MIN picks
      -- the single value; the bucketing flags come from that value.
      MIN(s.hook)           AS hook,
      MIN(s.body)           AS body,
      COALESCE(SUM(s.spend), 0)::numeric          AS total_spend,
      COALESCE(SUM(s.impressions), 0)::bigint     AS impressions,
      COALESCE(SUM(s.clicks), 0)::bigint          AS clicks,
      COALESCE(SUM(s.purchases), 0)::bigint       AS purchases,
      COALESCE(SUM(s.purchase_value), 0)::numeric AS total_purchase_value
    FROM scoped s
    GROUP BY s.ad_id
  )
  SELECT jsonb_build_object(
    'account_id',    p_account_id,
    'angle_id',      p_angle_id,
    'creative_type', v_type,
    'date_from',     p_date_from,
    'date_to',       p_date_to,
    -- Outer-cell Theme/Persona context (constant across the inner grid).
    'angle_label',   CASE WHEN p_angle_id IS NULL THEN 'Untagged' ELSE acl.label END,
    'test_status',   acl.test_status,
    -- ── Hook axis: spend DESC, untagged last ────────────────────────────────
    'hooks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'hook',        hx.hook,
          'is_untagged', (hx.hook IS NULL),
          'total_spend', hx.total_spend
        )
        ORDER BY (hx.hook IS NULL) ASC, hx.total_spend DESC
      )
      FROM hook_axis hx
    ), '[]'::jsonb),
    -- ── Body axis: spend DESC, untagged last ────────────────────────────────
    'bodies', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'body',        bx.body,
          'is_untagged', (bx.body IS NULL),
          'total_spend', bx.total_spend
        )
        ORDER BY (bx.body IS NULL) ASC, bx.total_spend DESC
      )
      FROM body_axis bx
    ), '[]'::jsonb),
    -- ── Inner cells: untagged-last then total_spend DESC (matches spend_rank) ─
    'cells', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'hook',                 rc.hook,
          'body',                 rc.body,
          'is_untagged_hook',     rc.is_untagged_hook,
          'is_untagged_body',     rc.is_untagged_body,
          'total_spend',          rc.total_spend,
          'n_ads',                rc.n_ads,
          'roas', CASE WHEN rc.total_spend > 0
                       THEN rc.total_purchase_value / rc.total_spend ELSE 0 END,
          'cpa',  CASE WHEN rc.purchases > 0
                       THEN rc.total_spend / rc.purchases ELSE 0 END,
          'ctr',  CASE WHEN rc.impressions > 0
                       THEN (rc.clicks::numeric / rc.impressions) * 100 ELSE 0 END,
          'cpm',  CASE WHEN rc.impressions > 0
                       THEN (rc.total_spend / rc.impressions) * 1000 ELSE 0 END,
          'purchases',            rc.purchases,
          'total_purchase_value', rc.total_purchase_value,
          'result_count',         rc.purchases,
          'cost_per_result', CASE WHEN rc.purchases > 0
                                  THEN rc.total_spend / rc.purchases ELSE 0 END,
          'spend_rank',           rc.spend_rank
        )
        ORDER BY (rc.is_untagged_hook OR rc.is_untagged_body) ASC,
                 rc.total_spend DESC
      )
      FROM ranked_cells rc
    ), '[]'::jsonb),
    -- ── Atomic ads: spend DESC ───────────────────────────────────────────────
    'ads', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'ad_id',                ar.ad_id,
          'ad_name',              ar.ad_name,
          'ad_status',            ar.ad_status,
          'thumbnail_url',        ar.thumbnail_url,
          'preview_url',          ar.preview_url,
          'video_url',            ar.video_url,
          'hook',                 ar.hook,
          'body',                 ar.body,
          'is_untagged_hook',     (ar.hook IS NULL),
          'is_untagged_body',     (ar.body IS NULL),
          'total_spend',          ar.total_spend,
          'roas', CASE WHEN ar.total_spend > 0
                       THEN ar.total_purchase_value / ar.total_spend ELSE 0 END,
          'cpa',  CASE WHEN ar.purchases > 0
                       THEN ar.total_spend / ar.purchases ELSE 0 END,
          'ctr',  CASE WHEN ar.impressions > 0
                       THEN (ar.clicks::numeric / ar.impressions) * 100 ELSE 0 END,
          'cpm',  CASE WHEN ar.impressions > 0
                       THEN (ar.total_spend / ar.impressions) * 1000 ELSE 0 END,
          'purchases',            ar.purchases,
          'total_purchase_value', ar.total_purchase_value,
          'result_count',         ar.purchases,
          'cost_per_result', CASE WHEN ar.purchases > 0
                                  THEN ar.total_spend / ar.purchases ELSE 0 END
        )
        ORDER BY ar.total_spend DESC
      )
      FROM ad_rows ar
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM (SELECT 1) AS _one
  LEFT JOIN public.angle_clusters acl
    ON acl.id = p_angle_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.rpc_creative_matrix_cell(text, uuid, text, date, date) IS
  'US-008: creative-matrix CELL drill-down — opens ONE outer cell '
  '(creatives.angle_id × creatives.creative_type) into its inner hook × body '
  'grid plus the atomic ads behind each combo. Aggregated from '
  'creative_daily_metrics (summed bases, derived ratios; result_count=purchases, '
  'cost_per_result=cpa per the rollup convention). Inner cells ranked by '
  'SUM(spend) DESC only (spend-first policy), untagged-on-either-inner-axis '
  'last; explicit Untagged hook/body buckets; carries outer angle_label + '
  'test_status. NULL p_angle_id / p_creative_type select the untagged outer '
  'bucket. Returns one jsonb object {account_id, angle_id, creative_type, '
  'date_from, date_to, angle_label, test_status, hooks, bodies, cells, ads}. '
  'SECURITY DEFINER, trusts p_account_id; EXECUTE is service_role-only (edge '
  'functions gate account ownership first).';

-- ─── 3. Grants — service_role ONLY (close the cross-account IDOR) ────────────
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default; revoke it and grant only
-- to service_role, mirroring 20260724000003 §3 exactly.
REVOKE ALL     ON FUNCTION public.rpc_creative_matrix_cell(text, uuid, text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_creative_matrix_cell(text, uuid, text, date, date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.rpc_creative_matrix_cell(text, uuid, text, date, date) TO   service_role;

-- ── Verify (run manually after push) ─────────────────────────────────────────
--   -- Drill into a tagged cell:
--   SELECT jsonb_pretty(public.rpc_creative_matrix_cell('<account_id>',
--            '<angle_uuid>'::uuid, 'UGC'));
--   -- Drill into the fully-untagged outer bucket:
--   SELECT jsonb_pretty(public.rpc_creative_matrix_cell('<account_id>',
--            NULL, NULL));
--   -- Inner spend_rank must be pure spend order (untagged inner axes last):
--   SELECT cell->>'spend_rank', cell->>'total_spend',
--          cell->>'is_untagged_hook', cell->>'is_untagged_body'
--     FROM jsonb_array_elements(
--            public.rpc_creative_matrix_cell('<account_id>',
--              '<angle_uuid>'::uuid, 'UGC')->'cells') AS cell;
