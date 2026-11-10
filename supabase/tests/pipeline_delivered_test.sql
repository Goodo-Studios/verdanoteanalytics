-- Past cycles on the client board (migration 20261113000001, phase 5).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_pd_a, which belongs to client pd-alpha
--   client B   a client login with no links
--   client M   linked to client pd-mu through client_members only
--   employee, builder   staff
-- Client pd-gamma is linked to nobody.
--
-- Checks: pipeline_tasks gained cycle_month and delivered_at; pipeline_delivered has row rules,
-- no writes for signed-in users and exactly the staff read rule and the client read rule; client A
-- reads only pd-alpha rows, client M only pd-mu rows, client B nothing; staff read all; a client
-- cannot write, update or delete; the table only holds the client-safe fields.

BEGIN;
SELECT plan(25);

INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'pd-builder@example.test'),
  ('d1000000-0000-4000-8000-000000000002', 'pd-employee@example.test'),
  ('d1000000-0000-4000-8000-000000000003', 'pd-client-a@example.test'),
  ('d1000000-0000-4000-8000-000000000004', 'pd-client-b@example.test'),
  ('d1000000-0000-4000-8000-000000000005', 'pd-client-m@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'builder'),
  ('d1000000-0000-4000-8000-000000000002', 'employee'),
  ('d1000000-0000-4000-8000-000000000003', 'client'),
  ('d1000000-0000-4000-8000-000000000004', 'client'),
  ('d1000000-0000-4000-8000-000000000005', 'client');

INSERT INTO public.ad_accounts (id, name) VALUES ('act_pd_a', 'PD Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('d1000000-0000-4000-8000-000000000003', 'act_pd_a');
INSERT INTO public.clients (slug, name, status) VALUES
  ('pd-alpha', 'PD Alpha', 'active'), ('pd-gamma', 'PD Gamma', 'active'), ('pd-mu', 'PD Mu', 'active');
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_pd_a', 'pd-alpha');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('d1000000-0000-4000-8000-000000000005', 'pd-mu');

INSERT INTO public.pipeline_delivered (clickup_task_id, client_slug, account_id, task_name, content_type, cycle_month, delivered_at) VALUES
  ('pd-a-1', 'pd-alpha', 'act_pd_a', 'September Asset 1 - Hook test', 'Video', '2026-09-01', '2026-09-20'),
  ('pd-a-2', 'pd-alpha', NULL, 'September Asset 2', 'Static', '2026-09-01', '2026-09-28'),
  ('pd-g-1', 'pd-gamma', NULL, 'August Asset 1', 'Video', '2026-08-01', '2026-08-30'),
  ('pd-mu-1', 'pd-mu', NULL, 'September Asset 1', 'Video', NULL, '2026-09-15');

INSERT INTO public.pipeline_tasks (clickup_task_id, client_slug, stage, cycle_month, delivered_at) VALUES
  ('pd-task-1', 'pd-alpha', 'Ready to Launch', '2026-11-01', '2026-11-05');

-- ---------------------------------------------------------------- structure (1-9)
SELECT has_column('public', 'pipeline_tasks', 'cycle_month', 'pipeline_tasks has cycle_month');
SELECT has_column('public', 'pipeline_tasks', 'delivered_at', 'pipeline_tasks has delivered_at');
SELECT is((SELECT cycle_month FROM public.pipeline_tasks WHERE clickup_task_id = 'pd-task-1'), '2026-11-01'::date,
  'a board row keeps its cycle month');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pipeline_delivered'::regclass),
  'row rules are on for pipeline_delivered');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'pipeline_delivered' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on pipeline_delivered');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'pipeline_delivered' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read pipeline_delivered');
SELECT policies_are('public', 'pipeline_delivered',
  ARRAY['Builder/employee can read pipeline_delivered', 'Client can view own pipeline_delivered'],
  'pipeline_delivered has exactly the staff read rule and the client read rule');
SELECT ok(
  (SELECT qual ~ 'builder' AND qual ~ 'employee' AND qual !~ 'client'
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pipeline_delivered'
      AND policyname = 'Builder/employee can read pipeline_delivered'),
  'the staff rule names builder and employee only');
SELECT ok(
  (SELECT cmd = 'SELECT' AND qual ~ 'client''::' AND qual ~ 'get_user_client_slugs'
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pipeline_delivered'
      AND policyname = 'Client can view own pipeline_delivered'),
  'the client rule is read-only, needs the client role and checks the client''s own slugs');

-- ---------------------------------------------------------------- client A (10-13)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);

SELECT is(ARRAY(SELECT clickup_task_id FROM public.pipeline_delivered ORDER BY clickup_task_id),
  ARRAY['pd-a-1', 'pd-a-2'], 'client A reads its own client''s delivered rows and no other client''s');
SELECT throws_ok(
  $$INSERT INTO public.pipeline_delivered (clickup_task_id, client_slug, delivered_at) VALUES ('pd-a-new', 'pd-alpha', '2026-09-30')$$,
  '42501', NULL, 'client A cannot add a delivered row');
SELECT throws_ok($$UPDATE public.pipeline_delivered SET task_name = 'Changed by client'$$,
  '42501', NULL, 'client A cannot update a delivered row');
SELECT throws_ok($$DELETE FROM public.pipeline_delivered$$,
  '42501', NULL, 'client A cannot delete a delivered row');

-- ---------------------------------------------------------------- client B (14)
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.pipeline_delivered), 0, 'client B reads no delivered rows');

-- ---------------------------------------------------------------- client M (15)
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000005', true);
SELECT is(ARRAY(SELECT clickup_task_id FROM public.pipeline_delivered), ARRAY['pd-mu-1'],
  'client M (client_members only) reads its client''s delivered row and no other');

-- ---------------------------------------------------------------- staff (16-18)
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.pipeline_delivered WHERE clickup_task_id LIKE 'pd-%'), 4,
  'employee reads every delivered row');
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.pipeline_delivered WHERE clickup_task_id LIKE 'pd-%'), 4,
  'builder reads every delivered row');
SELECT throws_ok(
  $$INSERT INTO public.pipeline_delivered (clickup_task_id, client_slug, delivered_at) VALUES ('pd-b-new', 'pd-alpha', '2026-09-30')$$,
  '42501', NULL, 'staff do not write the table from the browser either');
RESET role;

-- ---------------------------------------------------------------- what the table holds (19-21)
SELECT is(ARRAY(SELECT column_name::text FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'pipeline_delivered' ORDER BY column_name COLLATE "C"),
  ARRAY['account_id', 'clickup_task_id', 'client_slug', 'content_type', 'cycle_month', 'delivered_at', 'id', 'synced_at', 'task_name', 'updated_at'],
  'pipeline_delivered holds the client-safe fields only (no status, assignee, link or brief)');
SELECT is((SELECT count(*)::int FROM public.pipeline_delivered WHERE clickup_task_id = 'pd-a-1' AND task_name = 'Changed by client'), 0,
  'the client update changed nothing');
SELECT is((SELECT count(*)::int FROM public.pipeline_delivered WHERE clickup_task_id LIKE 'pd-%'), 4,
  'the client delete removed nothing');

-- ---------------------------------------------------------------- service role (22-23)
SELECT is((SELECT has_table_privilege('service_role', 'public.pipeline_delivered', 'INSERT')), true,
  'the service role can write pipeline_delivered (the sync)');
SELECT is((SELECT has_table_privilege('authenticated', 'public.pipeline_delivered', 'INSERT')), false,
  'signed-in users cannot insert into pipeline_delivered');

-- ---------------------------------------------------------------- unlinking removes access (24-25)
DELETE FROM public.client_ad_accounts WHERE account_id = 'act_pd_a';
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
SELECT is(ARRAY(SELECT public.get_user_client_slugs()), ARRAY[]::text[], 'with the link removed client A belongs to no client');
SELECT is((SELECT count(*)::int FROM public.pipeline_delivered), 0, 'and reads no delivered rows');
RESET role;

SELECT * FROM finish();
ROLLBACK;
