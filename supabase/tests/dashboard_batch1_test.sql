-- Old dashboard batch 1 (step 5a): Overview, Client Detail, Creator pipeline and
-- Follow-ups read clients, deliverables, creator_assignments, dashboard_creators
-- and app_users, and write through creator_assignments and the client functions.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_b1_a, which belongs to client b1-alpha
--   client B   linked to client b1-beta through client_members
--   employee, builder   staff
-- A client login linked to a client still reads none of that client's staff
-- rows: the five tables are staff only whatever client_ad_accounts or
-- client_members say. Also covers the stage follow-up rule the Follow-ups page
-- relies on and the reworded refusals (migration 20261110150001, no Coda).

BEGIN;
SELECT plan(32);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('b1000000-0000-4000-8000-000000000001', 'b1-builder@example.test'),
  ('b1000000-0000-4000-8000-000000000002', 'b1-employee@example.test'),
  ('b1000000-0000-4000-8000-000000000003', 'b1-client-a@example.test'),
  ('b1000000-0000-4000-8000-000000000004', 'b1-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b1000000-0000-4000-8000-000000000001', 'builder'),
  ('b1000000-0000-4000-8000-000000000002', 'employee'),
  ('b1000000-0000-4000-8000-000000000003', 'client'),
  ('b1000000-0000-4000-8000-000000000004', 'client');

INSERT INTO public.ad_accounts (id, name) VALUES ('act_b1_a', 'B1 Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('b1000000-0000-4000-8000-000000000003', 'act_b1_a');

INSERT INTO public.clients (slug, name, status, origin) VALUES
  ('b1-alpha', 'B1 Alpha', 'active', 'coda'),
  ('b1-beta', 'B1 Beta', 'active', 'manual');
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_b1_a', 'b1-alpha');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('b1000000-0000-4000-8000-000000000004', 'b1-beta');

INSERT INTO public.deliverables (client_slug, month, type, status) VALUES
  ('b1-alpha', '2026-11', 'production', 'in_progress'),
  ('b1-beta', '2026-11', 'production', 'pending');
INSERT INTO public.app_users (id, name, email, role) VALUES
  ('b1000000-0000-4000-8000-0000000000a1', 'B1 Producer', 'b1-employee@example.test', 'producer');
INSERT INTO public.dashboard_creators (id, name) VALUES
  ('b1000000-0000-4000-8000-0000000000c1', 'B1 Creator One'),
  ('b1000000-0000-4000-8000-0000000000c2', 'B1 Creator Two');
INSERT INTO public.creator_assignments (id, creator_id, client_slug, stage, owner_id) VALUES
  ('b1000000-0000-4000-8000-0000000000d1', 'b1000000-0000-4000-8000-0000000000c1', 'b1-alpha', 'interested', 'b1000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000d2', 'b1000000-0000-4000-8000-0000000000c2', 'b1-beta', 'sourced', NULL);

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.clients), 0, 'client A reads no clients, not even its own client');
SELECT is((SELECT count(*)::int FROM public.deliverables), 0, 'client A reads no deliverables');
SELECT is((SELECT count(*)::int FROM public.creator_assignments), 0, 'client A reads no creator_assignments');
SELECT is((SELECT count(*)::int FROM public.dashboard_creators), 0, 'client A reads no dashboard_creators');
SELECT is((SELECT count(*)::int FROM public.app_users), 0, 'client A reads no app_users');

SELECT throws_ok(
  $$INSERT INTO public.creator_assignments (creator_id, client_slug) VALUES ('b1000000-0000-4000-8000-0000000000c2', 'b1-alpha')$$,
  '42501', NULL, 'client A cannot add a creator to a client');
SELECT lives_ok(
  $$UPDATE public.creator_assignments SET notes = 'client wrote this' WHERE id = 'b1000000-0000-4000-8000-0000000000d1'$$,
  'client A update runs but matches no row');
SELECT throws_ok(
  $$INSERT INTO public.dashboard_creators (name) VALUES ('client creator')$$,
  '42501', NULL, 'client A cannot add a creator');
SELECT throws_ok($$SELECT public.set_client_details('b1-beta', 'x', 'y', NULL, NULL, NULL)$$, '42501', NULL, 'client A is refused set_client_details');
SELECT throws_ok($$SELECT public.set_client_scope('b1-alpha', 'x')$$, '42501', NULL, 'client A is refused set_client_scope');
SELECT throws_ok($$SELECT public.set_client_active('b1-alpha', false)$$, '42501', NULL, 'client A is refused set_client_active');
SELECT throws_ok($$SELECT public.update_client('b1-beta', 'Renamed', NULL, NULL)$$, '42501', NULL, 'client A is refused update_client');

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.clients), 0, 'client B reads no clients, not even its member client');
SELECT is((SELECT count(*)::int FROM public.deliverables), 0, 'client B reads no deliverables');
SELECT is((SELECT count(*)::int FROM public.creator_assignments), 0, 'client B reads no creator_assignments');
SELECT is((SELECT count(*)::int FROM public.dashboard_creators), 0, 'client B reads no dashboard_creators');
SELECT is((SELECT count(*)::int FROM public.app_users), 0, 'client B reads no app_users');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);

SELECT is((SELECT count(*)::int FROM public.clients WHERE slug LIKE 'b1-%'), 2, 'employee reads clients');
SELECT is((SELECT count(*)::int FROM public.deliverables WHERE client_slug LIKE 'b1-%'), 2, 'employee reads deliverables');
SELECT is((SELECT notes FROM public.creator_assignments WHERE id = 'b1000000-0000-4000-8000-0000000000d1'), NULL,
  'the client A update changed nothing');
SELECT is((SELECT count(*)::int FROM public.app_users WHERE email = 'b1-employee@example.test'), 1, 'employee reads app_users');

SELECT lives_ok(
  $$UPDATE public.creator_assignments SET stage = 'contract_sent' WHERE id = 'b1000000-0000-4000-8000-0000000000d1'$$,
  'employee moves a creator to contract sent');
SELECT is(
  (SELECT next_follow_up_at FROM public.creator_assignments WHERE id = 'b1000000-0000-4000-8000-0000000000d1'),
  (now() AT TIME ZONE 'utc')::date + 2,
  'the stage rule sets the follow-up two days out');
SELECT is(
  (SELECT next_follow_up_source FROM public.creator_assignments WHERE id = 'b1000000-0000-4000-8000-0000000000d1'),
  'stage_rule', 'and labels it stage_rule');
SELECT lives_ok(
  $$UPDATE public.creator_assignments SET next_follow_up_at = DATE '2030-01-02' WHERE id = 'b1000000-0000-4000-8000-0000000000d1'$$,
  'employee snoozes the follow-up');
SELECT is(
  (SELECT next_follow_up_source FROM public.creator_assignments WHERE id = 'b1000000-0000-4000-8000-0000000000d1'),
  'manual', 'a typed date is labelled manual');
SELECT throws_ok($$SELECT public.set_client_details('b1-beta', 'x', 'y', NULL, NULL, NULL)$$, '42501', NULL,
  'employee is refused set_client_details (builder only)');

-- ---------------------------------------------------------------- builder
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);

SELECT throws_ok(
  $$SELECT public.set_client_details('b1-alpha', 'x', 'y', NULL, NULL, NULL)$$,
  '22023',
  'This client is kept in step with its knowledge file by the HQ sync - change its service type, strategist, contract dates and status in the knowledge file, not here.',
  'a synced (legacy coda) client is refused with the new wording');
SELECT throws_ok(
  $$SELECT public.update_client('b1-alpha', 'Renamed', NULL, NULL)$$,
  '22023',
  'This client is kept in step with its knowledge file by the HQ sync - change its name in the knowledge file, not here.',
  'renaming a synced client is refused with the new wording');
SELECT is(
  (SELECT public.set_client_details('b1-beta', 'Performance Creative', 'New Strategist', NULL, NULL, NULL) ->> 'strategist'),
  'New Strategist', 'builder edits a manual client');

-- ---------------------------------------------------------------- structure
RESET role;
SELECT is(
  (SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ILIKE '%synced from Coda%'),
  0, 'no database function says synced from Coda');
SELECT ok(
  (SELECT p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     FROM pg_proc p WHERE p.oid = 'public.set_client_details(text, text, text, date, date, text)'::regprocedure),
  'set_client_details keeps SECURITY DEFINER and its grants after the rewording');

SELECT * FROM finish();
ROLLBACK;
