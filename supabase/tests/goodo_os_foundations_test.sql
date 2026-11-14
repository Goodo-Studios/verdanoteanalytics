-- Goodo OS foundations: one client model (migration 20261109000004).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_os_a, which belongs to client os-alpha
--   client B   linked to client os-beta through client_members (os-beta has no ad account)
--   client C   a client login with no links
--   employee, builder   staff
-- Client os-gamma owns ad account act_os_g, which no test login is linked to.
--
-- Checks: row rules and grants on every new table; client A and client B each read
-- only their own client's engagements and nothing from the staff-only tables; client C
-- reads nothing; staff read and write; only builders touch the Goodo OS user copy; the
-- engagement rules (dates, one active sprint, same-client mappings); the Goodo OS role
-- mapping never gives a client login a staff role or the other way round.

BEGIN;
SELECT plan(74);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'os-builder@example.test'),
  ('c0000000-0000-4000-8000-000000000002', 'os-employee@example.test'),
  ('c0000000-0000-4000-8000-000000000003', 'os-client-a@example.test'),
  ('c0000000-0000-4000-8000-000000000004', 'os-client-b@example.test'),
  ('c0000000-0000-4000-8000-000000000005', 'os-client-c@example.test'),
  ('c0000000-0000-4000-8000-000000000006', 'os-owner@example.test'),
  ('c0000000-0000-4000-8000-000000000007', 'os-staff@example.test'),
  ('c0000000-0000-4000-8000-000000000008', 'os-newclient@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'builder'),
  ('c0000000-0000-4000-8000-000000000002', 'employee'),
  ('c0000000-0000-4000-8000-000000000003', 'client'),
  ('c0000000-0000-4000-8000-000000000004', 'client'),
  ('c0000000-0000-4000-8000-000000000005', 'client');

INSERT INTO public.ad_accounts (id, name) VALUES ('act_os_a', 'OS Alpha'), ('act_os_g', 'OS Gamma');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('c0000000-0000-4000-8000-000000000003', 'act_os_a');

INSERT INTO public.clients (slug, name, status) VALUES
  ('os-alpha', 'OS Alpha', 'active'), ('os-beta', 'OS Beta', 'active'), ('os-gamma', 'OS Gamma', 'active');
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_os_a', 'os-alpha'), ('act_os_g', 'os-gamma');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('c0000000-0000-4000-8000-000000000004', 'os-beta');

INSERT INTO public.engagements (id, client_slug, cycle_number, status, start_date) VALUES
  ('e0000000-0000-4000-8000-00000000000a', 'os-alpha', 1, 'active', '2026-10-01'),
  ('e0000000-0000-4000-8000-00000000000b', 'os-beta', 1, 'planned', NULL),
  ('e0000000-0000-4000-8000-00000000000c', 'os-gamma', 1, 'active', '2026-09-15');
INSERT INTO public.engagement_notes (engagement_id, purchase_reference, notes) VALUES
  ('e0000000-0000-4000-8000-00000000000a', 'inv-test-1', 'internal note a'),
  ('e0000000-0000-4000-8000-00000000000b', 'inv-test-2', 'internal note b'),
  ('e0000000-0000-4000-8000-00000000000c', 'inv-test-3', 'internal note c');
INSERT INTO public.source_mappings (client_slug, engagement_id, provider, kind, external_id) VALUES
  ('os-alpha', NULL, 'clickup', 'folder', 'f-alpha'),
  ('os-beta', NULL, 'goodo_os', 'client', 'gos-beta'),
  ('os-alpha', 'e0000000-0000-4000-8000-00000000000a', 'slack', 'channel', 'C-alpha');

CREATE TEMP TABLE new_tables (name text);
INSERT INTO new_tables VALUES ('client_ad_accounts'), ('client_members'), ('engagements'),
  ('engagement_notes'), ('source_mappings'), ('goodo_os_workspace_users');
GRANT SELECT ON new_tables TO authenticated, anon;

-- ---------------------------------------------------------------- structure (1-8)
SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN new_tables t ON t.name = c.relname
    WHERE c.relnamespace = 'public'::regnamespace AND c.relrowsecurity),
  6, 'row rules are on for all six new tables');
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants g JOIN new_tables t ON t.name = g.table_name
    WHERE g.table_schema = 'public' AND g.grantee IN ('anon', 'PUBLIC')),
  0, 'anon and public hold no privileges on the new tables');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('client_ad_accounts', 'engagement_notes', 'source_mappings', 'goodo_os_workspace_users')
      AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'client''::'),
  0, 'no policy on a staff-only table names the client role');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'goodo_os_workspace_users'
      AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'employee'),
  0, 'goodo_os_workspace_users policies name builder only');
SELECT has_function('public', 'get_user_client_slugs', ARRAY[]::name[], 'get_user_client_slugs takes no argument');
SELECT hasnt_function('public', 'get_user_client_slugs', ARRAY['uuid']::name[], 'get_user_client_slugs cannot be asked about another user');
SELECT ok(NOT has_function_privilege('anon', 'public.get_user_client_slugs()', 'EXECUTE'), 'anon cannot call get_user_client_slugs');
SELECT ok(NOT has_function_privilege('authenticated', 'public.apply_goodo_os_user_role_mapping()', 'EXECUTE'),
  'signed-in users cannot apply the role mapping');

-- ---------------------------------------------------------------- engagement rules (9-15)
SELECT is((SELECT day30_date FROM public.engagements WHERE id = 'e0000000-0000-4000-8000-00000000000a'), '2026-10-30'::date,
  'day 30 of a standard sprint is start + 29');
SELECT is((SELECT day45_date FROM public.engagements WHERE id = 'e0000000-0000-4000-8000-00000000000a'), '2026-11-14'::date,
  'day 45 of a standard sprint is start + 44');
SELECT throws_ok(
  $$INSERT INTO public.engagements (client_slug, cycle_number, status) VALUES ('os-beta', 2, 'active')$$,
  '23514', NULL, 'an active engagement needs a start date');
SELECT throws_ok(
  $$INSERT INTO public.engagements (client_slug, cycle_number, status, start_date) VALUES ('os-alpha', 2, 'active', '2026-11-15')$$,
  '23505', NULL, 'a client has at most one active standard sprint');
SELECT throws_ok(
  $$INSERT INTO public.engagements (client_slug, cycle_number) VALUES ('os-alpha', 1)$$,
  '23505', NULL, 'cycle numbers are unique per client');
SELECT throws_ok(
  $$INSERT INTO public.source_mappings (client_slug, engagement_id, provider, kind, external_id)
    VALUES ('os-beta', 'e0000000-0000-4000-8000-00000000000a', 'slack', 'channel', 'C-wrong')$$,
  '23503', NULL, 'a mapping cannot point at another client''s engagement');
SELECT throws_ok(
  $$INSERT INTO public.source_mappings (client_slug, provider, kind, external_id) VALUES ('os-beta', 'clickup', 'folder', 'f-alpha')$$,
  '23505', NULL, 'one outside id maps to one client while active');

-- ---------------------------------------------------------------- client A (16-27)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', true);

SELECT is(ARRAY(SELECT public.get_user_client_slugs()), ARRAY['os-alpha'], 'client A belongs to os-alpha through its ad account');
SELECT is((SELECT count(*)::int FROM public.engagements), 1, 'client A reads one engagement');
SELECT is((SELECT client_slug FROM public.engagements), 'os-alpha', 'client A reads only os-alpha engagements');
SELECT is((SELECT count(*)::int FROM public.engagement_notes), 0, 'client A reads no engagement notes');
SELECT is((SELECT count(*)::int FROM public.source_mappings), 0, 'client A reads no source mappings');
SELECT is((SELECT count(*)::int FROM public.client_ad_accounts), 0, 'client A reads no client account links');
SELECT is((SELECT count(*)::int FROM public.client_members), 0, 'client A reads no memberships');
SELECT is((SELECT count(*)::int FROM public.goodo_os_workspace_users), 0, 'client A reads no Goodo OS users');
SELECT throws_ok(
  $$INSERT INTO public.engagements (client_slug, cycle_number) VALUES ('os-alpha', 9)$$,
  '42501', NULL, 'client A cannot add an engagement');
SELECT lives_ok(
  $$UPDATE public.engagements SET status = 'cancelled'$$, 'client A update runs and matches no row');
SELECT throws_ok(
  $$INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_os_g', 'os-alpha')$$,
  '42501', NULL, 'client A cannot link an ad account');
SELECT throws_ok(
  $$SELECT * FROM public.goodo_os_user_role_mapping()$$,
  '42501', NULL, 'client A cannot read the role mapping');

-- ---------------------------------------------------------------- client B (28-35)
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000004', true);

SELECT is(ARRAY(SELECT public.get_user_client_slugs()), ARRAY['os-beta'], 'client B belongs to os-beta through client_members');
SELECT is((SELECT count(*)::int FROM public.engagements), 1, 'client B reads one engagement');
SELECT is((SELECT client_slug FROM public.engagements), 'os-beta', 'client B reads only os-beta engagements (no ad account needed)');
SELECT is((SELECT count(*)::int FROM public.client_members), 1, 'client B reads its own membership row');
SELECT is((SELECT count(*)::int FROM public.engagement_notes), 0, 'client B reads no engagement notes');
SELECT is((SELECT count(*)::int FROM public.source_mappings), 0, 'client B reads no source mappings');
SELECT throws_ok(
  $$INSERT INTO public.client_members (user_id, client_slug) VALUES ('c0000000-0000-4000-8000-000000000004', 'os-alpha')$$,
  '42501', NULL, 'client B cannot add itself to another client');
SELECT lives_ok(
  $$DELETE FROM public.client_members$$, 'client B delete runs and matches no row');

-- ---------------------------------------------------------------- client C (36-38)
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000005', true);

SELECT is(ARRAY(SELECT public.get_user_client_slugs()), ARRAY[]::text[], 'client C belongs to no client');
SELECT is((SELECT count(*)::int FROM public.engagements), 0, 'client C reads no engagements');
SELECT is((SELECT count(*)::int FROM public.client_members), 0, 'client C reads no memberships');

-- ---------------------------------------------------------------- nothing changed (39-40)
RESET role;
SELECT is((SELECT count(*)::int FROM public.engagements WHERE status = 'cancelled'), 0, 'client updates changed nothing');
SELECT is((SELECT count(*)::int FROM public.client_members), 1, 'client delete removed nothing');

-- ---------------------------------------------------------------- anon (41)
SET LOCAL role anon;
SELECT throws_ok($$SELECT count(*) FROM public.engagements$$, '42501', NULL, 'anon cannot read engagements');
RESET role;

-- ---------------------------------------------------------------- employee (42-50)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000002', true);

SELECT is((SELECT count(*)::int FROM public.engagements), 3, 'employee reads every engagement');
SELECT is((SELECT count(*)::int FROM public.engagement_notes), 3, 'employee reads every engagement note');
SELECT is((SELECT count(*)::int FROM public.source_mappings), 3, 'employee reads every source mapping');
SELECT is((SELECT count(*)::int FROM public.client_ad_accounts), 2, 'employee reads every client account link');
SELECT is((SELECT count(*)::int FROM public.client_members), 1, 'employee reads every membership');
SELECT lives_ok(
  $$INSERT INTO public.engagements (client_slug, cycle_number, status, start_date) VALUES ('os-beta', 2, 'closed', '2026-08-01')$$,
  'employee adds an engagement');
SELECT is((SELECT count(*)::int FROM public.goodo_os_workspace_users), 0, 'employee reads no Goodo OS users');
SELECT throws_ok(
  $$INSERT INTO public.goodo_os_workspace_users (id, role) VALUES ('gos-try', 'staff')$$,
  '42501', NULL, 'employee cannot write Goodo OS users');
SELECT throws_ok(
  $$SELECT * FROM public.goodo_os_user_role_mapping()$$,
  '42501', NULL, 'employee cannot read the role mapping');

-- ---------------------------------------------------------------- builder (51-53)
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);

SELECT lives_ok(
  $$INSERT INTO public.goodo_os_workspace_users (id, role, email) VALUES ('gos-builder-try', 'staff', 'x@example.test')$$,
  'builder writes Goodo OS users');
SELECT is((SELECT count(*)::int FROM public.goodo_os_workspace_users), 1, 'builder reads Goodo OS users');
SELECT lives_ok($$SELECT * FROM public.goodo_os_user_role_mapping()$$, 'builder reads the role mapping');
RESET role;
DELETE FROM public.goodo_os_workspace_users;

-- ---------------------------------------------------------------- role map (54-58)
SELECT is(public.goodo_os_role_to_verdanote_role('owner'), 'builder'::public.app_role, 'owner maps to builder');
SELECT is(public.goodo_os_role_to_verdanote_role('staff'), 'employee'::public.app_role, 'staff maps to employee');
SELECT is(public.goodo_os_role_to_verdanote_role('client'), 'client'::public.app_role, 'client maps to client');
SELECT is(public.goodo_os_role_to_verdanote_role('agent'), NULL, 'agent maps to no role');
SELECT is(public.goodo_os_role_to_verdanote_role('viewer'), NULL, 'an unknown role maps to no role');

-- ---------------------------------------------------------------- role mapping (59-74)
INSERT INTO public.app_users (name, email, role, auth_user_id)
VALUES ('OS Staff', 'os-staff@example.test', 'producer', 'd0000000-0000-4000-8000-000000000007');

INSERT INTO public.goodo_os_workspace_users (id, auth_subject, email, role, active, client_ids) VALUES
  ('gos-owner',           NULL, 'OS-Owner@example.test',    'owner',  true,  '{}'),
  ('gos-staff',           'd0000000-0000-4000-8000-000000000007', NULL, 'staff', true, '{}'),
  ('gos-staff-builder',   NULL, 'os-builder@example.test',  'staff',  true,  '{}'),
  ('gos-client-conflict', NULL, 'os-employee@example.test', 'client', true,  '{gos-beta}'),
  ('gos-staff-conflict',  NULL, 'os-client-c@example.test', 'staff',  true,  '{}'),
  ('gos-client-new',      NULL, 'os-newclient@example.test','client', true,  '{gos-beta,gos-unmapped}'),
  ('gos-agent',           NULL, 'agent@example.test',       'agent',  true,  '{}'),
  ('gos-inactive',        NULL, 'os-owner@example.test',    'owner',  false, '{}'),
  ('gos-nologin',         NULL, 'nobody@example.test',      'staff',  true,  '{}');

SELECT is(
  (SELECT string_agg(workspace_user_id || '=' || action, ',' ORDER BY workspace_user_id) FROM public.goodo_os_user_role_plan()),
  'gos-agent=not_mapped,gos-client-conflict=conflict,gos-client-new=add_role,gos-inactive=inactive,'
  || 'gos-nologin=no_login,gos-owner=add_role,gos-staff=add_role,gos-staff-builder=keeps_existing_role,gos-staff-conflict=conflict',
  'the plan gives each Goodo OS user the expected action');
SELECT is(
  (SELECT email FROM public.goodo_os_user_role_plan() WHERE workspace_user_id = 'gos-staff'),
  'os-staff@example.test',
  'a user with no email is matched through the dashboard app_users row of its auth subject');

CREATE TEMP TABLE apply1 AS SELECT public.apply_goodo_os_user_role_mapping() AS r;
SELECT is((SELECT (r->>'roles_added')::int FROM apply1), 3, 'apply adds three roles');
SELECT is((SELECT (r->>'memberships_added')::int FROM apply1), 1, 'apply adds one client membership');
SELECT is((SELECT r->'conflicts' FROM apply1), '["gos-client-conflict", "gos-staff-conflict"]'::jsonb, 'apply reports both conflicts');

SELECT is(ARRAY(SELECT role::text FROM public.user_roles WHERE user_id = 'c0000000-0000-4000-8000-000000000006'), ARRAY['builder'],
  'the owner login becomes builder');
SELECT is(ARRAY(SELECT role::text FROM public.user_roles WHERE user_id = 'c0000000-0000-4000-8000-000000000007'), ARRAY['employee'],
  'the staff login becomes employee');
SELECT is(ARRAY(SELECT role::text FROM public.user_roles WHERE user_id = 'c0000000-0000-4000-8000-000000000008'), ARRAY['client'],
  'the client login becomes client');
SELECT is(ARRAY(SELECT client_slug FROM public.client_members WHERE user_id = 'c0000000-0000-4000-8000-000000000008'), ARRAY['os-beta'],
  'the client login joins only the mapped client');
SELECT is(ARRAY(SELECT role::text FROM public.user_roles WHERE user_id = 'c0000000-0000-4000-8000-000000000002'), ARRAY['employee'],
  'a staff login mapped as a Goodo OS client keeps only its staff role');
SELECT is((SELECT count(*)::int FROM public.client_members WHERE user_id = 'c0000000-0000-4000-8000-000000000002'), 0,
  'a staff login mapped as a Goodo OS client gets no membership');
SELECT is(ARRAY(SELECT role::text FROM public.user_roles WHERE user_id = 'c0000000-0000-4000-8000-000000000005'), ARRAY['client'],
  'a client login mapped as Goodo OS staff keeps only the client role');
SELECT is(ARRAY(SELECT role::text FROM public.user_roles WHERE user_id = 'c0000000-0000-4000-8000-000000000001'), ARRAY['builder'],
  'a builder mapped as Goodo OS staff stays builder only');

CREATE TEMP TABLE apply2 AS SELECT public.apply_goodo_os_user_role_mapping() AS r;
SELECT is((SELECT (r->>'roles_added')::int FROM apply2), 0, 'a second apply adds no role');
SELECT is((SELECT (r->>'memberships_added')::int FROM apply2), 0, 'a second apply adds no membership');

-- The new client login now reads os-beta engagements through its membership.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000008', true);
SELECT is((SELECT count(DISTINCT client_slug)::int FROM public.engagements WHERE client_slug = 'os-beta'), 1,
  'the mapped client login reads its client''s engagements');
RESET role;

SELECT * FROM finish();
ROLLBACK;
