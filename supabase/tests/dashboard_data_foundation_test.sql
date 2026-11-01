-- pgTAP tests for the dashboard data foundation migrations
-- (20261101000001 to 20261101000006).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Covers: row rules on every moved table, no anon or client access, the staff
-- functions refusing clients, the ad code counter, and the role mapping.

BEGIN;
SELECT plan(22);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'dash-builder@example.test'),
  ('a2222222-2222-2222-2222-222222222222', 'dash-employee@example.test'),
  ('a3333333-3333-3333-3333-333333333333', 'dash-client@example.test'),
  ('a4444444-4444-4444-4444-444444444444', 'dash-admin-mapped@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'builder'),
  ('a2222222-2222-2222-2222-222222222222', 'employee'),
  ('a3333333-3333-3333-3333-333333333333', 'client');

INSERT INTO public.clients (slug, name, status) VALUES ('dash-pgtap', 'Dash pgTAP', 'active');
INSERT INTO public.app_users (name, email, role) VALUES
  ('Mapped Admin', 'dash-admin-mapped@example.test', 'admin'),
  ('Mapped Viewer', 'dash-viewer@example.test', 'viewer');

-- ---------------------------------------------------------------- structure
SELECT is(
  (SELECT count(*)::int FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      AND c.relname IN ('actor_application_videos','actor_applications','actor_approval_votes',
        'actor_assignments','actor_photos','actor_videos','actors','app_users','application_videos',
        'approval_boards','approval_votes','call_sheet_crew','call_sheets','clients',
        'creator_applications','creator_assignments','creator_filming_locations','creator_photos',
        'creator_videos','dashboard_creators','crew_members','deliverables','location_board_items',
        'location_boards','location_photos','locations','props','shoot_schedule_block_crew',
        'shoot_schedule_block_talent','shoot_schedule_blocks','shoots','studio_shipments',
        'ad_name_counter')),
  33,
  'all 32 dashboard tables and the ad counter exist');

SELECT hasnt_table('public', 'public_error_reports', 'public form support table stays with the old dashboard');
SELECT hasnt_table('public', 'upload_url_rate_limits', 'upload rate limit table stays with the old dashboard');
SELECT hasnt_table('public', 'actor_upload_url_rate_limits', 'actor upload rate limit table stays with the old dashboard');

SELECT is(
  (SELECT count(*)::int FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity
      AND c.relname IN (SELECT tablename FROM pg_policies WHERE policyname LIKE 'Staff %' OR policyname LIKE 'Builder %')),
  0,
  'row rules are on for every moved table');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public'
      AND (policyname LIKE 'Staff %' OR policyname LIKE 'Builder %')
      AND cmd <> 'INSERT'
      AND (qual IS NULL OR qual NOT LIKE '%has_role%')),
  0,
  'every moved-table policy checks has_role');

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee = 'anon'
      AND table_name IN ('clients','dashboard_creators','actors','app_users','creator_applications','actor_applications','ad_name_counter')),
  0,
  'anon holds no table privileges on moved tables');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('approve_application','reject_application','approve_actor_application','reject_actor_application',
        'apply_approval_votes','apply_actor_approval_votes','create_client','peek_ad_code','claim_ad_code')
      AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('public', p.oid, 'EXECUTE'))),
  0,
  'anon and public cannot execute the staff functions');

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'a3333333-3333-3333-3333-333333333333', true);

SELECT is((SELECT count(*)::int FROM public.clients), 0, 'client reads no clients');
SELECT is((SELECT count(*)::int FROM public.app_users), 0, 'client reads no app_users');
SELECT is((SELECT count(*)::int FROM public.deliverables), 0, 'client reads no deliverables');

SELECT throws_ok($$SELECT public.peek_ad_code()$$, '42501', NULL, 'client cannot peek the ad code');
SELECT throws_ok($$SELECT public.claim_ad_code()$$, '42501', NULL, 'client cannot claim an ad code');
SELECT throws_ok($$SELECT public.approve_application(gen_random_uuid())$$, '42501', NULL, 'client cannot approve an application');
SELECT throws_ok($$SELECT public.reject_application(gen_random_uuid(), 'no')$$, '42501', NULL, 'client cannot reject an application');
SELECT throws_ok($$SELECT public.apply_approval_votes('dash-pgtap', '[]'::jsonb)$$, '42501', NULL, 'client cannot change approval board votes');
SELECT throws_ok($$SELECT public.create_client('dash-x', 'X', true, true)$$, '42501', NULL, 'client cannot create a client');
SELECT throws_ok($$SELECT public.app_user_role_mapping()$$, '42501', NULL, 'client cannot read the role mapping');

-- ---------------------------------------------------------------- staff
SELECT set_config('request.jwt.claim.sub', 'a2222222-2222-2222-2222-222222222222', true);

SELECT is((SELECT count(*)::int FROM public.clients WHERE slug = 'dash-pgtap'), 1, 'employee reads clients');
SELECT is((SELECT public.claim_ad_code()), 200000::bigint, 'employee claims the first ad code');
SELECT is((SELECT public.peek_ad_code()), 200001::bigint, 'peek shows the next code without using it');

-- ---------------------------------------------------------------- role mapping
RESET role;
SELECT is(
  (SELECT string_agg(public.dashboard_role_to_verdanote_role(r)::text, ',' ORDER BY r)
     FROM unnest(ARRAY['admin','producer']) r),
  'builder,employee',
  'admin maps to builder and producer maps to employee');

SELECT * FROM finish();
ROLLBACK;
