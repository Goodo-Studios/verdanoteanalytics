-- Deactivated staff lose access, and role mapping needs a confirmed email
-- (migrations 20261208100001 and 20261208100002).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: deactivating a team list member (through update_team_member and through a direct
-- update) removes the builder or employee role of the login with the same email, so has_role
-- and the staff functions refuse it; reactivating gives the mapped role back to a confirmed
-- login; the client role is never removed or granted; a second active row with the same email
-- keeps the role; a login with an unconfirmed email never gets a role from the mapping
-- (apply_app_user_role_mapping, app_user_role_mapping, goodo_os_user_role_plan) until it is
-- confirmed. All people are made up.

BEGIN;
SELECT plan(26);

-- b builder, e employee (producer), k builder (admin, direct update path), c client (viewer),
-- u producer whose login email is not confirmed, d employee with two active rows for one email,
-- n producer with an unconfirmed login and no role, g Goodo OS staff user with an unconfirmed login.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('5d000000-0000-4000-8000-000000000001', 'b@sd.example.test', now()),
  ('5d000000-0000-4000-8000-000000000002', 'e@sd.example.test', now()),
  ('5d000000-0000-4000-8000-000000000003', 'k@sd.example.test', now()),
  ('5d000000-0000-4000-8000-000000000004', 'c@sd.example.test', now()),
  ('5d000000-0000-4000-8000-000000000006', 'd@sd.example.test', now());
INSERT INTO auth.users (id, email) VALUES
  ('5d000000-0000-4000-8000-000000000005', 'u@sd.example.test'),
  ('5d000000-0000-4000-8000-000000000007', 'n@sd.example.test'),
  ('5d000000-0000-4000-8000-000000000008', 'g@sd.example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('5d000000-0000-4000-8000-000000000001', 'builder'),
  ('5d000000-0000-4000-8000-000000000002', 'employee'),
  ('5d000000-0000-4000-8000-000000000003', 'builder'),
  ('5d000000-0000-4000-8000-000000000004', 'client'),
  ('5d000000-0000-4000-8000-000000000006', 'employee');
INSERT INTO public.app_users (id, name, email, role, active) VALUES
  ('5d100000-0000-4000-8000-000000000002', 'E', 'e@sd.example.test', 'producer', true),
  ('5d100000-0000-4000-8000-000000000003', 'K', 'k@sd.example.test', 'admin', true),
  ('5d100000-0000-4000-8000-000000000004', 'C', 'c@sd.example.test', 'viewer', true),
  ('5d100000-0000-4000-8000-000000000005', 'U', 'u@sd.example.test', 'producer', true),
  ('5d100000-0000-4000-8000-000000000006', 'D1', 'd@sd.example.test', 'producer', true),
  ('5d100000-0000-4000-8000-000000000016', 'D2', 'D@sd.example.test', 'producer', true),
  ('5d100000-0000-4000-8000-000000000007', 'N', 'n@sd.example.test', 'producer', true);
INSERT INTO public.goodo_os_workspace_users (id, email, role, active)
VALUES ('gos-sd-g', 'g@sd.example.test', 'staff', true);

-- ---------------------------------------------------------------- deactivation (1-9)
SELECT ok(public.has_role('5d000000-0000-4000-8000-000000000002', 'employee'::public.app_role), 'the employee starts with the role');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '5d000000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$SELECT public.update_team_member('5d100000-0000-4000-8000-000000000002', 'E', 'producer', false)$$,
  'a builder deactivates the employee on the team page');
RESET role;
SELECT ok(NOT public.has_role('5d000000-0000-4000-8000-000000000002', 'employee'::public.app_role), 'the deactivated login no longer has the employee role');
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE user_id = '5d000000-0000-4000-8000-000000000002'), 0, 'the staff role row is gone');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '5d000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT * FROM public.app_user_role_mapping()$$, '42501', NULL, 'a staff function refuses the deactivated login');
SELECT is((SELECT count(*)::int FROM public.app_users), 0, 'the deactivated login reads no team list (row rule)');
SELECT set_config('request.jwt.claim.sub', '5d000000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$SELECT public.update_team_member('5d100000-0000-4000-8000-000000000002', 'E', 'producer', true)$$,
  'a builder reactivates the employee');
RESET role;
SELECT ok(public.has_role('5d000000-0000-4000-8000-000000000002', 'employee'::public.app_role), 'reactivation gives the mapped employee role back');
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE user_id = '5d000000-0000-4000-8000-000000000002'), 1, 'and only that role');

-- ---------------------------------------------------------------- direct update, client, duplicates (10-16)
UPDATE public.app_users SET active = false WHERE id = '5d100000-0000-4000-8000-000000000003';
SELECT ok(NOT public.has_role('5d000000-0000-4000-8000-000000000003', 'builder'::public.app_role), 'a direct update of active also removes the builder role');
UPDATE public.app_users SET active = true WHERE id = '5d100000-0000-4000-8000-000000000003';
SELECT ok(public.has_role('5d000000-0000-4000-8000-000000000003', 'builder'::public.app_role), 'and a direct reactivation restores it');

UPDATE public.app_users SET active = false WHERE id = '5d100000-0000-4000-8000-000000000004';
UPDATE public.app_users SET active = true WHERE id = '5d100000-0000-4000-8000-000000000004';
SELECT is((SELECT string_agg(role::text, ',') FROM public.user_roles WHERE user_id = '5d000000-0000-4000-8000-000000000004'), 'client',
  'a client login keeps exactly the client role through deactivation and reactivation');

UPDATE public.app_users SET active = false WHERE id = '5d100000-0000-4000-8000-000000000006';
SELECT ok(public.has_role('5d000000-0000-4000-8000-000000000006', 'employee'::public.app_role),
  'a second active row for the same email keeps the role');
UPDATE public.app_users SET active = false WHERE id = '5d100000-0000-4000-8000-000000000016';
SELECT ok(NOT public.has_role('5d000000-0000-4000-8000-000000000006', 'employee'::public.app_role),
  'the role goes when the last active row for the email is deactivated');

UPDATE public.app_users SET active = false WHERE id = '5d100000-0000-4000-8000-000000000005';
UPDATE public.app_users SET active = true WHERE id = '5d100000-0000-4000-8000-000000000005';
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE user_id = '5d000000-0000-4000-8000-000000000005'), 0,
  'reactivation gives nothing to a login whose email is not confirmed');
UPDATE auth.users SET email_confirmed_at = now() WHERE id = '5d000000-0000-4000-8000-000000000005';
UPDATE public.app_users SET active = false WHERE id = '5d100000-0000-4000-8000-000000000005';
UPDATE public.app_users SET active = true WHERE id = '5d100000-0000-4000-8000-000000000005';
SELECT ok(public.has_role('5d000000-0000-4000-8000-000000000005', 'employee'::public.app_role),
  'once the email is confirmed, reactivation restores the mapped role');

-- ---------------------------------------------------------------- confirmed email (17-26)
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE user_id = '5d000000-0000-4000-8000-000000000007'), 0, 'the unconfirmed login starts with no role');
SELECT public.apply_app_user_role_mapping();
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE user_id = '5d000000-0000-4000-8000-000000000007'), 0,
  'apply_app_user_role_mapping gives no role to an unconfirmed email');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '5d000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT verdanote_user_id FROM public.app_user_role_mapping() WHERE email = 'n@sd.example.test'), NULL::uuid,
  'the preview shows no login for an unconfirmed email');
RESET role;
SELECT is((SELECT action FROM public.goodo_os_user_role_plan() WHERE workspace_user_id = 'gos-sd-g'), 'no_login',
  'the Goodo OS plan treats an unconfirmed email as no login');

UPDATE auth.users SET email_confirmed_at = now() WHERE id IN ('5d000000-0000-4000-8000-000000000007', '5d000000-0000-4000-8000-000000000008');
SELECT is((SELECT action FROM public.goodo_os_user_role_plan() WHERE workspace_user_id = 'gos-sd-g'), 'add_role',
  'the Goodo OS plan sees the login once the email is confirmed');
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '5d000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT verdanote_user_id FROM public.app_user_role_mapping() WHERE email = 'n@sd.example.test'), '5d000000-0000-4000-8000-000000000007'::uuid,
  'the preview shows the login once the email is confirmed');
RESET role;
SELECT cmp_ok(public.apply_app_user_role_mapping(), '>=', 1, 'apply_app_user_role_mapping adds the role once confirmed');
SELECT ok(public.has_role('5d000000-0000-4000-8000-000000000007', 'employee'::public.app_role), 'the confirmed login got the employee role');

SELECT ok(NOT has_function_privilege('authenticated', 'public.apply_app_user_role_mapping()', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.apply_app_user_role_mapping()', 'EXECUTE'),
  'apply_app_user_role_mapping grants are unchanged (service role only)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.goodo_os_user_role_plan()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.sync_staff_roles_on_team_active_change()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.sync_staff_roles_on_team_active_change()', 'EXECUTE'),
  'the plan and the new trigger function are not callable by browser roles');

SELECT * FROM finish();
ROLLBACK;
