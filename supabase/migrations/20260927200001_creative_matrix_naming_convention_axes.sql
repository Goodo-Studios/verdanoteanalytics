-- =============================================================================
-- Creative Matrix follows the Goodo ad naming convention (2026-09-27).
--
--   Rows    = the 4 Creative Types (creatives.style), FIXED order:
--             UGC Native, Studio Clean, Text Forward, Lifestyle,
--             then one "Other / untagged" row (creative_type NULL) for ads whose
--             style is NULL/'' or a value outside the 4 (legacy / retired).
--   Columns = Theme (creatives.theme, plain free text, exact btrim'd value),
--             spend DESC, one explicit untagged column (theme NULL) last.
--   Drill   = inside one (creative type, theme) cell, ads split by the EXACT
--             stored hook text (creatives.hook). No body axis, no clustering.
--
-- The 90-type creative_type menu, account_creative_types activation,
-- creative_lane, body and the angle_id -> angle_clusters join are RETIRED from
-- the board. Nothing is dropped: tables, columns and data stay as they are.
--
-- What this migration does (all CREATE OR REPLACE / additive, idempotent):
--   1. public.matrix_creative_type_bucket(text) — IMMUTABLE helper that maps a
--      stored creatives.style to one of the 4 display values, or NULL (Other).
--      Legacy aliases: 'UGC' -> 'UGC Native', 'Studio' -> 'Studio Clean'; name
--      tokens (UGCNative / StudioClean / TextForward) are accepted too.
--   2. CREATE OR REPLACE public.rpc_creative_matrix(text, date, date) — SAME
--      name + signature (so GET /api/matrix and the `matrix` edge fn keep
--      calling it unchanged); only the grouping keys and the returned axis
--      arrays change.
--   3. NEW public.rpc_creative_matrix_theme_cell(text, text, text, date, date)
--      — the (creative type, theme) cell drill-down split by hook. The old
--      public.rpc_creative_matrix_cell(text, uuid, text, date, date) (angle ×
--      creative_type -> hook × body) is left in place untouched, so anything
--      still calling it keeps working; the in-app `matrix` edge fn moves to the
--      new function. A new name (not an overload) avoids PostgREST overload
--      ambiguity (PGRST203) between the uuid and text second arguments.
--
-- Unchanged on purpose (copied verbatim from 20260724000003 / 20260724000004):
--   • the DAILY-grain aggregation (creative_daily_metrics ⨝ creatives on
--     ad_id + account_id), summed bases, DERIVED zero-guarded ratios
--     (roas = value/spend, cpa = spend/purchases, ctr = clicks/impr*100,
--     cpm = spend/impr*1000), result_count = purchases, cost_per_result = cpa;
--   • p_date_from / p_date_to NULL => all-time, else inclusive dm.date filter;
--   • spend-first ranking (verdanote-winners-decided-by-spend-first): RANK()
--     by total_spend DESC with untagged-on-either-axis last; no ratio metric in
--     any ORDER BY;
--   • IDOR posture: SECURITY DEFINER + SET search_path = '' + STABLE, trusts
--     p_account_id, EXECUTE revoked from PUBLIC + authenticated, granted to
--     service_role only (the edge fns gate JWT + account ownership first).
--
-- HARD POLICY (verdanote-rpc-returns-table-qualify-ambiguous-columns): every
-- table is aliased and every column reference fully qualified below.
--
-- Applied MANUALLY (`supabase db push --linked`; CI does not run migrations).
-- NO DROP, NO table rewrite, NO data change, NO backfill.
-- =============================================================================

-- ─── 1. Creative Type bucket helper ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.matrix_creative_type_bucket(p_style text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE lower(regexp_replace(COALESCE(p_style, ''), '[\s_-]+', '', 'g'))
    WHEN 'ugcnative'    THEN 'UGC Native'
    WHEN 'ugc'          THEN 'UGC Native'
    WHEN 'studioclean'  THEN 'Studio Clean'
    WHEN 'studio'       THEN 'Studio Clean'
    WHEN 'textforward'  THEN 'Text Forward'
    WHEN 'lifestyle'    THEN 'Lifestyle'
    ELSE NULL
  END
$$;

COMMENT ON FUNCTION public.matrix_creative_type_bucket(text) IS
  'Creative Matrix row bucket for creatives.style: one of UGC Native / Studio '
  'Clean / Text Forward / Lifestyle (legacy aliases UGC, Studio; name tokens '
  'UGCNative, StudioClean, TextForward accepted), else NULL = the Other / '
  'untagged row. Pure; no table access.';

-- ─── 2. rpc_creative_matrix — Creative Type rows × Theme columns ─────────────
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
  --   type bucket  = matrix_creative_type_bucket(style) (NULL ⇒ Other/untagged);
  --   theme bucket = NULLIF(btrim(theme), '')           (NULL ⇒ untagged theme).
  scoped AS (
    SELECT
      public.matrix_creative_type_bucket(cr.style) AS creative_type,
      NULLIF(btrim(cr.theme), '')                  AS theme,
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
  -- One row per (creative type, theme) cell: summed bases + distinct-ad count.
  cells AS (
    SELECT
      s.creative_type                              AS creative_type,
      s.theme                                      AS theme,
      (s.creative_type IS NULL)                    AS is_other_type,
      (s.theme IS NULL)                            AS is_untagged_theme,
      COALESCE(SUM(s.spend), 0)::numeric           AS total_spend,
      COUNT(DISTINCT s.ad_id)::bigint              AS n_ads,
      COALESCE(SUM(s.impressions), 0)::bigint      AS impressions,
      COALESCE(SUM(s.clicks), 0)::bigint           AS clicks,
      COALESCE(SUM(s.purchases), 0)::bigint        AS purchases,
      COALESCE(SUM(s.purchase_value), 0)::numeric  AS total_purchase_value
    FROM scoped s
    GROUP BY s.creative_type, s.theme
  ),
  -- Cells + spend_rank. RANK() is PURE spend: other/untagged-on-either-axis
  -- last, then total_spend DESC. Nothing else enters the ORDER BY.
  ranked_cells AS (
    SELECT
      ce.creative_type, ce.theme, ce.is_other_type, ce.is_untagged_theme,
      ce.total_spend, ce.n_ads, ce.impressions, ce.clicks, ce.purchases,
      ce.total_purchase_value,
      RANK() OVER (
        ORDER BY (ce.is_other_type OR ce.is_untagged_theme) ASC,
                 ce.total_spend DESC
      )                                            AS spend_rank
    FROM cells ce
  ),
  -- Creative Type axis: the 4 fixed types ALWAYS (zero-spend rows render), in
  -- fixed order, then the Other / untagged row only when it has ads in scope.
  type_fixed AS (
    SELECT v.creative_type, v.sort_order
    FROM (VALUES
      ('UGC Native'::text,   1),
      ('Studio Clean'::text, 2),
      ('Text Forward'::text, 3),
      ('Lifestyle'::text,    4)
    ) AS v(creative_type, sort_order)
  ),
  type_data AS (
    SELECT
      ce.creative_type                             AS creative_type,
      COALESCE(SUM(ce.total_spend), 0)::numeric    AS total_spend,
      COALESCE(SUM(ce.n_ads), 0)::bigint           AS n_ads
    FROM cells ce
    GROUP BY ce.creative_type
  ),
  type_axis AS (
    SELECT
      tf.creative_type                             AS creative_type,
      false                                        AS is_other,
      tf.sort_order                                AS sort_order,
      COALESCE(td.total_spend, 0)::numeric         AS total_spend,
      COALESCE(td.n_ads, 0)::bigint                AS n_ads
    FROM type_fixed tf
    LEFT JOIN type_data td
      ON td.creative_type = tf.creative_type
    UNION ALL
    SELECT
      NULL::text                                   AS creative_type,
      true                                         AS is_other,
      5                                            AS sort_order,
      td.total_spend                               AS total_spend,
      td.n_ads                                     AS n_ads
    FROM type_data td
    WHERE td.creative_type IS NULL
  ),
  -- Theme axis: data-driven (distinct non-null themes with ≥1 ad in scope,
  -- plus the untagged bucket when present).
  theme_axis AS (
    SELECT
      ce.theme                                     AS theme,
      COALESCE(SUM(ce.total_spend), 0)::numeric    AS total_spend,
      COALESCE(SUM(ce.n_ads), 0)::bigint           AS n_ads
    FROM cells ce
    GROUP BY ce.theme
  )
  SELECT jsonb_build_object(
    'account_id', p_account_id,
    'date_from',  p_date_from,
    'date_to',    p_date_to,
    -- ── Creative Type rows: fixed order, Other / untagged last ──────────────
    'creative_types', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'creative_type', tx.creative_type,
          'is_other',      tx.is_other,
          'total_spend',   tx.total_spend,
          'n_ads',         tx.n_ads
        )
        ORDER BY tx.sort_order ASC
      )
      FROM type_axis tx
    ), '[]'::jsonb),
    -- ── Theme columns: spend DESC, untagged last ────────────────────────────
    'themes', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'theme',       thx.theme,
          'is_untagged', (thx.theme IS NULL),
          'total_spend', thx.total_spend,
          'n_ads',       thx.n_ads
        )
        ORDER BY (thx.theme IS NULL) ASC, thx.total_spend DESC, thx.theme ASC
      )
      FROM theme_axis thx
    ), '[]'::jsonb),
    -- ── Cells: other/untagged-last then total_spend DESC (matches spend_rank)
    'cells', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'creative_type',        rc.creative_type,
          'is_other_type',        rc.is_other_type,
          'theme',                rc.theme,
          'is_untagged_theme',    rc.is_untagged_theme,
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
          'result_count',         rc.purchases,
          'cost_per_result', CASE WHEN rc.purchases > 0
                                  THEN rc.total_spend / rc.purchases
                                  ELSE 0 END,
          'spend_rank',           rc.spend_rank
        )
        ORDER BY (rc.is_other_type OR rc.is_untagged_theme) ASC,
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
  'Creative Matrix cross-tab (naming convention, 2026-09-27): rows = the 4 '
  'Creative Types from creatives.style in fixed order (UGC Native, Studio '
  'Clean, Text Forward, Lifestyle) + an Other / untagged row (creative_type '
  'NULL) for null/legacy styles; columns = creatives.theme (exact text, spend '
  'DESC, untagged NULL last). Aggregated from creative_daily_metrics (summed '
  'bases, derived ratios; result_count=purchases, cost_per_result=cpa). Cells '
  'ranked by SUM(spend) DESC only, other/untagged-on-either-axis last. Returns '
  '{account_id, date_from, date_to, creative_types, themes, cells}. SECURITY '
  'DEFINER, trusts p_account_id; EXECUTE is service_role-only.';

REVOKE ALL     ON FUNCTION public.rpc_creative_matrix(text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_creative_matrix(text, date, date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.rpc_creative_matrix(text, date, date) TO   service_role;

-- ─── 3. rpc_creative_matrix_theme_cell — one cell split by exact hook ────────
CREATE OR REPLACE FUNCTION public.rpc_creative_matrix_theme_cell(
  p_account_id    text,
  p_creative_type text DEFAULT NULL,
  p_theme         text DEFAULT NULL,
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
  -- Normalize the selectors exactly like rpc_creative_matrix so the drill-down
  -- reconciles with the outer cell it came from. NULL type ⇒ the Other /
  -- untagged row; NULL theme ⇒ the untagged theme column.
  v_type  text := public.matrix_creative_type_bucket(p_creative_type);
  v_theme text := NULLIF(btrim(p_theme), '');
  v_result jsonb;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'rpc_creative_matrix_theme_cell: p_account_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH
  scoped AS (
    SELECT
      cr.ad_id                                     AS ad_id,
      cr.ad_name                                   AS ad_name,
      cr.ad_status                                 AS ad_status,
      cr.thumbnail_url                             AS thumbnail_url,
      cr.preview_url                               AS preview_url,
      cr.video_url                                 AS video_url,
      NULLIF(btrim(cr.hook), '')                   AS hook,
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
      AND ( (v_type IS NULL AND public.matrix_creative_type_bucket(cr.style) IS NULL)
            OR public.matrix_creative_type_bucket(cr.style) = v_type )
      AND ( (v_theme IS NULL AND NULLIF(btrim(cr.theme), '') IS NULL)
            OR NULLIF(btrim(cr.theme), '') = v_theme )
      AND (p_date_from IS NULL OR dm.date >= p_date_from)
      AND (p_date_to   IS NULL OR dm.date <= p_date_to)
  ),
  -- One row per exact hook: summed bases + distinct-ad count.
  hook_rows AS (
    SELECT
      s.hook                                       AS hook,
      (s.hook IS NULL)                             AS is_untagged,
      COALESCE(SUM(s.spend), 0)::numeric           AS total_spend,
      COUNT(DISTINCT s.ad_id)::bigint              AS n_ads,
      COALESCE(SUM(s.impressions), 0)::bigint      AS impressions,
      COALESCE(SUM(s.clicks), 0)::bigint           AS clicks,
      COALESCE(SUM(s.purchases), 0)::bigint        AS purchases,
      COALESCE(SUM(s.purchase_value), 0)::numeric  AS total_purchase_value
    FROM scoped s
    GROUP BY s.hook
  ),
  -- RANK() is PURE spend: untagged hook last, then total_spend DESC.
  ranked_hooks AS (
    SELECT
      hr.hook, hr.is_untagged, hr.total_spend, hr.n_ads, hr.impressions,
      hr.clicks, hr.purchases, hr.total_purchase_value,
      RANK() OVER (
        ORDER BY hr.is_untagged ASC,
                 hr.total_spend DESC
      )                                            AS spend_rank
    FROM hook_rows hr
  ),
  -- Atomic ads: one row per ad in the cell, spend DESC.
  ad_rows AS (
    SELECT
      s.ad_id,
      MAX(s.ad_name)        AS ad_name,
      MAX(s.ad_status)      AS ad_status,
      MAX(s.thumbnail_url)  AS thumbnail_url,
      MAX(s.preview_url)    AS preview_url,
      MAX(s.video_url)      AS video_url,
      -- hook is constant within an ad_id (per-creative tag), so MIN picks it.
      MIN(s.hook)           AS hook,
      COALESCE(SUM(s.spend), 0)::numeric          AS total_spend,
      COALESCE(SUM(s.impressions), 0)::bigint     AS impressions,
      COALESCE(SUM(s.clicks), 0)::bigint          AS clicks,
      COALESCE(SUM(s.purchases), 0)::bigint       AS purchases,
      COALESCE(SUM(s.purchase_value), 0)::numeric AS total_purchase_value
    FROM scoped s
    GROUP BY s.ad_id
  )
  SELECT jsonb_build_object(
    'account_id',        p_account_id,
    'creative_type',     v_type,
    'is_other_type',     (v_type IS NULL),
    'theme',             v_theme,
    'is_untagged_theme', (v_theme IS NULL),
    'date_from',         p_date_from,
    'date_to',           p_date_to,
    -- ── Hooks: untagged last, then spend DESC (matches spend_rank) ──────────
    'hooks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'hook',                 rh.hook,
          'is_untagged',          rh.is_untagged,
          'total_spend',          rh.total_spend,
          'n_ads',                rh.n_ads,
          'roas', CASE WHEN rh.total_spend > 0
                       THEN rh.total_purchase_value / rh.total_spend ELSE 0 END,
          'cpa',  CASE WHEN rh.purchases > 0
                       THEN rh.total_spend / rh.purchases ELSE 0 END,
          'ctr',  CASE WHEN rh.impressions > 0
                       THEN (rh.clicks::numeric / rh.impressions) * 100 ELSE 0 END,
          'cpm',  CASE WHEN rh.impressions > 0
                       THEN (rh.total_spend / rh.impressions) * 1000 ELSE 0 END,
          'purchases',            rh.purchases,
          'total_purchase_value', rh.total_purchase_value,
          'result_count',         rh.purchases,
          'cost_per_result', CASE WHEN rh.purchases > 0
                                  THEN rh.total_spend / rh.purchases ELSE 0 END,
          'spend_rank',           rh.spend_rank
        )
        ORDER BY rh.is_untagged ASC, rh.total_spend DESC
      )
      FROM ranked_hooks rh
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
          'is_untagged_hook',     (ar.hook IS NULL),
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
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.rpc_creative_matrix_theme_cell(text, text, text, date, date) IS
  'Creative Matrix cell drill-down (naming convention, 2026-09-27): opens ONE '
  '(Creative Type = creatives.style bucket, Theme = creatives.theme) cell of '
  'rpc_creative_matrix and splits its ads by the EXACT stored creatives.hook '
  'text, plus the atomic ads. NULL p_creative_type = the Other / untagged row; '
  'NULL p_theme = the untagged theme column. Summed bases, derived ratios, '
  'spend-first ranking (untagged hook last). Returns {account_id, '
  'creative_type, is_other_type, theme, is_untagged_theme, date_from, date_to, '
  'hooks, ads}. SECURITY DEFINER, trusts p_account_id; EXECUTE is '
  'service_role-only.';

REVOKE ALL     ON FUNCTION public.rpc_creative_matrix_theme_cell(text, text, text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_creative_matrix_theme_cell(text, text, text, date, date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.rpc_creative_matrix_theme_cell(text, text, text, date, date) TO   service_role;

-- ── Verify (run manually after push) ─────────────────────────────────────────
--   SELECT public.matrix_creative_type_bucket('UGC');          -- 'UGC Native'
--   SELECT public.matrix_creative_type_bucket('Carousel');     -- NULL (Other)
--   SELECT jsonb_pretty(public.rpc_creative_matrix('<account_id>'));
--   SELECT jsonb_pretty(public.rpc_creative_matrix_theme_cell('<account_id>',
--            'UGC Native', '<theme text>'));
--   SELECT has_function_privilege('authenticated',
--     'public.rpc_creative_matrix_theme_cell(text,text,text,date,date)','EXECUTE'); -- false
