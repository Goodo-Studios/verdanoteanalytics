-- Growth Dashboard client wall (migration 20261109000003).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- The Growth Dashboard holds revenue figures, so its table is builder only:
--   * a client and an employee read zero rows and cannot insert, change or delete
--   * a builder reads, inserts, changes and deletes
--   * anon holds no privileges, and every policy names builder and never employee

BEGIN;
SELECT plan(26);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('b1111111-1111-1111-1111-111111111111', 'growth-builder@example.test'),
  ('b2222222-2222-2222-2222-222222222222', 'growth-employee@example.test'),
  ('b3333333-3333-3333-3333-333333333333', 'growth-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b1111111-1111-1111-1111-111111111111', 'builder'),
  ('b2222222-2222-2222-2222-222222222222', 'employee'),
  ('b3333333-3333-3333-3333-333333333333', 'client');

-- Made-up numbers, not real ones.
INSERT INTO public.growth_dashboard_data (key, data)
VALUES ('state', '{"rev": {"6": 111}, "calls": {}, "deals": [], "weeks": {}, "targets": {}}');

-- ---------------------------------------------------------------- structure
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.growth_dashboard_data'::regclass),
  'row rules are on for growth_dashboard_data');

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'growth_dashboard_data' AND grantee IN ('anon', 'PUBLIC')),
  0,
  'anon and public hold no privileges on growth_dashboard_data');

SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'growth_dashboard_data'),
  4,
  'four policies: read, insert, update, delete');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'growth_dashboard_data'
      AND coalesce(qual, with_check) NOT LIKE '%has_role(auth.uid(), ''builder''::%'),
  0,
  'every policy checks has_role(auth.uid(), builder)');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'growth_dashboard_data'
      AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '(employee|client)'),
  0,
  'no policy names employee or client');

-- ---------------------------------------------------------------- client
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'b3333333-3333-3333-3333-333333333333', true);

SELECT is((SELECT count(*)::int FROM public.growth_dashboard_data), 0, 'client reads zero rows');
SELECT throws_ok(
  $$INSERT INTO public.growth_dashboard_data (key, data) VALUES ('client-try', '{}')$$,
  '42501', NULL, 'client cannot insert');
SELECT lives_ok(
  $$UPDATE public.growth_dashboard_data SET data = '{"rev": {"6": 1}}'$$,
  'client update runs and matches no row');
SELECT lives_ok(
  $$DELETE FROM public.growth_dashboard_data$$,
  'client delete runs and matches no row');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'b2222222-2222-2222-2222-222222222222', true);

SELECT is((SELECT count(*)::int FROM public.growth_dashboard_data), 0, 'employee reads zero rows');
SELECT throws_ok(
  $$INSERT INTO public.growth_dashboard_data (key, data) VALUES ('employee-try', '{}')$$,
  '42501', NULL, 'employee cannot insert');
SELECT lives_ok(
  $$UPDATE public.growth_dashboard_data SET data = '{"rev": {"6": 2}}'$$,
  'employee update runs and matches no row');
SELECT lives_ok(
  $$DELETE FROM public.growth_dashboard_data$$,
  'employee delete runs and matches no row');

-- ---------------------------------------------------------------- nothing changed
RESET role;
SELECT is(
  (SELECT data FROM public.growth_dashboard_data WHERE key = 'state'),
  '{"rev": {"6": 111}, "calls": {}, "deals": [], "weeks": {}, "targets": {}}'::jsonb,
  'client and employee updates changed nothing');
SELECT is((SELECT count(*)::int FROM public.growth_dashboard_data), 1, 'client and employee deletes removed nothing');
SELECT is(
  (SELECT count(*)::int FROM public.growth_dashboard_data WHERE key IN ('client-try', 'employee-try')),
  0,
  'client and employee inserts added nothing');

-- ---------------------------------------------------------------- anon
SET LOCAL role anon;
SELECT throws_ok(
  $$SELECT count(*) FROM public.growth_dashboard_data$$,
  '42501', NULL, 'anon cannot read the table at all');
RESET role;

-- ---------------------------------------------------------------- builder
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'b1111111-1111-1111-1111-111111111111', true);

SELECT is((SELECT count(*)::int FROM public.growth_dashboard_data), 1, 'builder reads the row');
SELECT lives_ok(
  $$INSERT INTO public.growth_dashboard_data (key, data) VALUES ('plan', '{"year": 2026, "goal": 100}')$$,
  'builder inserts the plan row');
SELECT lives_ok(
  $$UPDATE public.growth_dashboard_data SET data = jsonb_set(data, '{rev,6}', '222') WHERE key = 'state'$$,
  'builder updates the state row');
SELECT is(
  (SELECT data #>> '{rev,6}' FROM public.growth_dashboard_data WHERE key = 'state'),
  '222',
  'builder update is saved');
SELECT is(
  (SELECT updated_by FROM public.growth_dashboard_data WHERE key = 'plan'),
  'b1111111-1111-1111-1111-111111111111'::uuid,
  'updated_by records the builder who inserted');
SELECT lives_ok(
  $$DELETE FROM public.growth_dashboard_data WHERE key = 'plan'$$,
  'builder deletes the plan row');
SELECT is((SELECT count(*)::int FROM public.growth_dashboard_data), 1, 'builder delete removed the row');
SELECT throws_ok(
  $$INSERT INTO public.growth_dashboard_data (key, data) VALUES ('bad', '[]')$$,
  '23514', NULL, 'data must be a JSON object');

RESET role;
SELECT is(
  (SELECT count(*)::int FROM public.growth_dashboard_data WHERE key = 'bad'),
  0,
  'the non-object row was not saved');

SELECT * FROM finish();
ROLLBACK;
