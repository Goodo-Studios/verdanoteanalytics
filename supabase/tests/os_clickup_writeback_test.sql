-- Goodo OS: ClickUp write-back outbox (migration 20261130080001, story OS-017).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: the new tables have row rules and no anon grants; an app change to status, due date or a
-- person queues one row per field and a second change folds into it; changing back marks it
-- skipped; a write by the ClickUp sync (service role) or with app.sync_source = 'clickup' queues
-- nothing; read-only tasks and app-only tasks never queue; an app comment queues, a ClickUp comment
-- does not; a client decision queues and a superseded one is skipped; a client and an employee
-- cannot read the outbox, clashes or state; a builder can, and gets the overview; nobody but the
-- service role writes. All rows are made up.

BEGIN;
SELECT plan(30);

INSERT INTO auth.users (id, email) VALUES
  ('e7170000-0000-4000-8000-000000000001', 'wb-builder@example.test'),
  ('e7170000-0000-4000-8000-000000000002', 'wb-employee@example.test'),
  ('e7170000-0000-4000-8000-000000000003', 'wb-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e7170000-0000-4000-8000-000000000001', 'builder'),
  ('e7170000-0000-4000-8000-000000000002', 'employee'),
  ('e7170000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('wb-alpha', 'WB Alpha', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e7170000-0000-4000-8000-000000000003', 'wb-alpha');

CREATE TEMP TABLE r AS SELECT NULL::uuid AS a, NULL::uuid AS ro, NULL::uuid AS app;
GRANT ALL ON r TO authenticated, service_role;

-- ---------------------------------------------------------------- structure (1-4)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.os_clickup_outbox'::regclass, 'public.os_clickup_clashes'::regclass, 'public.os_clickup_writeback_state'::regclass)),
  'row rules are on for the outbox, clashes and state');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public'
              AND table_name IN ('os_clickup_outbox', 'os_clickup_clashes', 'os_clickup_writeback_state')
              AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the new tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public'
              AND table_name IN ('os_clickup_outbox', 'os_clickup_clashes', 'os_clickup_writeback_state')
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users can only read the new tables');
SELECT ok(NOT has_function_privilege('authenticated', 'public.os_user_emails_by_id(uuid[])', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.os_user_emails_by_id(uuid[])', 'EXECUTE'),
  'only the service role can map login ids to emails');

-- ---------------------------------------------------------------- the sync writes (5-8)
SET LOCAL role service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

INSERT INTO public.os_tasks (client_slug, title, status, raw_status, clickup_task_id, clickup_list_id, is_asset)
VALUES ('wb-alpha', 'November Asset 1', 'editing', 'editing', 'cu-wb-a', 'l-test', true),
       ('wb-alpha', 'September Asset 4', 'complete', 'complete', 'cu-wb-r', 'l-old', true);
INSERT INTO public.os_tasks (client_slug, title, status) VALUES ('wb-alpha', 'App only task', 'editing');
UPDATE public.os_tasks SET read_only = true WHERE clickup_task_id = 'cu-wb-r';
UPDATE r SET a = (SELECT id FROM public.os_tasks WHERE clickup_task_id = 'cu-wb-a'),
             ro = (SELECT id FROM public.os_tasks WHERE clickup_task_id = 'cu-wb-r'),
             app = (SELECT id FROM public.os_tasks WHERE title = 'App only task');

UPDATE public.os_tasks SET status = 'client review', due_date = '2026-12-01' WHERE id = (SELECT a FROM r);
SELECT is((SELECT count(*)::int FROM public.os_clickup_outbox), 0,
  'a change by the ClickUp sync (service role) queues nothing');

UPDATE public.os_tasks SET status = 'editing', due_date = NULL WHERE id = (SELECT a FROM r);
INSERT INTO public.os_task_comments (task_id, clickup_comment_id, author, body, created_at)
VALUES ((SELECT a FROM r), 'cm-wb-1', '{"username":"Pat"}', 'From ClickUp', now());
SELECT is((SELECT count(*)::int FROM public.os_clickup_outbox), 0,
  'a ClickUp comment copied in by the sync queues nothing');

SELECT lives_ok($$INSERT INTO public.os_clickup_outbox (clickup_task_id, kind, field) VALUES ('cu-x', 'status', 'status')$$,
  'the service role can write the outbox');
DELETE FROM public.os_clickup_outbox;
SELECT is((SELECT count(*)::int FROM public.os_clickup_outbox), 0, 'the outbox is empty again');

-- ---------------------------------------------------------------- app changes, employee (9-20)
RESET role;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'e7170000-0000-4000-8000-000000000002', true);

UPDATE public.os_tasks SET status = 'client review' WHERE id = (SELECT a FROM r);
RESET role;
SELECT is((SELECT kind || ' ' || (payload ->> 'from') || '>' || (payload ->> 'to') || ' ' || state || ' ' || clickup_list_id
             FROM public.os_clickup_outbox WHERE task_id = (SELECT a FROM r) AND field = 'status'),
  'status editing>client review queued l-test', 'an app status change queues one row with both values');
SELECT is((SELECT changed_by::text FROM public.os_clickup_outbox WHERE field = 'status'),
  'e7170000-0000-4000-8000-000000000002', 'the row records who changed it');
SET LOCAL role authenticated;

UPDATE public.os_tasks SET status = 'complete' WHERE id = (SELECT a FROM r);
RESET role;
SELECT is((SELECT count(*)::int || ' ' || min(payload ->> 'from') || '>' || min(payload ->> 'to')
             FROM public.os_clickup_outbox WHERE field = 'status' AND state = 'queued'),
  '1 editing>complete', 'a second change before sending folds into the same row');
SET LOCAL role authenticated;

UPDATE public.os_tasks SET status = 'editing' WHERE id = (SELECT a FROM r);
RESET role;
SELECT is((SELECT state FROM public.os_clickup_outbox WHERE field = 'status'), 'skipped',
  'changing it back before sending marks the row skipped');
SET LOCAL role authenticated;

UPDATE public.os_tasks SET due_date = '2026-12-05', strategist_id = 'e7170000-0000-4000-8000-000000000001'
 WHERE id = (SELECT a FROM r);
RESET role;
SELECT is((SELECT (payload ->> 'to') FROM public.os_clickup_outbox WHERE field = 'due_date' AND state = 'queued'), '2026-12-05',
  'an app due date change queues the new date');
SELECT is((SELECT kind || ' ' || (payload ->> 'to') FROM public.os_clickup_outbox WHERE field = 'strategist' AND state = 'queued'),
  'assignees e7170000-0000-4000-8000-000000000001', 'an app strategist change queues an assignees row for that role');
SET LOCAL role authenticated;

UPDATE public.os_tasks SET title = 'Renamed' WHERE id = (SELECT a FROM r);
RESET role;
SELECT is((SELECT count(*)::int FROM public.os_clickup_outbox WHERE state = 'queued'), 2,
  'a change to a field that is not written back queues nothing');
SET LOCAL role authenticated;

UPDATE public.os_tasks SET status = 'complete' WHERE id = (SELECT app FROM r);
RESET role;
SELECT is((SELECT count(*)::int FROM public.os_clickup_outbox WHERE task_id = (SELECT app FROM r)), 0,
  'a task made in the app with no ClickUp id queues nothing');
SET LOCAL role authenticated;

SELECT throws_ok($$UPDATE public.os_tasks SET status = 'editing' WHERE id = (SELECT ro FROM r)$$, '42501', NULL,
  'a read-only task refuses the change');
RESET role;
SELECT is((SELECT count(*)::int FROM public.os_clickup_outbox WHERE task_id = (SELECT ro FROM r)), 0,
  'a read-only task never queues');
SET LOCAL role authenticated;

SELECT set_config('app.sync_source', 'clickup', true);
UPDATE public.os_tasks SET due_date = '2026-12-09' WHERE id = (SELECT a FROM r);
SELECT set_config('app.sync_source', '', true);
RESET role;
SELECT is((SELECT payload ->> 'to' FROM public.os_clickup_outbox WHERE field = 'due_date' AND state = 'queued'), '2026-12-05',
  'a write marked app.sync_source = clickup queues nothing');
SET LOCAL role authenticated;

SELECT lives_ok($$SELECT public.post_task_comment((SELECT a FROM r), 'client', 'Looks great', '{}')$$,
  'staff post a comment in the app');
RESET role;
SELECT is((SELECT kind || ' ' || (payload ->> 'thread') || ' ' || (payload ->> 'body') FROM public.os_clickup_outbox WHERE kind = 'comment'),
  'comment client Looks great', 'an app comment queues with its thread and text');
SET LOCAL role authenticated;

SELECT is((SELECT count(*)::int FROM public.os_clickup_outbox), 0, 'an employee cannot read the outbox');
SELECT is((SELECT count(*)::int FROM public.os_clickup_writeback_state), 0, 'an employee cannot read the write-back state');
SELECT throws_ok($$SELECT public.clickup_writeback_overview()$$, '42501', NULL, 'an employee cannot get the overview');
SELECT throws_ok($$UPDATE public.os_clickup_outbox SET state = 'sent'$$, '42501', NULL, 'an employee cannot change the outbox');

-- ---------------------------------------------------------------- client decisions (26-27)
RESET role;
SET LOCAL role service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.client_task_decisions (clickup_task_id, client_slug, task_name, decision, note, decided_by, decided_by_label)
VALUES ('cu-wb-a', 'wb-alpha', 'November Asset 1', 'changes_requested', 'Shorter intro', 'e7170000-0000-4000-8000-000000000003', 'Alex');
SELECT is((SELECT (payload ->> 'decision') || ' ' || (payload ->> 'note') || ' ' || state FROM public.os_clickup_outbox WHERE kind = 'decision'),
  'changes_requested Shorter intro queued', 'a client decision queues');
UPDATE public.client_task_decisions SET superseded_at = now() WHERE clickup_task_id = 'cu-wb-a';
SELECT is((SELECT state FROM public.os_clickup_outbox WHERE kind = 'decision'), 'skipped',
  'a superseded decision that was not sent is skipped');

-- ---------------------------------------------------------------- client and builder (28-30)
RESET role;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'e7170000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.os_clickup_outbox) + (SELECT count(*)::int FROM public.os_clickup_clashes), 0,
  'a client reads no outbox or clash rows');

SELECT set_config('request.jwt.claim.sub', 'e7170000-0000-4000-8000-000000000001', true);
SELECT ok((SELECT count(*)::int FROM public.os_clickup_outbox) >= 4, 'a builder reads the outbox');
SELECT is((SELECT (public.clickup_writeback_overview() ->> 'enabled')), 'false',
  'the overview says write-back is off when no run has turned it on');

RESET role;
SELECT * FROM finish();
ROLLBACK;
