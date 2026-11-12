-- Goodo OS tasks and status history (migration 20261119080001, story OS-006).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on and no grants for anon; builder and employee add, read and update
-- tasks, only a builder deletes; every status change writes a history row with who and when;
-- history cannot be edited or deleted; brief due, cut to strategist and cut to client come
-- from the history; a client reads no table directly and gets only their own client's tasks,
-- with only client-visible fields, through os_client_tasks(). All rows are made up.

BEGIN;
SELECT plan(32);

INSERT INTO auth.users (id, email) VALUES
  ('e7000000-0000-4000-8000-000000000001', 'ot-builder@example.test'),
  ('e7000000-0000-4000-8000-000000000002', 'ot-employee@example.test'),
  ('e7000000-0000-4000-8000-000000000003', 'ot-client@example.test'),
  ('e7000000-0000-4000-8000-000000000004', 'ot-nobody@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e7000000-0000-4000-8000-000000000001', 'builder'),
  ('e7000000-0000-4000-8000-000000000002', 'employee'),
  ('e7000000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('ot-alpha', 'OT Alpha', 'active'), ('ot-beta', 'OT Beta', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e7000000-0000-4000-8000-000000000003', 'ot-alpha');

CREATE TEMP TABLE r AS SELECT NULL::uuid AS a, NULL::uuid AS b;
INSERT INTO r VALUES (NULL, NULL);
GRANT ALL ON r TO authenticated;

-- ---------------------------------------------------------------- structure (1-5)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.os_tasks'::regclass, 'public.os_task_status_history'::regclass,
  'public.os_task_statuses'::regclass, 'public.os_task_milestone_statuses'::regclass)),
  'row rules are on for the four task tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name LIKE 'os_task%' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the task tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'os_task_status_history'
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users cannot write status history directly');
SELECT ok(NOT has_function_privilege('anon', 'public.os_client_tasks()', 'EXECUTE'), 'anon cannot call os_client_tasks');
SELECT ok(NOT has_function_privilege('authenticated', 'public.os_tasks_record_status()', 'EXECUTE'), 'the history trigger function is not callable');

-- ---------------------------------------------------------------- employee adds and moves a task (6-14)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000002', true);

INSERT INTO public.os_tasks (client_slug, title, task_type, due_date, content_type, cycle_month, brief, hooks,
                             strategist_id, editor_id, asset_url, clickup_task_id)
VALUES ('ot-alpha', 'Alpha UGC 1', 'video', '2026-12-01', 'UGC', '2026-12-01', 'Secret brief', ARRAY['Hook A', 'Hook B'],
        'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002', 'https://example.test/a.mp4', 'cu-ot-1');
UPDATE r SET a = (SELECT id FROM public.os_tasks WHERE clickup_task_id = 'cu-ot-1');
INSERT INTO public.os_tasks (client_slug, title) VALUES ('ot-beta', 'Beta static 1');
UPDATE r SET b = (SELECT id FROM public.os_tasks WHERE title = 'Beta static 1');

SELECT is((SELECT status FROM public.os_tasks WHERE id = (SELECT a FROM r)), 'assigned', 'a new task starts as assigned');
SELECT is((SELECT count(*)::int FROM public.os_task_status_history WHERE task_id = (SELECT a FROM r)), 1,
  'the first status is written to history');
SELECT is((SELECT coalesce(from_status, '-') || ' ' || to_status || ' ' || changed_by::text
             FROM public.os_task_status_history WHERE task_id = (SELECT a FROM r)),
  '- assigned e7000000-0000-4000-8000-000000000002', 'the first history row says who added it');

UPDATE public.os_tasks SET status = 'client brief review' WHERE id = (SELECT a FROM r);
UPDATE public.os_tasks SET title = 'Alpha UGC 1 v2' WHERE id = (SELECT a FROM r);
SELECT is((SELECT count(*)::int FROM public.os_task_status_history WHERE task_id = (SELECT a FROM r)), 2,
  'a status change adds a history row; a title change does not');
UPDATE public.os_tasks SET status = 'internal review' WHERE id = (SELECT a FROM r);
UPDATE public.os_tasks SET status = 'ready to send to client' WHERE id = (SELECT a FROM r);
UPDATE public.os_tasks SET status = 'client review' WHERE id = (SELECT a FROM r);
SELECT is((SELECT string_agg(to_status, ' > ' ORDER BY id) FROM public.os_task_status_history WHERE task_id = (SELECT a FROM r)),
  'assigned > client brief review > internal review > ready to send to client > client review',
  'every status change is recorded in order');
SELECT is((SELECT from_status FROM public.os_task_status_history WHERE task_id = (SELECT a FROM r) AND to_status = 'internal review'),
  'client brief review', 'each history row keeps the status it came from');

SELECT throws_ok($$UPDATE public.os_tasks SET status = 'made up' WHERE id = (SELECT a FROM r)$$, '23503', NULL,
  'an unknown status is refused');
SELECT throws_ok($$UPDATE public.os_tasks SET is_stuck = true WHERE id = (SELECT a FROM r)$$, '23514', NULL,
  'a stuck task needs a reason');
SELECT lives_ok($$UPDATE public.os_tasks SET is_stuck = true, stuck_reason = 'Waiting on product' WHERE id = (SELECT a FROM r)$$,
  'a stuck task with a reason is saved');

-- ---------------------------------------------------------------- milestones (15-17)
SELECT ok((SELECT brief_due IS NOT NULL AND cut_to_strategist IS NOT NULL AND cut_to_client IS NOT NULL
             FROM public.os_task_milestones((SELECT a FROM r))), 'brief due, cut to strategist and cut to client are calculated');
SELECT ok((SELECT brief_due <= cut_to_strategist AND cut_to_strategist <= cut_to_client
             FROM public.os_task_milestones((SELECT a FROM r))), 'the milestone dates are in workflow order');
SELECT is((SELECT cut_to_client FROM public.os_task_milestones((SELECT a FROM r))),
  (SELECT changed_at FROM public.os_task_status_history WHERE task_id = (SELECT a FROM r) AND to_status = 'ready to send to client'),
  'cut to client is the first time the cut was ready to send');

-- ---------------------------------------------------------------- history is immutable (18-20)
SELECT throws_ok($$UPDATE public.os_task_status_history SET to_status = 'complete'$$, '42501', NULL,
  'a signed-in user cannot edit history');
RESET role;
SELECT throws_ok($$UPDATE public.os_task_status_history SET to_status = 'complete' WHERE task_id = (SELECT a FROM r)$$, '42501', NULL,
  'not even the owner can edit history');
SELECT throws_ok($$DELETE FROM public.os_task_status_history WHERE task_id = (SELECT a FROM r)$$, '42501', NULL,
  'history rows of a live task cannot be deleted');

-- ---------------------------------------------------------------- employee cannot delete; builder can (21-23)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000002', true);
DELETE FROM public.os_tasks WHERE id = (SELECT b FROM r);
SELECT is((SELECT count(*)::int FROM public.os_tasks WHERE id = (SELECT b FROM r)), 1, 'an employee cannot delete a task');

SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.os_tasks WHERE client_slug IN ('ot-alpha', 'ot-beta')), 2, 'a builder reads every client''s tasks');
DELETE FROM public.os_tasks WHERE id = (SELECT b FROM r);
SELECT is((SELECT count(*)::int FROM public.os_tasks WHERE id = (SELECT b FROM r)), 0, 'a builder deletes a task, with its history');
INSERT INTO public.os_tasks (client_slug, title) VALUES ('ot-beta', 'Beta static 2');

-- ---------------------------------------------------------------- client (24-30)
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.os_tasks), 0, 'a client reads no task rows directly');
SELECT is((SELECT count(*)::int FROM public.os_task_status_history), 0, 'a client reads no history directly');
SELECT is((SELECT count(*)::int FROM public.os_client_tasks()), 1, 'a client gets only their own client''s tasks');
SELECT is((SELECT title || ' ' || status || ' ' || stage FROM public.os_client_tasks()), 'Alpha UGC 1 v2 client review Client Review',
  'a client sees the title, status and stage');
SELECT ok((SELECT NOT (proargnames && ARRAY['brief', 'hooks', 'qa_checklist', 'stuck_reason', 'is_stuck',
                                             'strategist_id', 'producer_id', 'editor_id', 'clickup_task_id', 'created_by'])
             FROM pg_proc WHERE oid = 'public.os_client_tasks()'::regprocedure),
  'the client view has no internal fields');
SELECT throws_ok($$INSERT INTO public.os_tasks (client_slug, title) VALUES ('ot-alpha', 'Client made this')$$, '42501', NULL,
  'a client cannot add a task');
UPDATE public.os_tasks SET status = 'complete' WHERE client_slug = 'ot-alpha';
RESET role;
SELECT is((SELECT status FROM public.os_tasks WHERE id = (SELECT a FROM r)), 'client review', 'a client cannot change a task''s status');

-- ---------------------------------------------------------------- no role (31-32)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.os_tasks), 0, 'a login with no role reads no tasks');
SELECT is((SELECT count(*)::int FROM public.os_client_tasks()), 0, 'a login with no role gets nothing from os_client_tasks');

SELECT * FROM finish();
ROLLBACK;
