-- Client wall, database functions.
--
-- 60 SECURITY DEFINER functions in `public` were executable by `anon` (anyone holding
-- the public key in the browser bundle) or `authenticated` (any signed-in client),
-- through the default PUBLIC grant or through explicit grants. Several returned another
-- account's data with no check inside (rpc_creative_matrix, rpc_entity_report,
-- get_media_coverage), and the write and queue functions (bulk_update_*, claim_*,
-- snapshot_*) had no check at all.
--
-- Rule after this migration:
--   * Every SECURITY DEFINER function in `public` is executable by service_role only
--     (the edge functions and pg_cron use it), unless it is in one of the three lists below.
--   * Nothing is executable through the PUBLIC pseudo-role.
--   * A function created later is still executable by PUBLIC until revoked (PostgreSQL's
--     built-in default; a schema-level ALTER DEFAULT PRIVILEGES cannot remove it, and the
--     global form also changes functions created by extension installs). The pgTAP test
--     supabase/tests/security_definer_grants_test.sql is the gate: it fails CI when a new
--     SECURITY DEFINER function is executable by anon or authenticated and has no entry in
--     its allow-list. A new function needs its own REVOKE ... FROM PUBLIC, anon, authenticated
--     (and GRANT ... TO service_role) in the migration that creates it.
--
-- Production migrations are applied by hand (see supabase/migrations/MIGRATIONS.md).

DO $$
DECLARE
  -- Called from the browser with supabase.rpc (src/), and each one checks the caller inside:
  --   get_agency_dashboard_summary, get_period_metrics, get_daily_trends and
  --   get_creative_window_aggregates gate on staff role or account membership;
  --   create_api_key stores the key against auth.uid();
  --   get_user_role is the caller's own role lookup.
  -- Used inside row rules (policies), which run as the caller, so the caller needs EXECUTE:
  --   has_role, get_user_role, get_user_account_ids, owns_ad_library_ad,
  --   owns_ad_library_board, vault_owns_board, vault_visible_item_ids.
  -- Called through a user-token client by an edge function (vault-search): match_items,
  --   which reads only rows from vault_visible_item_ids() (the caller's own items).
  signed_in_ok constant text[] := ARRAY[
    'create_api_key', 'get_agency_dashboard_summary', 'get_creative_window_aggregates',
    'get_daily_trends', 'get_period_metrics', 'get_user_role', 'has_role',
    'get_user_account_ids', 'owns_ad_library_ad', 'owns_ad_library_board',
    'vault_owns_board', 'vault_visible_item_ids', 'match_items'
  ];
  -- Staff area functions (migrations 20261101000002, 05 and 06). The staff pages call these
  -- from the browser. Each one refuses callers who are not builder or employee
  -- (has_role(auth.uid(), ...) at the top of the body; supabase/tests/security_definer_grants_test.sql
  -- fails if one loses that check). Never executable by anon.
  staff_area_ok constant text[] := ARRAY[
    'app_user_role_mapping', 'apply_actor_approval_votes', 'apply_approval_votes',
    'approve_actor_application', 'approve_application', 'archive_crew_member',
    'cast_actor_onto_shoot', 'claim_ad_code', 'confirm_actor_for_shoot',
    'create_call_sheet', 'create_client', 'create_crew_member', 'create_location',
    'create_prop', 'create_shoot', 'create_shoot_schedule_block',
    'create_studio_shipment', 'delete_location', 'delete_prop', 'delete_shoot',
    'delete_shoot_schedule_block', 'delete_studio_shipment', 'peek_ad_code',
    'reject_actor_application', 'reject_application', 'revoke_call_sheet',
    'set_actor_shoot_schedule', 'set_client_active', 'set_client_details',
    'set_client_scope', 'set_client_verdanote_account_id',
    'set_creator_assignment_delivery', 'set_location_capacity',
    'set_location_entry_instructions', 'set_prop_at_studio', 'set_prop_client_supplied',
    'set_prop_return_status', 'set_studio_shipment_delivered',
    'set_studio_shipment_notes', 'unconfirm_actor_from_shoot', 'update_call_sheet',
    'update_client', 'update_crew_member', 'update_location', 'update_prop',
    'update_shoot', 'update_shoot_schedule_block', 'update_studio_shipment'
  ];
  -- Also used by row rules that apply to signed-out visitors (public Ad Library boards).
  -- They return a yes/no for one id.
  anon_ok constant text[] := ARRAY['board_is_public', 'ad_is_on_public_board'];
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    IF f.proname = ANY (signed_in_ok) OR f.proname = ANY (staff_area_ok) OR f.proname = ANY (anon_ok) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
    IF f.proname = ANY (anon_ok) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', f.sig);
    END IF;
  END LOOP;
END $$;
