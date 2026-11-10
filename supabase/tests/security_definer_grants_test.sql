-- Client wall, check 4: no SECURITY DEFINER function in `public` can be called by
-- anon or by a signed-in client unless it is on the allow-list below.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- A SECURITY DEFINER function runs with its owner's rights and skips row rules. If the
-- public key (anon) or any client login (authenticated) can call it, the function itself
-- must check who is asking. Before migration 20261101000020, 60 of them were open, and
-- several returned another account's data. Now only service_role (edge functions and
-- cron) can call them, apart from the names listed here.
--
-- ALLOW-LIST (the temp table below). Adding a name is a review decision: the function
-- must check the caller inside (or return only the caller's own rows), and the reason
-- goes in the comment next to the group.
--   browser      called from src/ with supabase.rpc, checks the caller inside
--                (create_api_key stores the key against auth.uid(); get_user_role is the
--                caller's own role lookup; the four get_* reports gate on staff or account)
--   row_rules    used inside policies, which run as the caller (has_role, get_user_role,
--                get_user_account_ids, get_user_client_slugs (answers only for auth.uid()),
--                owns_ad_library_*, vault_*)
--   edge_user    called by an edge function through a user-token client: match_items
--                (vault-search), which reads only vault_visible_item_ids()
--   staff_area   the staff pages' functions; each must refuse non-staff in its own body
--                (checked below: the body has has_role(auth.uid(), ...))
--   anon         row rules for public Ad Library boards, a yes/no for one id; signed-in
--                users may call these too

BEGIN;
SELECT plan(9);

CREATE TEMP TABLE allow (kind text, name text);
INSERT INTO allow VALUES
  ('browser','create_api_key'), ('browser','get_agency_dashboard_summary'),
  ('browser','get_creative_window_aggregates'), ('browser','get_daily_trends'),
  ('browser','get_period_metrics'), ('browser','get_user_role'),
  ('row_rules','has_role'), ('row_rules','get_user_account_ids'),
  ('row_rules','get_user_client_slugs'),
  ('row_rules','owns_ad_library_ad'), ('row_rules','owns_ad_library_board'),
  ('row_rules','vault_owns_board'), ('row_rules','vault_visible_item_ids'),
  ('edge_user','match_items'),
  ('anon','board_is_public'), ('anon','ad_is_on_public_board');
INSERT INTO allow
  SELECT 'staff_area', unnest(ARRAY[
    'app_user_role_mapping', 'apply_actor_approval_votes', 'apply_approval_votes',
    'approve_actor_application', 'approve_application', 'archive_crew_member',
    'cast_actor_onto_shoot', 'claim_ad_code', 'confirm_actor_for_shoot',
    'create_call_sheet', 'create_client', 'create_crew_member', 'create_location',
    'create_prop', 'create_shoot', 'create_shoot_schedule_block',
    'create_studio_shipment', 'delete_location', 'goodo_os_user_role_mapping',
    'replay_job', 'resolve_job_manually', 'delete_prop', 'delete_shoot',
    'create_knowledge_source', 'submit_knowledge_correction', 'review_knowledge_correction',
    'publish_knowledge_correction', 'rollback_knowledge_source',
    'save_engagement_template', 'create_engagement_from_template', 'record_engagement_kickoff',
    'save_engagement_closeout',
    'add_engagement_deliverable', 'add_deliverable_revision', 'record_deliverable_client_decision',
    'decide_deliverable_round_exception', 'withdraw_engagement_deliverable', 'create_approval_subject',
    'save_approval_draft', 'publish_approval_version', 'record_approval_decision',
    'deliverable_release_status', 'confirm_deliverable_revision', 'return_deliverable_to_strategist',
    'resolve_deliverable_qa_return', 'record_deliverable_signoff', 'mark_deliverable_final_ready',
    'handoff_staff_options', 'create_handoff_packet', 'acknowledge_handoff', 'reassign_handoff',
    'handoff_source_status',
    'add_agent_evaluation_sample', 'record_agent_evaluation_outcome', 'approve_agent_config',
    'create_learning_module', 'save_learning_draft', 'review_learning_version', 'publish_learning_version', 'withdraw_learning_module', 'record_learning_support_week', 'snapshot_learning_self_service',
    'request_scope_change', 'evaluate_scope_change',
    'propose_recommendation', 'decide_recommendation', 'link_recommendation_execution', 'record_recommendation_outcome', 'review_recommendation_learning', 'recommendation_ad_options',
    'create_strategy_proposal', 'revise_strategy_proposal', 'review_strategy_proposal', 'accept_strategy_proposal',
    'publish_strategy_proposal', 'published_strategy_for_engagement',
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
  ]);

-- SECURITY DEFINER functions in public (extension functions excluded).
CREATE VIEW pg_temp.defs AS
  SELECT p.oid, p.proname, p.prosrc
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'
     AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');

-- Names that `p_role` can execute and that are not on its allow-list. anon may use the
-- 'anon' group only; authenticated may use every group.
CREATE FUNCTION pg_temp.exposed(p_role text) RETURNS text AS $$
  SELECT string_agg(DISTINCT d.proname, ', ' ORDER BY d.proname)
    FROM pg_temp.defs d
   WHERE has_function_privilege(p_role, d.oid, 'EXECUTE')
     AND NOT EXISTS (
       SELECT 1 FROM pg_temp.allow a
        WHERE a.name = d.proname AND (p_role = 'authenticated' OR a.kind = 'anon'))
$$ LANGUAGE sql;

SELECT cmp_ok(
  (SELECT count(*)::int FROM pg_temp.defs),
  '>', 30,
  'found the SECURITY DEFINER functions in public (sanity: more than 30)'
);

-- The real assertions. A failure lists the function names.
SELECT is(
  pg_temp.exposed('anon'), NULL,
  'anon cannot execute any SECURITY DEFINER function in public outside the allow-list'
);
SELECT is(
  pg_temp.exposed('authenticated'), NULL,
  'authenticated cannot execute any SECURITY DEFINER function in public outside the allow-list'
);

-- Locking down must not lock out the edge functions and cron.
SELECT is(
  (SELECT string_agg(d.proname, ', ' ORDER BY d.proname) FROM pg_temp.defs d
    WHERE NOT has_function_privilege('service_role', d.oid, 'EXECUTE')),
  NULL,
  'service_role can execute every SECURITY DEFINER function in public'
);

-- A stale allow-list entry hides a rename: every name must still exist.
SELECT is(
  (SELECT string_agg(a.name, ', ' ORDER BY a.name) FROM pg_temp.allow a
    WHERE NOT EXISTS (SELECT 1 FROM pg_temp.defs d WHERE d.proname = a.name)),
  NULL,
  'every allow-list name is an existing SECURITY DEFINER function'
);

-- Staff area functions are open to every signed-in user at the grant level, so the gate
-- has to be in the body.
SELECT is(
  (SELECT string_agg(a.name, ', ' ORDER BY a.name)
     FROM pg_temp.allow a JOIN pg_temp.defs d ON d.proname = a.name
    WHERE a.kind = 'staff_area' AND d.prosrc !~* 'has_role\(\s*auth\.uid\(\)'),
  NULL,
  'every staff_area function checks has_role(auth.uid(), ...) in its body'
);

-- Self-test: the scan reports a new function for each way it can be opened.
CREATE FUNCTION public.__grant_probe_anon() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
CREATE FUNCTION public.__grant_probe_auth() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
CREATE FUNCTION public.__grant_probe_public() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
-- New functions start executable by PUBLIC, so clear that first and open each probe one way.
REVOKE ALL ON FUNCTION public.__grant_probe_anon(), public.__grant_probe_auth(), public.__grant_probe_public()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__grant_probe_anon() TO anon;
GRANT EXECUTE ON FUNCTION public.__grant_probe_auth() TO authenticated;
GRANT EXECUTE ON FUNCTION public.__grant_probe_public() TO PUBLIC;

SELECT is(
  pg_temp.exposed('anon'),
  '__grant_probe_anon, __grant_probe_public',
  'self-test: an explicit anon grant and a PUBLIC grant are both detected for anon, an authenticated-only grant is not'
);
SELECT is(
  pg_temp.exposed('authenticated'),
  '__grant_probe_auth, __grant_probe_public',
  'self-test: an explicit authenticated grant and a PUBLIC grant are both detected for authenticated, an anon-only grant is not'
);

-- Names on the allow-list are not reported.
INSERT INTO allow VALUES ('browser','__grant_probe_anon'), ('browser','__grant_probe_auth'), ('browser','__grant_probe_public');
SELECT is(
  pg_temp.exposed('authenticated'), NULL,
  'self-test: adding the probe names to the allow-list clears the report'
);

SELECT * FROM finish();
ROLLBACK;
