-- Goodo OS timer and weekly log (migration 20261124080001, story OS-012).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: starting from a task records the task and its client; a second start stops the first
-- (one running, the first has an end); client or Internal time with no category is refused, as
-- is time with no task, client or Internal; a read-only task is refused; a client and a login
-- with no role are refused; stop works and is a no-op with nothing running; time_my_person()
-- creates and links a member's row by email; a member adds, edits and deletes their own manual
-- entries and cannot touch another person's; rows copied from Goodo Time are exempt from the
-- new rule. All rows are made up.
--
-- now() is fixed for the whole transaction, so the tests move a running entry's start back an
-- hour before starting the next one, as real starts happen in separate requests.

BEGIN;
SELECT plan(30);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e9100000-0000-4000-8000-000000000001', 'tm-builder@example.test', '{}'),
  ('e9100000-0000-4000-8000-000000000002', 'TM-Alice@Example.test', '{"full_name": "Alice Tm"}'),
  ('e9100000-0000-4000-8000-000000000003', 'tm-bob@example.test', '{}'),
  ('e9100000-0000-4000-8000-000000000004', 'tm-client@example.test', '{}'),
  ('e9100000-0000-4000-8000-000000000005', 'tm-nobody@example.test', '{}');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e9100000-0000-4000-8000-000000000001', 'builder'),
  ('e9100000-0000-4000-8000-000000000002', 'employee'),
  ('e9100000-0000-4000-8000-000000000003', 'employee'),
  ('e9100000-0000-4000-8000-000000000004', 'client');

-- Bob already has a person row (copied from Goodo Time, not linked yet). Alice has none.
INSERT INTO public.time_people (id, email, name, user_id) VALUES
  ('e9200000-0000-4000-8000-000000000003', 'tm-bob@example.test', 'Bob', NULL);

INSERT INTO public.clients (slug, name, status) VALUES ('tm-alpha', 'TM Alpha', 'active');
INSERT INTO public.os_tasks (id, client_slug, title, read_only) VALUES
  ('e9300000-0000-4000-8000-000000000001', 'tm-alpha', 'TM Cut v1', false),
  ('e9300000-0000-4000-8000-000000000002', 'tm-alpha', 'TM Hooks', false),
  ('e9300000-0000-4000-8000-000000000003', 'tm-alpha', 'TM Old task', true);

-- ---------------------------------------------------------------- structure
SELECT ok(has_function_privilege('authenticated', 'public.time_start_timer(uuid, text, boolean, text, text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.time_start_timer(uuid, text, boolean, text, text)', 'EXECUTE'),
  'signed-in users may call time_start_timer, anon may not');
SELECT ok(NOT has_function_privilege('anon', 'public.time_stop_timer()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.time_my_person()', 'EXECUTE'),
  'anon may not call time_stop_timer or time_my_person');

-- A row copied from Goodo Time needs no task, client or category.
SELECT lives_ok($$INSERT INTO public.time_entries (person_id, description, start_at, end_at, source_id)
  VALUES ('e9200000-0000-4000-8000-000000000003', 'Copied', '2026-10-01 09:00Z', '2026-10-01 10:00Z', 990001)$$,
  'a row copied from Goodo Time is exempt from the purpose rule');
SELECT throws_ok($$INSERT INTO public.time_entries (person_id, description, start_at, end_at)
  VALUES ('e9200000-0000-4000-8000-000000000003', 'No purpose', '2026-10-02 09:00Z', '2026-10-02 10:00Z')$$,
  '23514', NULL, 'an app-made row with no task, client or Internal is refused');
SELECT throws_ok($$INSERT INTO public.time_entries (person_id, category, start_at, end_at)
  VALUES ('e9200000-0000-4000-8000-000000000003', 'Gardening', '2026-10-02 09:00Z', '2026-10-02 10:00Z')$$,
  '23514', NULL, 'a category outside the list is refused');

-- ---------------------------------------------------------------- Alice starts from a task
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'e9100000-0000-4000-8000-000000000002', true);

SELECT lives_ok($$SELECT public.time_start_timer('e9300000-0000-4000-8000-000000000001', NULL, false, NULL, 'first pass')$$,
  'an employee with no person row starts a timer on a task');
SELECT is((SELECT email || '|' || name || '|' || user_id::text FROM public.time_people),
  'tm-alice@example.test|Alice Tm|e9100000-0000-4000-8000-000000000002',
  'her person row is created with her lower-case email and linked to her login');
SELECT is((SELECT task_id::text || '|' || client_slug || '|' || is_internal::text FROM public.time_entries WHERE end_at IS NULL),
  'e9300000-0000-4000-8000-000000000001|tm-alpha|false',
  'the running entry records the task and the task''s client');

-- Move the first start back an hour, then start a second timer.
RESET role;
UPDATE public.time_entries SET start_at = now() - interval '1 hour' WHERE description = 'first pass';
SET LOCAL role authenticated;
SELECT lives_ok($$SELECT public.time_start_timer('e9300000-0000-4000-8000-000000000002', NULL, false, NULL, '')$$,
  'starting a second timer works');
SELECT is((SELECT count(*)::int FROM public.time_entries WHERE end_at IS NULL), 1, 'only one timer runs');
SELECT is((SELECT task_id::text FROM public.time_entries WHERE end_at IS NULL), 'e9300000-0000-4000-8000-000000000002',
  'the running timer is the second task');
SELECT is((SELECT end_at FROM public.time_entries WHERE description = 'first pass'), now(),
  'the first timer ended when the second started');

-- Refusals.
SELECT throws_ok($$SELECT public.time_start_timer(NULL, NULL, true, NULL, '')$$, '23514', NULL,
  'Internal time with no category is refused');
SELECT throws_ok($$SELECT public.time_start_timer(NULL, 'tm-alpha', false, '', '')$$, '23514', NULL,
  'client time with no category is refused');
SELECT throws_ok($$SELECT public.time_start_timer(NULL, NULL, false, 'Admin', '')$$, '23514', NULL,
  'time with no task, client or Internal is refused');
SELECT throws_ok($$SELECT public.time_start_timer(NULL, 'tm-alpha', true, 'Admin', '')$$, '23514', NULL,
  'a client and Internal together are refused');
SELECT throws_ok($$SELECT public.time_start_timer('e9300000-0000-4000-8000-000000000003', NULL, false, NULL, '')$$,
  '42501', NULL, 'a read-only task is refused');
SELECT is((SELECT task_id::text FROM public.time_entries WHERE end_at IS NULL), 'e9300000-0000-4000-8000-000000000002',
  'a refused start leaves the running timer alone');

-- Stop.
RESET role;
UPDATE public.time_entries SET start_at = now() - interval '30 minutes' WHERE end_at IS NULL;
SET LOCAL role authenticated;
SELECT is((SELECT (public.time_stop_timer()).end_at), now(), 'stop ends the running timer now');
SELECT is((SELECT count(*)::int FROM public.time_entries WHERE end_at IS NULL), 0, 'nothing runs after stop');
SELECT ok((SELECT (public.time_stop_timer()).id IS NULL), 'stop with nothing running returns nothing');

-- ---------------------------------------------------------------- manual entries
SELECT lives_ok($$INSERT INTO public.time_entries (person_id, client_slug, category, description, start_at, end_at)
  VALUES (public.time_my_person(), 'tm-alpha', 'Strategy', 'Manual', '2026-11-02 09:00Z', '2026-11-02 10:30Z')$$,
  'a member adds a manual client entry with a category');
SELECT lives_ok($$UPDATE public.time_entries SET end_at = '2026-11-02 11:00Z' WHERE description = 'Manual'$$,
  'a member edits her own entry');
SELECT is((SELECT end_at FROM public.time_entries WHERE description = 'Manual'), '2026-11-02 11:00Z'::timestamptz,
  'the edit is saved');
SELECT throws_ok($$INSERT INTO public.time_entries (person_id, is_internal, category, start_at, end_at)
  VALUES ('e9200000-0000-4000-8000-000000000003', true, 'Admin', '2026-11-02 09:00Z', '2026-11-02 10:00Z')$$,
  '42501', NULL, 'a member cannot add time for another person');
UPDATE public.time_entries SET description = 'changed by Alice' WHERE description = 'Copied';
DELETE FROM public.time_entries WHERE description = 'Copied';
SELECT lives_ok($$DELETE FROM public.time_entries WHERE description = 'Manual'$$, 'a member deletes her own entry');

-- Bob links to his copied row and sees it untouched by Alice.
SELECT set_config('request.jwt.claim.sub', 'e9100000-0000-4000-8000-000000000003', true);
SELECT is(public.time_my_person(), 'e9200000-0000-4000-8000-000000000003'::uuid,
  'time_my_person links the copied row with the same email');
SELECT is((SELECT string_agg(description, ',') FROM public.time_entries), 'Copied',
  'another member''s entry was neither changed nor deleted by Alice');

-- ---------------------------------------------------------------- client and no role
SELECT set_config('request.jwt.claim.sub', 'e9100000-0000-4000-8000-000000000004', true);
SELECT throws_ok($$SELECT public.time_start_timer('e9300000-0000-4000-8000-000000000001', NULL, false, NULL, '')$$,
  '42501', NULL, 'a client cannot start a timer');
SELECT set_config('request.jwt.claim.sub', 'e9100000-0000-4000-8000-000000000005', true);
SELECT throws_ok($$SELECT public.time_my_person()$$, '42501', NULL, 'a login with no role gets no person row');

SELECT * FROM finish();
ROLLBACK;
