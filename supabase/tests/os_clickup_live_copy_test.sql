-- Goodo OS: ClickUp live copy (migration 20261120080001, story OS-007).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: the new tables have row rules and no anon grants; the email lookup is service role
-- only; a service-role write is recorded in history as source clickup with no person; a stuck
-- row keeps its status; read-only (ending client) tasks refuse an employee or builder update or
-- delete but take a service-role update; comments, sync runs and discrepancies are staff read
-- only and invisible to clients; a client still gets only their own client's tasks through
-- os_client_tasks, never a row with no client and never a non-asset ClickUp task. All rows are
-- made up.

BEGIN;
SELECT plan(36);

INSERT INTO auth.users (id, email) VALUES
  ('e7100000-0000-4000-8000-000000000001', 'oc-builder@example.test'),
  ('e7100000-0000-4000-8000-000000000002', 'oc-employee@example.test'),
  ('e7100000-0000-4000-8000-000000000003', 'oc-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e7100000-0000-4000-8000-000000000001', 'builder'),
  ('e7100000-0000-4000-8000-000000000002', 'employee'),
  ('e7100000-0000-4000-8000-000000000003', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('oc-alpha', 'OC Alpha', 'active'), ('oc-beta', 'OC Beta', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('e7100000-0000-4000-8000-000000000003', 'oc-alpha');

CREATE TEMP TABLE r AS SELECT NULL::uuid AS a, NULL::uuid AS ro, NULL::uuid AS run;
GRANT ALL ON r TO authenticated, service_role;

-- ---------------------------------------------------------------- structure (1-9)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.os_task_comments'::regclass, 'public.os_sync_runs'::regclass, 'public.os_sync_discrepancies'::regclass)),
  'row rules are on for comments, sync runs and discrepancies');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public'
              AND table_name IN ('os_task_comments', 'os_sync_runs', 'os_sync_discrepancies', 'os_task_counts_by_client')
              AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the new tables and the counts view');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public'
              AND table_name IN ('os_task_comments', 'os_sync_runs', 'os_sync_discrepancies', 'os_task_counts_by_client')
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users can only read the new tables');
SELECT ok(NOT has_function_privilege('authenticated', 'public.os_user_ids_by_email(text[])', 'EXECUTE'),
  'a signed-in user cannot call the email lookup');
SELECT ok(NOT has_function_privilege('anon', 'public.os_user_ids_by_email(text[])', 'EXECUTE'),
  'anon cannot call the email lookup');
SELECT ok(has_function_privilege('service_role', 'public.os_user_ids_by_email(text[])', 'EXECUTE'),
  'the service role can call the email lookup');
SELECT is((SELECT count(*)::int FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'os_tasks'
              AND column_name IN ('clickup_space_id', 'clickup_list_id', 'clickup_list_name', 'clickup_parent_id',
                                  'description', 'raw_status', 'assignees', 'reviewed_by', 'brief_type',
                                  'brief_due_date', 'cut_to_strategist_date', 'cut_to_client_date', 'edit_due_date',
                                  'production_date', 'brief_handed_off_date', 'is_asset', 'read_only', 'clickup_url',
                                  'clickup_updated_at', 'last_synced_at')), 20,
  'os_tasks has the twenty ClickUp columns');
SELECT is((SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'os_tasks' AND column_name = 'client_slug'), 'YES',
  'a task may have no client');
SELECT is((SELECT count(*)::int FROM public.os_user_ids_by_email(ARRAY['OC-Employee@Example.test', 'nobody@example.test'])), 1,
  'the email lookup matches case-insensitively and skips unknown emails');

-- ---------------------------------------------------------------- the sync writes (10-16)
SET LOCAL role service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT lives_ok($$INSERT INTO public.os_task_statuses (status, position, stage) VALUES ('oc to do', 9910, 'Other')$$,
  'a status from another space is added with stage Other');

INSERT INTO public.os_tasks (client_slug, title, status, raw_status, clickup_task_id, clickup_list_id, is_asset)
VALUES ('oc-alpha', 'November Asset 1', 'editing', 'editing', 'cu-oc-a', 'l-pv', true),
       (NULL, 'Creator onboarding', 'oc to do', 'oc to do', 'cu-oc-n', 'l-creators', false),
       ('oc-alpha', 'Kickoff call', 'complete', 'complete', 'cu-oc-m', 'l-calls', false),
       ('oc-alpha', 'September Asset 4', 'complete', 'complete', 'cu-oc-r', 'l-pv-old', true);
UPDATE public.os_tasks SET read_only = true WHERE clickup_task_id = 'cu-oc-r';
UPDATE r SET a = (SELECT id FROM public.os_tasks WHERE clickup_task_id = 'cu-oc-a'),
             ro = (SELECT id FROM public.os_tasks WHERE clickup_task_id = 'cu-oc-r');

SELECT is((SELECT source || ' ' || coalesce(changed_by::text, 'nobody')
             FROM public.os_task_status_history WHERE task_id = (SELECT a FROM r)),
  'clickup nobody', 'a task the sync adds is recorded as source clickup, with no person');

UPDATE public.os_tasks SET raw_status = 'stuck', is_stuck = true, stuck_reason = 'Stuck in ClickUp'
 WHERE id = (SELECT a FROM r);
SELECT is((SELECT status || ' ' || raw_status || ' ' || is_stuck::text FROM public.os_tasks WHERE id = (SELECT a FROM r)),
  'editing stuck true', 'a stuck task keeps its last real status and shows the ClickUp value');
SELECT is((SELECT count(*)::int FROM public.os_task_status_history WHERE task_id = (SELECT a FROM r)), 1,
  'going stuck adds no status history');

UPDATE public.os_tasks SET status = 'client review', raw_status = 'client review', is_stuck = false, stuck_reason = NULL
 WHERE id = (SELECT a FROM r);
SELECT is((SELECT string_agg(source, ',' ORDER BY id) FROM public.os_task_status_history WHERE task_id = (SELECT a FROM r)),
  'clickup,clickup', 'a status change by the sync is recorded as source clickup');

SELECT lives_ok($$UPDATE public.os_tasks SET title = 'September Asset 4 (final)' WHERE id = (SELECT ro FROM r)$$,
  'the sync may update a read-only task');

INSERT INTO public.os_task_comments (task_id, clickup_comment_id, author, body, created_at)
VALUES ((SELECT a FROM r), 'cm-oc-1', '{"username":"Pat"}', 'Looks good', now());
INSERT INTO public.os_sync_runs (kind, ok, counts) VALUES ('nightly', true, '{"tasks":4}');
UPDATE r SET run = (SELECT id FROM public.os_sync_runs WHERE counts = '{"tasks":4}'::jsonb);
INSERT INTO public.os_sync_discrepancies (run_id, clickup_task_id, field, app_value, clickup_value)
VALUES ((SELECT run FROM r), 'cu-oc-a', 'status', 'complete', 'client review');
SELECT is((SELECT count(*)::int FROM public.os_sync_discrepancies WHERE run_id = (SELECT run FROM r)), 1,
  'the sync records a discrepancy against its run');

-- ---------------------------------------------------------------- employee (17-26)
RESET role;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'e7100000-0000-4000-8000-000000000002', true);

SELECT throws_ok($$UPDATE public.os_tasks SET title = 'Edited' WHERE id = (SELECT ro FROM r)$$, '42501', NULL,
  'an employee cannot edit a read-only task');
SELECT throws_ok($$UPDATE public.os_tasks SET status = 'editing' WHERE id = (SELECT ro FROM r)$$, '42501', NULL,
  'an employee cannot move a read-only task');
UPDATE public.os_tasks SET status = 'complete' WHERE id = (SELECT a FROM r);
SELECT is((SELECT source || ' ' || changed_by::text FROM public.os_task_status_history
            WHERE task_id = (SELECT a FROM r) ORDER BY id DESC LIMIT 1),
  'app e7100000-0000-4000-8000-000000000002', 'a change in the app is recorded as source app, with the person');
SELECT is((SELECT count(*)::int FROM public.os_task_comments), 1, 'staff read comments');
SELECT is((SELECT count(*)::int FROM public.os_sync_runs WHERE id = (SELECT run FROM r)), 1, 'staff read sync runs');
SELECT is((SELECT count(*)::int FROM public.os_sync_discrepancies WHERE run_id = (SELECT run FROM r)), 1, 'staff read discrepancies');
SELECT throws_ok($$INSERT INTO public.os_task_comments (task_id, clickup_comment_id) VALUES ((SELECT a FROM r), 'cm-oc-2')$$,
  '42501', NULL, 'staff cannot write comments');
SELECT throws_ok($$UPDATE public.os_sync_runs SET ok = false$$, '42501', NULL, 'staff cannot change sync runs');
SELECT is((SELECT total FROM public.os_task_counts_by_client WHERE client_slug = 'oc-alpha'), 3,
  'staff see task counts per client');
SELECT ok((SELECT total FROM public.os_task_counts_by_client WHERE client_slug IS NULL) >= 1,
  'internal tasks are counted under no client');

-- ---------------------------------------------------------------- builder (27-28)
SELECT set_config('request.jwt.claim.sub', 'e7100000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$DELETE FROM public.os_tasks WHERE id = (SELECT ro FROM r)$$, '42501', NULL,
  'a builder cannot delete a read-only task');
SELECT throws_ok($$UPDATE public.os_tasks SET title = 'Edited' WHERE id = (SELECT ro FROM r)$$, '42501', NULL,
  'a builder cannot edit a read-only task');

-- ---------------------------------------------------------------- client (29-36)
SELECT set_config('request.jwt.claim.sub', 'e7100000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.os_client_tasks() WHERE client_slug = 'oc-alpha'), 2,
  'a client gets their own asset tasks, including read-only history, and not meeting calls');
SELECT is((SELECT count(*)::int FROM public.os_client_tasks() WHERE client_slug IS NULL), 0,
  'a client never gets a task with no client');
SELECT is((SELECT count(*)::int FROM public.os_tasks), 0, 'a client reads no task rows directly');
SELECT is((SELECT count(*)::int FROM public.os_task_comments), 0, 'a client reads no comments');
SELECT is((SELECT count(*)::int FROM public.os_sync_runs), 0, 'a client reads no sync runs');
SELECT is((SELECT count(*)::int FROM public.os_sync_discrepancies), 0, 'a client reads no discrepancies');
SELECT is((SELECT count(*)::int FROM public.os_task_counts_by_client), 0, 'a client gets no task counts');
SELECT throws_ok($$SELECT * FROM public.os_user_ids_by_email(ARRAY['oc-builder@example.test'])$$, '42501', NULL,
  'a client cannot look up logins by email');

RESET role;
SELECT * FROM finish();
ROLLBACK;
