-- pipeline_tasks policies are limited to signed-in users (migration 20261207090003).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks that no pipeline_tasks policy applies to anon or public, that a signed-out request gets no
-- rows and no error, and that staff still read. All rows are made up.

BEGIN;
SELECT plan(4);

INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'ptp-employee@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'employee');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_ptp_a', 'PTP A');
INSERT INTO public.clients (slug, name, status) VALUES ('ptp-client', 'PTP Client', 'active');
INSERT INTO public.pipeline_tasks (clickup_task_id, account_id, client_slug, stage)
VALUES ('ptp-task-1', 'act_ptp_a', 'ptp-client', 'Editing');

SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'pipeline_tasks'
              AND (roles && ARRAY['public', 'anon']::name[])), 0,
  'no pipeline_tasks policy applies to public or anon');

SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::int FROM public.pipeline_tasks), 0,
  'a signed-out request gets no rows and no error');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.pipeline_tasks WHERE clickup_task_id = 'ptp-task-1'), 1,
  'an employee still reads the board');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'pipeline_tasks' AND roles = ARRAY['authenticated']::name[]), 2,
  'both pipeline_tasks policies are for authenticated');

SELECT * FROM finish();
ROLLBACK;
