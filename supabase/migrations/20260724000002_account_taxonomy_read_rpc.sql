-- =============================================================================
-- US-002: Per-account taxonomy read path — ONE SECURITY DEFINER RPC that is the
-- single source of truth for an account's governed Theme/Persona list
-- (angle_clusters, reused per US-001 as the combined Theme/Persona dimension) and
-- its creative-type activation state (the global creative_type_menu joined with
-- the account's account_creative_types activation). React (via the account-taxonomy
-- edge fn), the external `api` edge fn, and verdanote-read-mcp all call THIS RPC,
-- so every surface reads identical values.
-- =============================================================================
-- ONE additive, idempotent FORWARD migration. Applied MANUALLY via
-- `supabase db push --linked` (CI does NOT run migrations — see MIGRATIONS.md);
-- this file ships schema only, no deploy. Safe to re-run: the two ADD COLUMNs are
-- IF NOT EXISTS, the function is CREATE OR REPLACE, and the grants are idempotent.
-- No DROP COLUMN, no rewrite of any existing column — metadata-only nullable adds.
--
-- Numbering: 20260724000002 follows the local + remote ledger frontier
-- (…20260724000001_creative_matrix_taxonomy, US-001). Does NOT reuse, edit, or
-- repair any prior number. All referenced objects (public.angle_clusters,
-- public.creative_type_menu, public.account_creative_types) exist by this point.
--
-- IDOR posture (mirrors 20260530210000_revoke_authenticated_hook_angle_rpc): the
-- RPC is SECURITY DEFINER and TRUSTS its p_account_id argument (it bypasses RLS),
-- so authenticated/PUBLIC EXECUTE is withheld — only service_role may call it. The
-- sanctioned callers are the edge functions, which verify the caller's session JWT
-- (or API key) and enforce account ownership BEFORE invoking with the service role.
-- =============================================================================

-- ─── 1. angle_clusters: additive governance columns for the Theme/Persona list ─
-- angle_clusters (20260530110000) had no archive/status columns. US-002 governs
-- the list, so add (nullable, additive) the two the read RPC surfaces:
--   • archived_at  — soft-archive timestamp. NULL = live; NOT NULL = archived.
--                    Archive never hard-deletes a row (matrix/tagging keep the id).
--   • test_status  — optional per-account test lifecycle label for a Theme/Persona
--                    (e.g. 'untested' | 'testing' | 'validated'); free text, no
--                    CHECK, so the vocabulary stays extensible per account.
ALTER TABLE public.angle_clusters ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.angle_clusters ADD COLUMN IF NOT EXISTS test_status text;

COMMENT ON COLUMN public.angle_clusters.archived_at IS
  'US-002: soft-archive timestamp for the Theme/Persona list. NULL = live, NOT '
  'NULL = archived. Archive is a soft toggle — rows are never hard-deleted so the '
  'matrix/tagging references (creatives.angle_id) stay intact.';
COMMENT ON COLUMN public.angle_clusters.test_status IS
  'US-002: optional per-account test lifecycle label for a Theme/Persona angle '
  '(free text, e.g. untested/testing/validated). No CHECK — extensible per account.';

-- Partial index so the common "live list" read (archived_at IS NULL) stays cheap.
CREATE INDEX IF NOT EXISTS angle_clusters_account_live_idx
  ON public.angle_clusters (account_id)
  WHERE archived_at IS NULL;

-- ─── 2. rpc_account_taxonomy — the SINGLE read path ───────────────────────────
-- Returns ONE jsonb object so every consumer (React edge fn / api / MCP) gets a
-- byte-identical shape from one call:
--   {
--     "account_id": "<id>",
--     "themes": [ { id, label, theme, summary, origin, test_status,
--                   archived, archived_at, score, created_at }, ... ],
--     "creative_types": [ { creative_type_id, lane, type_name, menu_sort_order,
--                           active, activation_id, account_sort_order }, ... ]
--   }
-- "origin" surfaces angle_clusters.source (US-001 provenance: review-mining rows
-- carry 'csv'/'csv:<batch>'; manual entries carry 'manual'). Every column is table-
-- qualified (per verdanote-rpc-returns-table-qualify-ambiguous-columns) even though
-- a scalar jsonb return has no RETURNS TABLE OUT-param shadowing.
CREATE OR REPLACE FUNCTION public.rpc_account_taxonomy(p_account_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'account_id', p_account_id,
    -- Theme/Persona list (angle_clusters). Live rows first, then by score, newest.
    'themes', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          ac.id,
          'label',       ac.label,
          'theme',       ac.theme,
          'summary',     ac.summary,
          'origin',      ac.source,
          'test_status', ac.test_status,
          'archived',    (ac.archived_at IS NOT NULL),
          'archived_at', ac.archived_at,
          'score',       ac.score,
          'created_at',  ac.created_at
        )
        ORDER BY (ac.archived_at IS NOT NULL) ASC,
                 ac.score DESC NULLS LAST,
                 ac.created_at DESC
      )
      FROM public.angle_clusters ac
      WHERE ac.account_id = p_account_id
    ), '[]'::jsonb),
    -- Creative-type activation: the GLOBAL house menu LEFT JOINed with this
    -- account's activation rows. Every menu type appears; active reflects the
    -- account row (false when never activated). Ordered by lane then menu order.
    'creative_types', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'creative_type_id',   ctm.id,
          'lane',               ctm.lane,
          'type_name',          ctm.type_name,
          'menu_sort_order',    ctm.sort_order,
          'active',             COALESCE(act.active, false),
          'activation_id',      act.id,
          'account_sort_order', act.sort_order
        )
        ORDER BY ctm.lane ASC, ctm.sort_order ASC, ctm.type_name ASC
      )
      FROM public.creative_type_menu ctm
      LEFT JOIN public.account_creative_types act
        ON act.creative_type_id = ctm.id
       AND act.account_id = p_account_id
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.rpc_account_taxonomy(text) IS
  'US-002: single read path for an account''s governed taxonomy — Theme/Persona '
  'list (angle_clusters) + creative-type activation (creative_type_menu ⨝ '
  'account_creative_types). SECURITY DEFINER, trusts p_account_id; EXECUTE is '
  'service_role-only (edge functions gate account ownership first).';

-- ─── 3. Grants — service_role ONLY (close the cross-account IDOR) ─────────────
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default; revoke it and grant only
-- to service_role, mirroring 20260530210000's posture for the trusted-arg RPCs.
REVOKE ALL     ON FUNCTION public.rpc_account_taxonomy(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_account_taxonomy(text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.rpc_account_taxonomy(text) TO   service_role;

-- ── Verify (run manually after push) ─────────────────────────────────────────
--   SELECT public.rpc_account_taxonomy('<account_id>');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='angle_clusters'
--      AND column_name IN ('archived_at','test_status');
