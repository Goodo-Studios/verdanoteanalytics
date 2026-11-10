-- ClickUp connector on the one client model (migration 20261109000007).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_pt_a, which belongs to client pt-alpha
--   client B   a client login with no links
--   client M   linked to client pt-mu through client_members only (pt-mu has no ad account)
--   employee, builder   staff
-- Client pt-gamma owns ad account act_pt_g, which no test login is linked to.
--
-- Board rows (pipeline_tasks):
--   pt-a-acct   pt-alpha, account act_pt_a   (visible by the account rule and the client rule)
--   pt-a-slug   pt-alpha, no account         (visible by the client rule only)
--   pt-g-acct   pt-gamma, account act_pt_g
--   pt-g-slug   pt-gamma, no account
--   pt-mu-slug  pt-mu, no account
--
-- Checks: client_slug is required and account_id optional; clickup_client_folders is
-- gone; only the client read rule changed; client A reads its own rows through both
-- rules and nothing else; client B reads nothing; client M reads its client's row and
-- no other; employee and builder read all; clients cannot write.

BEGIN;
SELECT plan(24);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'pt-builder@example.test'),
  ('d0000000-0000-4000-8000-000000000002', 'pt-employee@example.test'),
  ('d0000000-0000-4000-8000-000000000003', 'pt-client-a@example.test'),
  ('d0000000-0000-4000-8000-000000000004', 'pt-client-b@example.test'),
  ('d0000000-0000-4000-8000-000000000005', 'pt-client-m@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'builder'),
  ('d0000000-0000-4000-8000-000000000002', 'employee'),
  ('d0000000-0000-4000-8000-000000000003', 'client'),
  ('d0000000-0000-4000-8000-000000000004', 'client'),
  ('d0000000-0000-4000-8000-000000000005', 'client');

INSERT INTO public.ad_accounts (id, name) VALUES ('act_pt_a', 'PT Alpha'), ('act_pt_g', 'PT Gamma');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('d0000000-0000-4000-8000-000000000003', 'act_pt_a');

INSERT INTO public.clients (slug, name, status) VALUES
  ('pt-alpha', 'PT Alpha', 'active'), ('pt-gamma', 'PT Gamma', 'active'), ('pt-mu', 'PT Mu', 'active');
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_pt_a', 'pt-alpha'), ('act_pt_g', 'pt-gamma');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('d0000000-0000-4000-8000-000000000005', 'pt-mu');

INSERT INTO public.pipeline_tasks (clickup_task_id, client_slug, account_id, stage) VALUES
  ('pt-a-acct', 'pt-alpha', 'act_pt_a', 'Editing'),
  ('pt-a-slug', 'pt-alpha', NULL, 'Client Review'),
  ('pt-g-acct', 'pt-gamma', 'act_pt_g', 'Editing'),
  ('pt-g-slug', 'pt-gamma', NULL, 'Production'),
  ('pt-mu-slug', 'pt-mu', NULL, 'Preparing Content');

-- ---------------------------------------------------------------- structure (1-9)
SELECT hasnt_table('public', 'clickup_client_folders', 'clickup_client_folders is retired');
SELECT col_not_null('public', 'pipeline_tasks', 'client_slug', 'pipeline_tasks.client_slug is required');
SELECT col_is_null('public', 'pipeline_tasks', 'account_id', 'pipeline_tasks.account_id is optional');
SELECT fk_ok('public', 'pipeline_tasks', 'client_slug', 'public', 'clients', 'slug',
  'pipeline_tasks.client_slug references clients.slug');
SELECT throws_ok(
  $$INSERT INTO public.pipeline_tasks (clickup_task_id, account_id, stage) VALUES ('pt-no-client', 'act_pt_a', 'Editing')$$,
  '23502', NULL, 'a new row without client_slug is refused');
SELECT policies_are('public', 'pipeline_tasks',
  ARRAY['Builder/employee can manage pipeline_tasks', 'Client can view linked pipeline_tasks'],
  'pipeline_tasks keeps exactly the staff rule and the client read rule');
SELECT ok(
  (SELECT qual ~ 'builder' AND qual ~ 'employee' AND qual !~ 'client'
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pipeline_tasks'
      AND policyname = 'Builder/employee can manage pipeline_tasks'),
  'the staff rule names builder and employee only');
SELECT is(
  (SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pipeline_tasks'
      AND policyname = 'Client can view linked pipeline_tasks'),
  'SELECT', 'the client rule is read-only');
SELECT ok(
  (SELECT qual ~ 'client''::' AND qual ~ 'get_user_account_ids' AND qual ~ 'get_user_client_slugs'
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pipeline_tasks'
      AND policyname = 'Client can view linked pipeline_tasks'),
  'the client rule needs the client role and checks the account rule or the client rule');

-- ---------------------------------------------------------------- client A (10-14)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.pipeline_tasks), 2, 'client A reads two rows');
SELECT is(ARRAY(SELECT clickup_task_id FROM public.pipeline_tasks ORDER BY clickup_task_id),
  ARRAY['pt-a-acct', 'pt-a-slug'],
  'client A reads its account row and its client-only row, and no other client''s rows');
SELECT throws_ok(
  $$INSERT INTO public.pipeline_tasks (clickup_task_id, client_slug, stage) VALUES ('pt-a-new', 'pt-alpha', 'Editing')$$,
  '42501', NULL, 'client A cannot add a board row');
SELECT lives_ok($$UPDATE public.pipeline_tasks SET stage = 'Changed by client'$$,
  'client A update runs (it must match no row, checked below)');
SELECT lives_ok($$DELETE FROM public.pipeline_tasks$$,
  'client A delete runs (it must match no row, checked below)');

-- ---------------------------------------------------------------- client B (15-16)
SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000004', true);

SELECT is((SELECT count(*)::int FROM public.pipeline_tasks), 0, 'client B reads no rows');
SELECT is(ARRAY(SELECT public.get_user_client_slugs()), ARRAY[]::text[], 'client B belongs to no client');

-- ---------------------------------------------------------------- client M (17-18)
SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000005', true);

SELECT is((SELECT count(*)::int FROM public.pipeline_tasks), 1, 'client M reads one row');
SELECT is((SELECT clickup_task_id FROM public.pipeline_tasks), 'pt-mu-slug',
  'client M (client_members only) reads its client''s row and no other');

-- ---------------------------------------------------------------- staff (19-20)
SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.pipeline_tasks WHERE clickup_task_id LIKE 'pt-%'), 5,
  'employee reads every board row');

SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.pipeline_tasks WHERE clickup_task_id LIKE 'pt-%'), 5,
  'builder reads every board row');

-- ---------------------------------------------------------------- client writes changed nothing (21-22)
RESET role;
SELECT is((SELECT count(*)::int FROM public.pipeline_tasks WHERE clickup_task_id LIKE 'pt-%'), 5,
  'the client delete removed no row');
SELECT is((SELECT count(*)::int FROM public.pipeline_tasks WHERE stage = 'Changed by client'), 0,
  'the client update changed no row');

-- ---------------------------------------------------------------- account rule alone (23-24)
-- Unlink act_pt_a from pt-alpha: client A no longer belongs to any client, so only the
-- account rule can let it read the row that carries its ad account.
DELETE FROM public.client_ad_accounts WHERE account_id = 'act_pt_a';
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000003', true);

SELECT is(ARRAY(SELECT public.get_user_client_slugs()), ARRAY[]::text[],
  'with the link removed client A belongs to no client');
SELECT is(ARRAY(SELECT clickup_task_id FROM public.pipeline_tasks ORDER BY clickup_task_id),
  ARRAY['pt-a-acct'],
  'client A still reads the row of its own ad account through the account rule alone');
RESET role;

SELECT * FROM finish();
ROLLBACK;
