-- Invites that send: the record of who invited whom (migration 20261112000002, phase 4 PR 2).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Fixtures, all made up: b builder (profile name "Bea Builder"), e employee, c client login,
-- w a login invited and not yet accepted (email not confirmed), a a login that accepted
-- (email confirmed). Invites exist for w, a and a person with no login.
--
-- Checks: row rules on, nothing for anon or public, signed-in users only read; a client and an
-- employee read no invite and are refused the list function; a builder reads the log with the
-- current state of each invite (waiting, accepted, no login any more) and the inviter's name;
-- nobody writes from the browser; one open invite per email, a revoked one does not block a
-- new one; the role and client rule and the lower case email rule; the login lookup is for the
-- service role only and answers confirmed or not.

BEGIN;
SELECT plan(24);

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b7100000-0000-4000-8000-000000000001', 'ui-b@example.test', now()),
  ('b7100000-0000-4000-8000-000000000002', 'ui-e@example.test', now()),
  ('b7100000-0000-4000-8000-000000000003', 'ui-c@example.test', now()),
  ('b7100000-0000-4000-8000-000000000004', 'ui-w@example.test', NULL),
  ('b7100000-0000-4000-8000-000000000005', 'ui-a@example.test', now());
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b7100000-0000-4000-8000-000000000001', 'builder'),
  ('b7100000-0000-4000-8000-000000000002', 'employee'),
  ('b7100000-0000-4000-8000-000000000003', 'client'),
  ('b7100000-0000-4000-8000-000000000004', 'employee'),
  ('b7100000-0000-4000-8000-000000000005', 'client');
UPDATE public.profiles SET display_name = 'Bea Builder' WHERE user_id = 'b7100000-0000-4000-8000-000000000001';
INSERT INTO public.clients (slug, name, status) VALUES ('ui-alpha', 'UI Alpha', 'active');

INSERT INTO public.user_invites (id, email, display_name, role, client_slug, invited_user_id, invited_by) VALUES
  ('b7200000-0000-4000-8000-000000000001', 'ui-w@example.test', 'Wren Waiting', 'employee', NULL, 'b7100000-0000-4000-8000-000000000004', 'b7100000-0000-4000-8000-000000000001'),
  ('b7200000-0000-4000-8000-000000000002', 'ui-a@example.test', 'Avery Accepted', 'client', 'ui-alpha', 'b7100000-0000-4000-8000-000000000005', 'b7100000-0000-4000-8000-000000000001'),
  ('b7200000-0000-4000-8000-000000000003', 'ui-gone@example.test', 'Gale Gone', 'employee', NULL, NULL, 'b7100000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------- structure (1-3)
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_invites'::regclass), 'row rules are on for user_invites');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'user_invites' AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on user_invites');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'user_invites' AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read user_invites; the invite-user function writes');

-- ---------------------------------------------------------------- client (4-6)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'b7100000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.user_invites), 0, 'a client reads no invites');
SELECT throws_ok($$SELECT * FROM public.list_user_invites()$$, '42501', NULL, 'a client is refused the invite list');
SELECT throws_ok($$INSERT INTO public.user_invites (email, display_name, role, invited_by) VALUES ('x@example.test', 'X', 'employee', 'b7100000-0000-4000-8000-000000000003')$$,
  '42501', NULL, 'a client cannot write an invite');

-- ---------------------------------------------------------------- employee (7-9)
SELECT set_config('request.jwt.claim.sub', 'b7100000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.user_invites), 0, 'an employee reads no invites');
SELECT throws_ok($$SELECT * FROM public.list_user_invites()$$, '42501', NULL, 'an employee is refused the invite list (builder only)');
SELECT throws_ok($$INSERT INTO public.user_invites (email, display_name, role, invited_by) VALUES ('x@example.test', 'X', 'employee', 'b7100000-0000-4000-8000-000000000002')$$,
  '42501', NULL, 'an employee cannot write an invite');

-- ---------------------------------------------------------------- builder (10-14)
SELECT set_config('request.jwt.claim.sub', 'b7100000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.user_invites), 3, 'a builder reads the invites');
SELECT is((SELECT string_agg(email || ':' || accepted || ':' || login_exists, ',' ORDER BY email) FROM public.list_user_invites()),
  'ui-a@example.test:true:true,ui-gone@example.test:false:false,ui-w@example.test:false:true',
  'the list shows waiting, accepted and no-login-any-more invites');
SELECT is((SELECT DISTINCT invited_by_name FROM public.list_user_invites()), 'Bea Builder', 'the list names the person who invited');
SELECT is((SELECT role || ':' || coalesce(client_slug, '-') FROM public.list_user_invites() WHERE email = 'ui-a@example.test'), 'client:ui-alpha', 'a client invite carries its client');
SELECT throws_ok($$UPDATE public.user_invites SET status = 'revoked', revoked_at = now() WHERE email = 'ui-w@example.test'$$, '42501', NULL,
  'even a builder cannot change an invite from the browser');

-- ---------------------------------------------------------------- rules (15-19)
RESET role;
SELECT throws_ok($$INSERT INTO public.user_invites (email, display_name, role, invited_by) VALUES ('ui-w@example.test', 'Dup', 'employee', 'b7100000-0000-4000-8000-000000000001')$$,
  '23505', NULL, 'there is one open invite per email');
UPDATE public.user_invites SET status = 'revoked', revoked_at = now(), revoked_by = 'b7100000-0000-4000-8000-000000000001' WHERE email = 'ui-gone@example.test';
SELECT lives_ok($$INSERT INTO public.user_invites (email, display_name, role, invited_by) VALUES ('ui-gone@example.test', 'Gale Again', 'employee', 'b7100000-0000-4000-8000-000000000001')$$,
  'a revoked invite does not block a new one');
SELECT throws_ok($$INSERT INTO public.user_invites (email, display_name, role, invited_by) VALUES ('ui-new@example.test', 'No Client', 'client', 'b7100000-0000-4000-8000-000000000001')$$,
  '23514', NULL, 'a client invite needs its client');
SELECT throws_ok($$INSERT INTO public.user_invites (email, display_name, role, client_slug, invited_by) VALUES ('ui-new@example.test', 'Staff With Client', 'employee', 'ui-alpha', 'b7100000-0000-4000-8000-000000000001')$$,
  '23514', NULL, 'a staff invite carries no client');
SELECT throws_ok($$INSERT INTO public.user_invites (email, display_name, role, invited_by) VALUES ('UI-Caps@example.test', 'Caps', 'employee', 'b7100000-0000-4000-8000-000000000001')$$,
  '23514', NULL, 'the email is stored in lower case');

-- ---------------------------------------------------------------- the login lookup (20-24)
SELECT is((SELECT confirmed FROM public.invite_login_state('  UI-W@example.test ')), false, 'an invited login that is not confirmed yet answers false (case and spaces ignored)');
SELECT is((SELECT confirmed FROM public.invite_login_state('ui-a@example.test')), true, 'a confirmed login answers true');
SELECT is((SELECT count(*)::int FROM public.invite_login_state('nobody@example.test')), 0, 'an email with no login answers nothing');
SELECT ok(NOT has_function_privilege('authenticated', 'public.invite_login_state(text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.invite_login_state(text)', 'EXECUTE'),
  'only the service role can look up a login by email');
DELETE FROM auth.users WHERE id = 'b7100000-0000-4000-8000-000000000004';
SELECT is((SELECT invited_user_id IS NULL FROM public.user_invites WHERE email = 'ui-w@example.test'), true,
  'removing a login keeps the invite record and clears its link');

SELECT * FROM finish();
ROLLBACK;
