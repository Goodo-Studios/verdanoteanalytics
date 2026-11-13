-- Goodo OS: a task may take exactly the statuses of its own ClickUp list
-- (migration 20261206080001_os_list_statuses).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: os_clickup_list_statuses has row rules, no anon grants and read-only access for
-- signed-in users; staff can set a status that is on the task's list (including one the app's own
-- workflow does not have, "filming"); a status not on the list (even a known one) and "stuck" are
-- refused with 23514; a list whose statuses are not synced yet and a task made in the app keep the
-- old rule; the ClickUp sync (service role) is not checked; os_task_status_options gives the
-- list's statuses in ClickUp order, or the app workflow without Other when the list is not synced;
-- a client gets no options, cannot read list statuses and cannot change a task; nobody but the
-- service role writes list statuses. All rows are made up.

BEGIN;
SELECT plan(20);

INSERT INTO auth.users (id, email) VALUES
  ('e7180000-0000-4000-8000-000000000001', 'ls-employee@example.test'),
  ('e7180000-0000-4000-8000-000000000002', 'ls-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e7180000-0000-4000-8000-000000000001', 'employee'),
  ('e7180000-0000-4000-8000-000000000002', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('ls-alpha', 'LS Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e7180000-0000-4000-8000-000000000002', 'ls-alpha');

CREATE TEMP TABLE r AS SELECT NULL::uuid AS listed, NULL::uuid AS unsynced, NULL::uuid AS app;
GRANT ALL ON r TO authenticated, service_role;

-- ---------------------------------------------------------------- structure (1-3)
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.os_clickup_list_statuses'::regclass),
  'row rules are on for os_clickup_list_statuses');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'os_clickup_list_statuses'
              AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on os_clickup_list_statuses');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'os_clickup_list_statuses'
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users can only read os_clickup_list_statuses');

-- ---------------------------------------------------------------- the sync stores a list (4-5)
SET LOCAL role service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

INSERT INTO public.os_task_statuses (status, position, stage) VALUES ('filming', 9950, 'Production');
SELECT lives_ok($$INSERT INTO public.os_clickup_list_statuses (list_id, status, name, position, color, type) VALUES
  ('l-ls', 'ready to shoot', 'READY TO SHOOT', 10, '#aaaaaa', 'open'),
  ('l-ls', 'filming', 'Filming', 20, '#ff0000', 'custom'),
  ('l-ls', 'editing', 'Editing', 30, '#00ff00', 'custom')$$,
  'the service role stores a list''s statuses');
SELECT throws_ok($$INSERT INTO public.os_clickup_list_statuses (list_id, status, name, position) VALUES ('l-ls', 'stuck', 'stuck', 40)$$,
  '23514', NULL, 'stuck is a flag, never a list status');

INSERT INTO public.os_tasks (client_slug, title, status, raw_status, clickup_task_id, clickup_list_id, is_asset) VALUES
  ('ls-alpha', 'Write-back test task', 'editing', 'editing', 'cu-ls-1', 'l-ls', true),
  ('ls-alpha', 'Task on a list not synced yet', 'editing', 'editing', 'cu-ls-2', 'l-unsynced', true);
INSERT INTO public.os_tasks (client_slug, title, status) VALUES ('ls-alpha', 'Made in the app', 'editing');
UPDATE r SET listed = (SELECT id FROM public.os_tasks WHERE clickup_task_id = 'cu-ls-1'),
             unsynced = (SELECT id FROM public.os_tasks WHERE clickup_task_id = 'cu-ls-2'),
             app = (SELECT id FROM public.os_tasks WHERE title = 'Made in the app');

-- ---------------------------------------------------------------- staff changes (6-13)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'e7180000-0000-4000-8000-000000000001', true);

SELECT lives_ok($$UPDATE public.os_tasks SET status = 'filming' WHERE id = (SELECT listed FROM r)$$,
  'staff can set a status that is on the task''s list but not in the app''s own workflow');
SELECT is((SELECT status FROM public.os_tasks WHERE id = (SELECT listed FROM r)), 'filming', 'the task is filming');
SELECT throws_ok($$UPDATE public.os_tasks SET status = 'complete' WHERE id = (SELECT listed FROM r)$$,
  '23514', NULL, 'a known status that is not on the task''s list is refused');
SELECT throws_ok($$UPDATE public.os_tasks SET status = 'stuck' WHERE id = (SELECT listed FROM r)$$,
  '23514', NULL, 'stuck is refused as a status');
SELECT lives_ok($$UPDATE public.os_tasks SET status = 'client review' WHERE id = (SELECT unsynced FROM r)$$,
  'a list not synced yet keeps the old rule (any known status)');
SELECT lives_ok($$UPDATE public.os_tasks SET status = 'internal review' WHERE id = (SELECT app FROM r)$$,
  'a task made in the app keeps the old rule');
SELECT is(ARRAY(SELECT status || '|' || name || '|' || stage FROM public.os_task_status_options((SELECT listed FROM r))),
  ARRAY['ready to shoot|READY TO SHOOT|Production', 'filming|Filming|Production', 'editing|Editing|Editing'],
  'the picker offers the list''s statuses in ClickUp order, with ClickUp''s names and the app stage');
SELECT ok((SELECT count(*) FROM public.os_task_status_options((SELECT app FROM r))) >= 20
          AND NOT EXISTS (SELECT 1 FROM public.os_task_status_options((SELECT app FROM r)) o WHERE o.stage = 'Other'),
  'a task with no synced list is offered the app workflow, without the Other statuses');

SELECT throws_ok($$INSERT INTO public.os_clickup_list_statuses (list_id, status, name, position) VALUES ('l-ls', 'complete', 'Complete', 50)$$,
  '42501', NULL, 'staff cannot write list statuses');

-- ---------------------------------------------------------------- the sync is not checked (15)
SET LOCAL role service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT lives_ok($$UPDATE public.os_tasks SET status = 'complete' WHERE id = (SELECT listed FROM r)$$,
  'the ClickUp sync writes whatever ClickUp has');
UPDATE public.os_tasks SET status = 'filming' WHERE id = (SELECT listed FROM r);

-- ---------------------------------------------------------------- a client (16-20)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'e7180000-0000-4000-8000-000000000002', true);

SELECT is((SELECT count(*)::int FROM public.os_task_status_options((SELECT listed FROM r))), 0,
  'a client gets no status options');
SELECT is((SELECT count(*)::int FROM public.os_clickup_list_statuses), 0, 'a client cannot read list statuses');
UPDATE public.os_tasks SET status = 'editing' WHERE id = (SELECT listed FROM r);
SELECT throws_ok($$INSERT INTO public.os_clickup_list_statuses (list_id, status, name, position) VALUES ('l-ls', 'complete', 'Complete', 50)$$,
  '42501', NULL, 'a client cannot write list statuses');

RESET role;
SELECT is((SELECT status FROM public.os_tasks WHERE id = (SELECT listed FROM r)), 'filming',
  'a client''s status change touches no row');
SELECT ok(NOT has_function_privilege('anon', 'public.os_task_status_options(uuid)', 'EXECUTE'),
  'anon cannot ask for status options');

SELECT * FROM finish();
ROLLBACK;
