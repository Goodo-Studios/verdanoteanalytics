-- Goodo OS: comment threads (migration 20261121080001, story OS-008).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: grants (no anon, signed-in users read the table only and write through the function);
-- ClickUp comments land in the internal thread and can never be client; staff (builder, employee)
-- read and post in both threads; a client reads and posts only in the client thread of their own
-- client's visible task, and internal comments are never returned to a client login, neither by
-- list_task_comments nor by a direct select; another client's login and a login with no role get
-- nothing; read-only tasks refuse comments; body and mention rules; one mention notification per
-- mentioned person, never the author, readable only by its owner. All rows are made up.

BEGIN;
SELECT plan(48);

INSERT INTO auth.users (id, email) VALUES
  ('e8100000-0000-4000-8000-000000000001', 'ct-builder@example.test'),
  ('e8100000-0000-4000-8000-000000000002', 'ct-employee@example.test'),
  ('e8100000-0000-4000-8000-000000000003', 'ct-client@example.test'),
  ('e8100000-0000-4000-8000-000000000004', 'ct-client2@example.test'),
  ('e8100000-0000-4000-8000-000000000005', 'ct-other@example.test'),
  ('e8100000-0000-4000-8000-000000000006', 'ct-norole@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e8100000-0000-4000-8000-000000000001', 'builder'),
  ('e8100000-0000-4000-8000-000000000002', 'employee'),
  ('e8100000-0000-4000-8000-000000000003', 'client'),
  ('e8100000-0000-4000-8000-000000000004', 'client'),
  ('e8100000-0000-4000-8000-000000000005', 'client');
INSERT INTO public.clients (slug, name, status) VALUES ('ct-alpha', 'CT Alpha', 'active'), ('ct-beta', 'CT Beta', 'active');
INSERT INTO public.client_members (user_id, client_slug) VALUES
  ('e8100000-0000-4000-8000-000000000003', 'ct-alpha'),
  ('e8100000-0000-4000-8000-000000000004', 'ct-alpha'),
  ('e8100000-0000-4000-8000-000000000005', 'ct-beta');
-- A client login linked to ct-alpha through an ad account only, with no client_members row.
INSERT INTO auth.users (id, email) VALUES ('e8100000-0000-4000-8000-000000000007', 'ct-adclient@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('e8100000-0000-4000-8000-000000000007', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_ct_alpha', 'CT Alpha Meta');
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_ct_alpha', 'ct-alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('e8100000-0000-4000-8000-000000000007', 'act_ct_alpha');

-- a: alpha app task. ro: alpha read-only asset. n: alpha ClickUp non-asset (meeting call). b: beta task.
INSERT INTO public.os_tasks (id, client_slug, title, clickup_task_id, clickup_list_id, is_asset, read_only) VALUES
  ('e8200000-0000-4000-8000-00000000000a', 'ct-alpha', 'CT Asset A', NULL, NULL, false, false),
  ('e8200000-0000-4000-8000-0000000000a0', 'ct-alpha', 'CT Old Asset', 'cu-ct-ro', 'l-pv', true, true),
  ('e8200000-0000-4000-8000-0000000000c0', 'ct-alpha', 'CT Kickoff call', 'cu-ct-n', 'l-calls', false, false),
  ('e8200000-0000-4000-8000-00000000000b', 'ct-beta', 'CT Asset B', NULL, NULL, false, false);

-- The ClickUp sync writes comments without naming a thread.
INSERT INTO public.os_task_comments (task_id, clickup_comment_id, author, body, created_at)
VALUES ('e8200000-0000-4000-8000-00000000000a', 'cm-ct-1', '{"username":"Pat"}', 'Internal ClickUp note', now() - interval '1 day');

-- ---------------------------------------------------------------- structure (1-9)
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'notifications'
              AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on notifications');
SELECT is((SELECT count(*)::int FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'os_task_comments'
              AND column_name IN ('thread', 'author_user_id', 'mentions')), 3,
  'os_task_comments has thread, author_user_id and mentions');
SELECT ok(NOT has_function_privilege('anon', 'public.post_task_comment(uuid,text,text,uuid[])', 'EXECUTE'),
  'anon cannot post comments');
SELECT ok(NOT has_function_privilege('anon', 'public.list_task_comments(uuid)', 'EXECUTE'),
  'anon cannot list comments');
SELECT ok(has_function_privilege('authenticated', 'public.post_task_comment(uuid,text,text,uuid[])', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.list_task_comments(uuid)', 'EXECUTE'),
  'signed-in users can call post and list (the functions check the caller)');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'os_task_comments'
              AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on os_task_comments');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'os_task_comments'
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users can only read os_task_comments directly');
SELECT is((SELECT thread FROM public.os_task_comments WHERE clickup_comment_id = 'cm-ct-1'), 'internal',
  'a ClickUp comment lands in the internal thread');
SELECT throws_ok($$INSERT INTO public.os_task_comments (task_id, clickup_comment_id, thread, body)
                   VALUES ('e8200000-0000-4000-8000-00000000000a', 'cm-ct-2', 'client', 'x')$$,
  '23514', NULL, 'a ClickUp comment can never be in the client thread');

-- ---------------------------------------------------------------- builder (9-18)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000001', true);

SELECT lives_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'internal',
                   '  Internal note from builder  ', ARRAY['e8100000-0000-4000-8000-000000000002']::uuid[])$$,
  'a builder posts in the internal thread and mentions an employee');
SELECT is((SELECT body FROM public.os_task_comments WHERE author_user_id = 'e8100000-0000-4000-8000-000000000001' AND thread = 'internal'),
  'Internal note from builder', 'the body is trimmed');
SELECT lives_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'client', 'Cut is ready',
                   ARRAY['e8100000-0000-4000-8000-000000000003', 'e8100000-0000-4000-8000-000000000001']::uuid[])$$,
  'a builder posts in the client thread, mentioning a client member and themselves');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'internal', 'Hi',
                   ARRAY['e8100000-0000-4000-8000-000000000003']::uuid[])$$,
  '22023', NULL, 'staff cannot mention a client member in the internal thread');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'client', 'Hi',
                   ARRAY['e8100000-0000-4000-8000-000000000005']::uuid[])$$,
  '22023', NULL, 'staff cannot mention a member of another client');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'internal', '   ')$$,
  '22023', NULL, 'an empty comment is refused');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'internal', repeat('x', 10001))$$,
  '22023', NULL, 'a comment over 10000 characters is refused');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'public', 'Hi')$$,
  '22023', NULL, 'an unknown thread is refused');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-0000000000a0', 'internal', 'Hi')$$,
  '42501', NULL, 'nobody comments on a read-only task, not even a builder');
SELECT is((SELECT count(*)::int FROM public.list_task_comments('e8200000-0000-4000-8000-00000000000a')), 3,
  'a builder lists both threads, including the ClickUp comment');

-- ---------------------------------------------------------------- employee (19-22)
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000002', true);

SELECT lives_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'internal', 'On it',
                   ARRAY['e8100000-0000-4000-8000-000000000001']::uuid[])$$,
  'an employee posts in the internal thread and mentions the builder');
SELECT is((SELECT count(*)::int FROM public.list_task_comments('e8200000-0000-4000-8000-00000000000a')), 4,
  'an employee lists both threads');
SELECT is((SELECT count(*)::int FROM public.os_task_comments WHERE task_id = 'e8200000-0000-4000-8000-00000000000a'), 4,
  'staff read comments directly');
SELECT throws_ok($$INSERT INTO public.os_task_comments (task_id, thread, body) VALUES ('e8200000-0000-4000-8000-00000000000a', 'internal', 'x')$$,
  '42501', NULL, 'staff cannot write the table directly');

-- ---------------------------------------------------------------- client (23-33)
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.list_task_comments('e8200000-0000-4000-8000-00000000000a')), 1,
  'a client lists only the client thread of their own task');
SELECT is((SELECT count(*)::int FROM public.list_task_comments('e8200000-0000-4000-8000-00000000000a') WHERE thread = 'internal'), 0,
  'PROOF: list_task_comments never returns an internal comment to a client login');
SELECT is((SELECT count(*)::int FROM public.os_task_comments), 0,
  'PROOF: a client login reads no comment rows directly, internal or client');
SELECT is((SELECT count(*)::int FROM public.notifications WHERE type = 'mention' AND task_id = 'e8200000-0000-4000-8000-00000000000a'), 1,
  'a mentioned client member gets one notification');
SELECT lives_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'client', 'Looks great',
                   ARRAY['e8100000-0000-4000-8000-000000000002', 'e8100000-0000-4000-8000-000000000004']::uuid[])$$,
  'a client posts in the client thread, mentioning staff and a member of the same client');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'internal', 'Hi')$$,
  '42501', NULL, 'a client cannot post in the internal thread');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'client', 'Hi',
                   ARRAY['e8100000-0000-4000-8000-000000000005']::uuid[])$$,
  '22023', NULL, 'a client cannot mention a member of another client');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-0000000000a0', 'client', 'Hi')$$,
  '42501', NULL, 'a client cannot comment on a read-only task');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-0000000000c0', 'client', 'Hi')$$,
  '42501', NULL, 'a client cannot comment on a ClickUp task that is not an asset task');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000b', 'client', 'Hi')$$,
  '42501', NULL, 'a client cannot comment on another client''s task');
SELECT is((SELECT string_agg(thread, ',') FROM public.list_task_comments('e8200000-0000-4000-8000-00000000000a')), 'client,client',
  'after posting, a client still sees only client-thread comments');

-- ---------------------------------------------------------------- notifications (34-36)
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.notifications WHERE type = 'mention'), 2,
  'the employee gets one notification per mention (builder and client)');
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.notifications WHERE type = 'mention'), 1,
  'the builder is notified by the employee, not by mentioning themselves');
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.notifications), 1,
  'the second client member sees only their own notification');

-- ---------------------------------------------------------------- other client (37-39)
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000005', true);
SELECT is((SELECT count(*)::int FROM public.list_task_comments('e8200000-0000-4000-8000-00000000000a')), 0,
  'another client''s login lists nothing on this task');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'client', 'Hi')$$,
  '42501', NULL, 'another client''s login cannot post on this task');
SELECT is((SELECT count(*)::int FROM public.notifications), 0,
  'another client''s login sees no one else''s notifications');

-- ---------------------------------------------------------------- no role (40-42)
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000006', true);
SELECT is((SELECT count(*)::int FROM public.list_task_comments('e8200000-0000-4000-8000-00000000000a')), 0,
  'a login with no role lists nothing');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'client', 'Hi')$$,
  '42501', NULL, 'a login with no role cannot post');
SELECT is((SELECT count(*)::int FROM public.os_task_comments), 0,
  'a login with no role reads no comment rows');

-- ---------------------------------------------------------------- ad-account client (fix 20261121080002)
RESET role;
SELECT ok(NOT has_function_privilege('authenticated', 'public.os_user_client_slugs(uuid)', 'EXECUTE'),
  'the client-membership helper is not callable from the browser');
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'e8100000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'client', 'Ready for you',
                   ARRAY['e8100000-0000-4000-8000-000000000007']::uuid[])$$,
  'staff can mention a client linked to the task''s client through an ad account');
RESET role;
SELECT is((SELECT count(*)::int FROM public.notifications
            WHERE user_id = 'e8100000-0000-4000-8000-000000000007' AND type = 'mention'), 1,
  'the ad-account client gets the mention notification');

-- ---------------------------------------------------------------- anon (43-44)
RESET role;
SET LOCAL role anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok($$SELECT * FROM public.list_task_comments('e8200000-0000-4000-8000-00000000000a')$$,
  '42501', NULL, 'anon cannot call list_task_comments');
SELECT throws_ok($$SELECT public.post_task_comment('e8200000-0000-4000-8000-00000000000a', 'client', 'Hi')$$,
  '42501', NULL, 'anon cannot call post_task_comment');

RESET role;
SELECT * FROM finish();
ROLLBACK;
