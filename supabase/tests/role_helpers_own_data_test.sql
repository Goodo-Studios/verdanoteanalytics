-- has_role, get_user_role and get_user_account_ids answer only for the caller
-- (migration 20261215080001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: a browser caller (role claim authenticated or anon) gets its own answers and nothing for
-- another user id; the service role, a direct connection with no claims and cron still get real
-- answers for any id; row rules that pass auth.uid() still work (a client sees only its own roles,
-- a builder sees all); the internal copies exist, give the real answers and are closed to browser
-- roles. The mention paths that look at other people (post_task_comment) are exercised by
-- os_task_comment_threads_test.sql. All people are made up.

BEGIN;
SELECT plan(24);

INSERT INTO auth.users (id, email) VALUES
  ('7a000000-0000-4000-8000-000000000001', 'rh-client@example.test'),
  ('7a000000-0000-4000-8000-000000000002', 'rh-employee@example.test'),
  ('7a000000-0000-4000-8000-000000000003', 'rh-builder@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('7a000000-0000-4000-8000-000000000001', 'client'),
  ('7a000000-0000-4000-8000-000000000002', 'employee'),
  ('7a000000-0000-4000-8000-000000000003', 'builder');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_rh_a', 'RH A'), ('act_rh_b', 'RH B');
INSERT INTO public.user_accounts (user_id, account_id) VALUES
  ('7a000000-0000-4000-8000-000000000001', 'act_rh_a'),
  ('7a000000-0000-4000-8000-000000000002', 'act_rh_b');

CREATE FUNCTION pg_temp.as_user(p_user uuid, p_role text) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
END
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(uuid, text) TO PUBLIC;

-- ---------------------------------------------------------------- a client browser session (1-9)
SELECT pg_temp.as_user('7a000000-0000-4000-8000-000000000001', 'authenticated');
SET LOCAL role authenticated;
SELECT is(public.has_role('7a000000-0000-4000-8000-000000000001', 'client'::public.app_role), true, 'a user gets true for its own role');
SELECT is(public.has_role('7a000000-0000-4000-8000-000000000002', 'employee'::public.app_role), false, 'a client cannot learn another user''s role through has_role');
SELECT is(public.get_user_role('7a000000-0000-4000-8000-000000000001'), 'client'::public.app_role, 'a user gets its own role from get_user_role');
SELECT is(public.get_user_role('7a000000-0000-4000-8000-000000000002'), NULL::public.app_role, 'a client gets nothing for another user from get_user_role');
SELECT is((SELECT array_agg(x) FROM public.get_user_account_ids('7a000000-0000-4000-8000-000000000001') x), ARRAY['act_rh_a'], 'a user gets its own account links');
SELECT is((SELECT count(*)::int FROM public.get_user_account_ids('7a000000-0000-4000-8000-000000000002')), 0, 'a client gets no account links for another user');
SELECT is(public.os_is_staff('7a000000-0000-4000-8000-000000000002'), false, 'os_is_staff does not reveal another user''s staff role to a browser caller');
SELECT is((SELECT count(*)::int FROM public.user_roles), 1, 'a row rule that passes auth.uid() still shows a client its own role only');
SELECT is((SELECT count(*)::int FROM public.user_accounts), 1, 'and its own account link only');

-- ---------------------------------------------------------------- a builder browser session (10-12)
SELECT pg_temp.as_user('7a000000-0000-4000-8000-000000000003', 'authenticated');
SELECT is(public.has_role('7a000000-0000-4000-8000-000000000003', 'builder'::public.app_role), true, 'a builder gets true for its own role');
SELECT cmp_ok((SELECT count(*)::int FROM public.user_roles), '>=', 3, 'a builder still reads every role through the row rule');
SELECT is(public.has_role('7a000000-0000-4000-8000-000000000002', 'employee'::public.app_role), false, 'even a builder session gets false for another id from the helper itself');

-- ---------------------------------------------------------------- anon (13)
RESET role;
SELECT pg_temp.as_user(NULL, 'anon');
SELECT is(public.has_role('7a000000-0000-4000-8000-000000000001', 'client'::public.app_role), false, 'an anon claim gets false for any user id');

-- ---------------------------------------------------------------- service role, direct connection (14-18)
SELECT pg_temp.as_user('7a000000-0000-4000-8000-000000000003', 'service_role');
SELECT is(public.has_role('7a000000-0000-4000-8000-000000000002', 'employee'::public.app_role), true, 'the service role gets real answers for any id (has_role)');
SELECT is(public.get_user_role('7a000000-0000-4000-8000-000000000002'), 'employee'::public.app_role, 'and get_user_role');
SELECT is((SELECT array_agg(x) FROM public.get_user_account_ids('7a000000-0000-4000-8000-000000000002') x), ARRAY['act_rh_b'], 'and get_user_account_ids');
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);
SELECT is(public.has_role('7a000000-0000-4000-8000-000000000002', 'employee'::public.app_role), true, 'a direct connection with no claims gets real answers (cron, migrations)');
SELECT is(public.get_user_role('7a000000-0000-4000-8000-000000000001'), 'client'::public.app_role, 'get_user_role with no claims');

-- ---------------------------------------------------------------- internal copies (19-24)
SELECT is(public._has_role_internal('7a000000-0000-4000-8000-000000000002', 'employee'::public.app_role), true, '_has_role_internal answers for any id');
SELECT is(public._get_user_role_internal('7a000000-0000-4000-8000-000000000003'), 'builder'::public.app_role, '_get_user_role_internal answers for any id');
SELECT is((SELECT array_agg(x) FROM public._get_user_account_ids_internal('7a000000-0000-4000-8000-000000000001') x), ARRAY['act_rh_a'], '_get_user_account_ids_internal answers for any id');
SELECT is(public.os_is_staff_internal('7a000000-0000-4000-8000-000000000002'), true, 'os_is_staff_internal answers for any id');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY[
  'public._has_role_internal(uuid, public.app_role)', 'public._get_user_role_internal(uuid)',
  'public._get_user_account_ids_internal(uuid)', 'public.os_is_staff_internal(uuid)']) f
  WHERE has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')), 0,
  'no browser role can execute the internal copies');
SELECT ok(has_function_privilege('authenticated', 'public.has_role(uuid, public.app_role)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.get_user_role(uuid)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.get_user_account_ids(uuid)', 'EXECUTE'),
  'the three public functions keep their grants for signed-in users');

SELECT * FROM finish();
ROLLBACK;
