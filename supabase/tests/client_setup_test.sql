-- Client setup without a developer (migration 20261112000001, phase 4 PR 1).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Fixtures, all made up: b builder, e employee, c client login (client role), c2 a second
-- client login whose email has capitals, s a staff login, n a login with no role.
-- Clients cs-alpha (one ad account, one ClickUp folder, board rows) and cs-beta (a ClickUp
-- list only).
--
-- Checks: a client is refused all four functions; an employee reads the status counts and
-- is refused the three login functions; a builder links a client login (matching the email
-- with case and spaces ignored), is told plainly when the email is unknown, belongs to staff,
-- has no client role or is already linked, and unlinks a login; the folder count ignores a
-- ClickUp list; nothing is open to anon.

BEGIN;
SELECT plan(24);

INSERT INTO auth.users (id, email) VALUES
  ('c5e00000-0000-4000-8000-000000000001', 'cs-b@example.test'),
  ('c5e00000-0000-4000-8000-000000000002', 'cs-e@example.test'),
  ('c5e00000-0000-4000-8000-000000000003', 'cs-c@example.test'),
  ('c5e00000-0000-4000-8000-000000000004', 'CS-C2@example.test'),
  ('c5e00000-0000-4000-8000-000000000005', 'cs-s@example.test'),
  ('c5e00000-0000-4000-8000-000000000006', 'cs-n@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c5e00000-0000-4000-8000-000000000001', 'builder'),
  ('c5e00000-0000-4000-8000-000000000002', 'employee'),
  ('c5e00000-0000-4000-8000-000000000003', 'client'),
  ('c5e00000-0000-4000-8000-000000000004', 'client'),
  ('c5e00000-0000-4000-8000-000000000005', 'employee');

INSERT INTO public.ad_accounts (id, name) VALUES ('act_cs_alpha', 'CS Alpha');
INSERT INTO public.clients (slug, name, status) VALUES ('cs-alpha', 'CS Alpha', 'active'), ('cs-beta', 'CS Beta', 'active');
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_cs_alpha', 'cs-alpha');
INSERT INTO public.source_mappings (client_slug, provider, kind, external_id) VALUES
  ('cs-alpha', 'clickup', 'folder', 'cs-folder-alpha'),
  ('cs-beta', 'clickup', 'list', 'cs-list-beta');
INSERT INTO public.pipeline_tasks (clickup_task_id, client_slug, account_id, stage) VALUES ('cs-task-1', 'cs-alpha', 'act_cs_alpha', 'Editing');

-- ---------------------------------------------------------------- client (1-4)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c5e00000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$SELECT * FROM public.client_setup_status()$$, '42501', NULL, 'a client is refused the setup status');
SELECT throws_ok($$SELECT * FROM public.list_client_members('cs-alpha')$$, '42501', NULL, 'a client is refused the list of client logins');
SELECT throws_ok($$SELECT public.add_client_member('cs-alpha', 'cs-c@example.test')$$, '42501', NULL, 'a client cannot link a login to a client');
SELECT throws_ok($$SELECT public.remove_client_member('cs-alpha', 'c5e00000-0000-4000-8000-000000000003')$$, '42501', NULL, 'a client cannot unlink a login');

-- ---------------------------------------------------------------- employee (5-9)
SELECT set_config('request.jwt.claim.sub', 'c5e00000-0000-4000-8000-000000000002', true);
SELECT cmp_ok((SELECT count(*)::int FROM public.client_setup_status() WHERE client_slug IN ('cs-alpha', 'cs-beta')), '=', 2,
  'an employee reads the setup status of every client');
SELECT is((SELECT ad_account_count || '|' || clickup_folder_count || '|' || member_count || '|' || (last_clickup_sync IS NOT NULL)
             FROM public.client_setup_status() WHERE client_slug = 'cs-alpha'),
  '1|1|0|true', 'the status counts the ad account, the folder and the login, and shows the last board sync');
SELECT throws_ok($$SELECT * FROM public.list_client_members('cs-alpha')$$, '42501', NULL, 'an employee is refused the list of client logins (builder only)');
SELECT throws_ok($$SELECT public.add_client_member('cs-alpha', 'cs-c@example.test')$$, '42501', NULL, 'an employee cannot link a login (builder only)');
SELECT throws_ok($$SELECT public.remove_client_member('cs-alpha', 'c5e00000-0000-4000-8000-000000000003')$$, '42501', NULL, 'an employee cannot unlink a login (builder only)');

-- ---------------------------------------------------------------- builder (10-23)
SELECT set_config('request.jwt.claim.sub', 'c5e00000-0000-4000-8000-000000000001', true);
SELECT is(public.add_client_member('cs-alpha', '  CS-c@Example.test '), 'c5e00000-0000-4000-8000-000000000003'::uuid,
  'a builder links a client login, matching the email with case and spaces ignored');
SELECT is((SELECT string_agg(email, ',') FROM public.list_client_members('cs-alpha')), 'cs-c@example.test', 'the login shows in the list with its email');
SELECT throws_ok($$SELECT public.add_client_member('cs-alpha', 'cs-c@example.test')$$, '23505', NULL, 'linking the same login twice is refused');
SELECT throws_ok($$SELECT public.add_client_member('cs-alpha', 'cs-s@example.test')$$, '22023', NULL, 'a staff login is not linked to a client');
SELECT throws_ok($$SELECT public.add_client_member('cs-alpha', 'cs-n@example.test')$$, '22023', NULL, 'a login with no role is not linked until it is a client login');
SELECT throws_ok($$SELECT public.add_client_member('cs-alpha', 'nobody@example.test')$$, 'P0002', NULL, 'an email with no login is refused with a plain message');
SELECT throws_ok($$SELECT public.add_client_member('cs-alpha', 'not an email')$$, '22023', NULL, 'something that is not an email is refused');
SELECT throws_ok($$SELECT public.add_client_member('cs-nope', 'cs-c@example.test')$$, 'P0002', NULL, 'an unknown client is refused');
SELECT lives_ok($$SELECT public.add_client_member('cs-alpha', 'cs-c2@example.test')$$, 'a login whose email has capitals links by its lower case email');
SELECT is((SELECT member_count FROM public.client_setup_status() WHERE client_slug = 'cs-alpha'), 2, 'the status counts both logins');
SELECT lives_ok($$SELECT public.remove_client_member('cs-alpha', 'c5e00000-0000-4000-8000-000000000003')$$, 'a builder unlinks a login');
SELECT throws_ok($$SELECT public.remove_client_member('cs-alpha', 'c5e00000-0000-4000-8000-000000000003')$$, 'P0002', NULL, 'unlinking a login that is not linked is refused');
SELECT is((SELECT member_count FROM public.client_setup_status() WHERE client_slug = 'cs-alpha'), 1, 'the status counts one login after the unlink');
SELECT is((SELECT clickup_folder_count FROM public.client_setup_status() WHERE client_slug = 'cs-beta'), 0,
  'a ClickUp list does not count as a linked folder');

-- ---------------------------------------------------------------- grants (24)
RESET role;
SELECT is((SELECT bool_or(has_function_privilege('anon', f, 'EXECUTE')) FROM unnest(ARRAY[
    'public.client_setup_status()', 'public.list_client_members(text)',
    'public.add_client_member(text, text)', 'public.remove_client_member(text, uuid)']) f),
  false, 'anon cannot execute any of the four functions');

SELECT * FROM finish();
ROLLBACK;
