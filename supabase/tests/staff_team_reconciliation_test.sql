-- One staff list: role mapping as data, reconciliation, prepared invites and the team list
-- (migration 20261111040001, step 5d).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks: row rules on, no grants for anon or public and no direct writes for signed-in
-- users; the seeded mapping is admin to builder, producer (and any other staff role) to employee
-- and viewer to client, with nothing waiting on the owner;
-- a client reads no staff list and is refused every function; an employee reads the mapping
-- only, cannot grant themselves builder by function or by direct write and cannot decide the
-- mapping; the builder sees each mismatch kind, prepares and cancels invites (nothing is sent),
-- puts a staff login on the team list, edits the team list and sets staff roles within the
-- limits; a viewer is a client and a viewer client login with no linked client is reported; the
-- audit record is immutable. All people are made up.
-- Changed by migration 20261116070001 (owner decision 2026-11-11).

BEGIN;
SELECT plan(62);

-- b1 builder (admin), e1 employee (producer), c1 client (not on the team list),
-- nl producer without login, nv viewer without login, n1 producer whose login has no role,
-- v1 viewer whose login has no role, i1 deactivated producer whose login is an employee,
-- cl1 producer whose login is a client, rd admin whose login is an employee,
-- s1 employee login not on the team list with the same name as nl,
-- v2 viewer whose login is a client with no client linked, v3 viewer whose login is a client linked
-- to a client, v4 viewer whose login holds the employee role, v5 viewer whose login has no role.
INSERT INTO auth.users (id, email) VALUES
  ('f5d00000-0000-4000-8000-000000000001', 'b1@srt.example.test'),
  ('f5d00000-0000-4000-8000-000000000002', 'e1@srt.example.test'),
  ('f5d00000-0000-4000-8000-000000000003', 'c1@srt.example.test'),
  ('f5d00000-0000-4000-8000-000000000004', 'n1@srt.example.test'),
  ('f5d00000-0000-4000-8000-000000000005', 'V1@srt.example.test'),
  ('f5d00000-0000-4000-8000-000000000006', 'i1@srt.example.test'),
  ('f5d00000-0000-4000-8000-000000000007', 'cl1@srt.example.test'),
  ('f5d00000-0000-4000-8000-000000000008', 'rd@srt.example.test'),
  ('f5d00000-0000-4000-8000-000000000009', 's1@srt.example.test'),
  ('f5d00000-0000-4000-8000-000000000010', 'v2@srt.example.test'),
  ('f5d00000-0000-4000-8000-000000000011', 'v3@srt.example.test'),
  ('f5d00000-0000-4000-8000-000000000012', 'v4@srt.example.test'),
  ('f5d00000-0000-4000-8000-000000000013', 'v5@srt.example.test');
INSERT INTO public.clients (slug, name, status) VALUES ('srt-alpha', 'SRT Alpha', 'active');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('f5d00000-0000-4000-8000-000000000001', 'builder'),
  ('f5d00000-0000-4000-8000-000000000002', 'employee'),
  ('f5d00000-0000-4000-8000-000000000003', 'client'),
  ('f5d00000-0000-4000-8000-000000000006', 'employee'),
  ('f5d00000-0000-4000-8000-000000000007', 'client'),
  ('f5d00000-0000-4000-8000-000000000008', 'employee'),
  ('f5d00000-0000-4000-8000-000000000009', 'employee'),
  ('f5d00000-0000-4000-8000-000000000010', 'client'),
  ('f5d00000-0000-4000-8000-000000000011', 'client'),
  ('f5d00000-0000-4000-8000-000000000012', 'employee');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('f5d00000-0000-4000-8000-000000000011', 'srt-alpha');
UPDATE public.profiles SET display_name = 'Pat Same' WHERE user_id = 'f5d00000-0000-4000-8000-000000000009';
INSERT INTO public.app_users (id, name, email, role, active) VALUES
  ('f5d10000-0000-4000-8000-000000000001', 'B One', 'b1@srt.example.test', 'admin', true),
  ('f5d10000-0000-4000-8000-000000000002', 'E One', 'e1@srt.example.test', 'producer', true),
  ('f5d10000-0000-4000-8000-000000000003', 'Pat Same', 'nl@srt.example.test', 'producer', true),
  ('f5d10000-0000-4000-8000-000000000004', 'N One', 'n1@srt.example.test', 'producer', true),
  ('f5d10000-0000-4000-8000-000000000005', 'V One', 'v1@srt.example.test', 'viewer', true),
  ('f5d10000-0000-4000-8000-000000000006', 'I One', 'i1@srt.example.test', 'producer', false),
  ('f5d10000-0000-4000-8000-000000000007', 'CL One', ' cl1@srt.example.test', 'producer', true),
  ('f5d10000-0000-4000-8000-000000000008', 'RD', 'rd@srt.example.test', 'admin', true),
  ('f5d10000-0000-4000-8000-000000000009', 'NV', 'nv@srt.example.test', 'viewer', true),
  ('f5d10000-0000-4000-8000-000000000010', 'V Two', 'v2@srt.example.test', 'viewer', true),
  ('f5d10000-0000-4000-8000-000000000011', 'V Three', 'v3@srt.example.test', 'viewer', true),
  ('f5d10000-0000-4000-8000-000000000012', 'V Four', 'v4@srt.example.test', 'viewer', true),
  ('f5d10000-0000-4000-8000-000000000013', 'V Five', 'v5@srt.example.test', 'viewer', true);

CREATE TEMP TABLE r AS SELECT NULL::uuid AS id;
GRANT ALL ON r TO authenticated;
CREATE FUNCTION pg_temp.issues_of(p_email text) RETURNS text AS $$
  SELECT array_to_string(issues, ',') FROM public.staff_reconciliation() WHERE lower(btrim(email)) = p_email
$$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.issues_of(text) TO authenticated;

-- ---------------------------------------------------------------- structure and mapping (1-6)
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.staff_role_mappings'::regclass, 'public.staff_invites'::regclass, 'public.staff_admin_events'::regclass)),
  'row rules are on for the three staff tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('staff_role_mappings', 'staff_invites', 'staff_admin_events')
              AND grantee IN ('anon', 'PUBLIC')), 0,
  'anon and public hold no privileges on the staff tables');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name IN ('staff_role_mappings', 'staff_invites', 'staff_admin_events')
              AND grantee = 'authenticated' AND privilege_type <> 'SELECT'), 0,
  'signed-in users only read; writes go through the checked functions');
SELECT is((SELECT string_agg(dashboard_role || '>' || verdanote_role, ',' ORDER BY dashboard_role)
             FROM public.staff_role_mappings),
  'admin>builder,producer>employee,viewer>client',
  'the mapping is admin to builder, producer to employee and viewer to client');
SELECT is((SELECT string_agg(coalesce(public.dashboard_role_to_verdanote_role(x)::text, 'none'), ',' ORDER BY x)
             FROM unnest(ARRAY['admin', 'producer', 'viewer', 'editor', '']) x),
  'none,builder,employee,employee,client', 'admin builder, viewer client, producer and any other staff role employee, a blank role none');
SELECT ok(NOT has_function_privilege('authenticated', 'public.prevent_staff_admin_event_rewrite()', 'EXECUTE'),
  'the immutability trigger function is not callable by signed-in users');

-- ---------------------------------------------------------------- client (7-17)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'f5d00000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.staff_role_mappings) + (SELECT count(*)::int FROM public.staff_invites)
          + (SELECT count(*)::int FROM public.staff_admin_events), 0, 'a client reads none of the three staff tables');
SELECT is((SELECT count(*)::int FROM public.app_users), 0, 'a client reads no team list');
SELECT is((SELECT count(*)::int FROM public.profiles WHERE user_id <> 'f5d00000-0000-4000-8000-000000000003')
          + (SELECT count(*)::int FROM public.user_roles WHERE user_id <> 'f5d00000-0000-4000-8000-000000000003'), 0,
  'a client reads no other login or role');
SELECT is(public.dashboard_role_to_verdanote_role('admin'), NULL, 'the mapping answers nothing to a client for a known role');
SELECT throws_ok($$SELECT * FROM public.staff_reconciliation()$$, '42501', NULL, 'a client is refused the reconciliation');
SELECT throws_ok($$SELECT public.set_staff_role_mapping('viewer', 'client', 'client tries')$$, '42501', NULL, 'a client cannot change the mapping');
SELECT throws_ok($$SELECT public.prepare_staff_invite('f5d10000-0000-4000-8000-000000000003')$$, '42501', NULL, 'a client cannot prepare an invite');
SELECT throws_ok($$SELECT public.cancel_staff_invite('00000000-0000-4000-8000-000000000000', 'client')$$, '42501', NULL, 'a client cannot cancel an invite');
SELECT throws_ok($$SELECT public.add_login_to_team_list('f5d00000-0000-4000-8000-000000000003', NULL)$$, '42501', NULL, 'a client cannot add to the team list');
SELECT throws_ok($$SELECT public.update_team_member('f5d10000-0000-4000-8000-000000000002', 'X', 'admin', true)$$, '42501', NULL, 'a client cannot edit the team list');
SELECT throws_ok($$SELECT public.set_staff_role('f5d00000-0000-4000-8000-000000000003', 'builder')$$, '42501', NULL, 'a client cannot give itself a staff role');

-- ---------------------------------------------------------------- employee (18-25)
SELECT set_config('request.jwt.claim.sub', 'f5d00000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.staff_role_mappings), 3, 'an employee reads the role mapping');
SELECT is((SELECT count(*)::int FROM public.staff_invites) + (SELECT count(*)::int FROM public.staff_admin_events), 0,
  'an employee reads no invites and no audit events');
SELECT throws_ok($$SELECT * FROM public.staff_reconciliation()$$, '42501', NULL, 'an employee is refused the reconciliation');
SELECT throws_ok($$SELECT public.set_staff_role('f5d00000-0000-4000-8000-000000000002', 'builder')$$, '42501', NULL,
  'an employee cannot grant themselves builder through the function');
SELECT throws_ok($$INSERT INTO public.user_roles (user_id, role) VALUES ('f5d00000-0000-4000-8000-000000000002', 'builder')$$, '42501', NULL,
  'an employee cannot insert a builder role for themselves');
DO $$ BEGIN
  UPDATE public.user_roles SET role = 'builder' WHERE user_id = 'f5d00000-0000-4000-8000-000000000002';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
SELECT is(public.has_role('f5d00000-0000-4000-8000-000000000002', 'builder'), false, 'an employee cannot turn their own role into builder by update');
SELECT throws_ok($$SELECT public.set_staff_role_mapping('viewer', 'client', 'decided by an employee')$$, '42501', NULL,
  'an employee cannot decide the mapping');
SELECT throws_ok($$SELECT public.add_login_to_team_list('f5d00000-0000-4000-8000-000000000009', NULL)$$, '42501', NULL,
  'an employee cannot change the team list');

-- ---------------------------------------------------------------- builder: reconciliation (26-33)
SELECT set_config('request.jwt.claim.sub', 'f5d00000-0000-4000-8000-000000000001', true);
SELECT is(pg_temp.issues_of('b1@srt.example.test') || '|' || pg_temp.issues_of('e1@srt.example.test'), '|',
  'builder and employee on the team list with the mapped role have no issue');
SELECT is(pg_temp.issues_of('nl@srt.example.test'), 'no_login,possible_name_match', 'a team member without a login, with a same-name login elsewhere');
SELECT is(pg_temp.issues_of('nv@srt.example.test'), 'no_login', 'a viewer without a login is only missing the login, nothing waits on the owner');
SELECT is(pg_temp.issues_of('n1@srt.example.test') || '|' || pg_temp.issues_of('v1@srt.example.test'), 'no_staff_role|no_staff_role',
  'logins without a role, matched by email with case ignored');
SELECT is(pg_temp.issues_of('v2@srt.example.test') || '|' || pg_temp.issues_of('v3@srt.example.test'), 'no_client_linked|',
  'a viewer client login with no linked client is reported, one with a linked client lines up');
SELECT is(pg_temp.issues_of('v4@srt.example.test'), 'role_differs', 'a viewer whose login holds a staff role is reported, never changed');
SELECT is((SELECT client_linked::text || ' ' || mapped_role FROM public.staff_reconciliation() WHERE lower(email) = 'v3@srt.example.test'), 'true client',
  'the row says the viewer maps to client and has a linked client');
SELECT is(pg_temp.issues_of('i1@srt.example.test') || '|' || pg_temp.issues_of('cl1@srt.example.test') || '|' || pg_temp.issues_of('rd@srt.example.test'),
  'inactive_with_staff_role|client_login|role_differs', 'a deactivated member with a role, a client login (spaces ignored) and a differing role');
SELECT is(pg_temp.issues_of('s1@srt.example.test'), 'not_on_team_list,possible_name_match', 'a staff login missing from the team list is reported, not merged');
SELECT is((SELECT count(*)::int FROM public.staff_reconciliation() WHERE lower(email) = 'c1@srt.example.test'), 0,
  'a client login that is not on the team list is not a staff row');
SELECT is((SELECT possible_match FROM public.staff_reconciliation() WHERE lower(email) = 'nl@srt.example.test'), 'Pat Same <s1@srt.example.test>',
  'the possible match names the other person for a builder to check');

-- ---------------------------------------------------------------- builder: invites (34-40)
UPDATE r SET id = public.prepare_staff_invite('f5d10000-0000-4000-8000-000000000003');
SELECT is((SELECT status || ' ' || proposed_role FROM public.staff_invites WHERE id = (SELECT id FROM r)),
  'prepared employee', 'an invite is prepared with the mapped role, nothing sent');
SELECT is(public.prepare_staff_invite('f5d10000-0000-4000-8000-000000000003'), (SELECT id FROM r), 'preparing again returns the same invite');
SELECT throws_ok($$SELECT public.prepare_staff_invite('f5d10000-0000-4000-8000-000000000005')$$, '22023', NULL, 'a member who has a login is not invited');
SELECT throws_ok($$SELECT public.prepare_staff_invite('f5d10000-0000-4000-8000-000000000006')$$, '22023', NULL, 'a deactivated member is not invited');
SELECT throws_ok($$SELECT public.cancel_staff_invite((SELECT id FROM r), 'no')$$, '22023', NULL, 'cancelling needs a reason');
SELECT lives_ok($$SELECT public.cancel_staff_invite((SELECT id FROM r), 'Joins after the release')$$, 'a builder cancels an invite');
SELECT throws_ok($$SELECT public.prepare_staff_invite('f5d10000-0000-4000-8000-000000000009')$$, '22023', NULL,
  'a viewer is not invited from the staff list: a client login is made on the client Setup tab');

-- ---------------------------------------------------------------- builder: team list and roles (41-51)
UPDATE r SET id = public.add_login_to_team_list('f5d00000-0000-4000-8000-000000000009', NULL);
SELECT is((SELECT role FROM public.app_users WHERE id = (SELECT id FROM r)),
  'producer', 'a staff login goes on the team list with the dashboard role that maps to its role');
SELECT is(pg_temp.issues_of('s1@srt.example.test'), '', 'once on the team list the login lines up');
SELECT throws_ok($$SELECT public.add_login_to_team_list('f5d00000-0000-4000-8000-000000000009', NULL)$$, '23505', NULL, 'an email already on the team list is refused');
SELECT throws_ok($$SELECT public.add_login_to_team_list('f5d00000-0000-4000-8000-000000000003', NULL)$$, '22023', NULL, 'a client login does not go on the team list');
SELECT throws_ok($$SELECT public.update_team_member('f5d10000-0000-4000-8000-000000000001', 'B One', 'admin', false)$$, '22023', NULL,
  'a builder cannot deactivate themselves');
SELECT lives_ok($$SELECT public.update_team_member('f5d10000-0000-4000-8000-000000000003', 'Pat Other', 'producer', true)$$, 'a builder renames a team member');
SELECT throws_ok($$SELECT public.set_staff_role('f5d00000-0000-4000-8000-000000000001', 'employee')$$, '42501', NULL, 'a builder cannot change their own role');
SELECT throws_ok($$SELECT public.set_staff_role('f5d00000-0000-4000-8000-000000000007', 'employee')$$, '22023', NULL, 'a client login is not given a staff role');
SELECT throws_ok($$SELECT public.set_staff_role('f5d00000-0000-4000-8000-000000000008', 'client')$$, '22023', NULL, 'a login that holds a staff role is not turned into a client');
SELECT throws_ok($$SELECT public.set_staff_role('f5d00000-0000-4000-8000-000000000008', 'owner')$$, '22023', NULL, 'there is no fourth role value');
SELECT lives_ok($$SELECT public.set_staff_role('f5d00000-0000-4000-8000-000000000005', 'client')$$, 'a builder gives a viewer login with no role the client role');
SELECT is(pg_temp.issues_of('v1@srt.example.test'), 'no_client_linked', 'the viewer client login now waits only for a linked client');
SELECT lives_ok($$SELECT public.set_staff_role('f5d00000-0000-4000-8000-000000000008', 'builder')$$, 'a builder sets another login to builder');
SELECT is((SELECT string_agg(role::text, ',') FROM public.user_roles WHERE user_id = 'f5d00000-0000-4000-8000-000000000008'), 'builder',
  'set_staff_role replaces the staff role');

-- ---------------------------------------------------------------- applying (52-55)
RESET role;
SELECT cmp_ok(public.apply_app_user_role_mapping(), '>=', 1, 'applying the mapping adds the settled roles');
SELECT is((SELECT string_agg(role::text, ',') FROM public.user_roles WHERE user_id = 'f5d00000-0000-4000-8000-000000000013'), 'client',
  'applying the mapping gives a viewer with no role the client role');
SELECT is((SELECT string_agg(role::text, ',') FROM public.user_roles WHERE user_id = 'f5d00000-0000-4000-8000-000000000012'), 'employee',
  'applying the mapping never gives the client role to a staff login');
SELECT is((SELECT string_agg(role::text, ',') FROM public.user_roles WHERE user_id = 'f5d00000-0000-4000-8000-000000000007'), 'client',
  'applying the mapping never gives a client login a staff role');
SELECT throws_ok($$UPDATE public.staff_admin_events SET subject = 'changed'$$, '23514', NULL, 'the audit record cannot be changed');

SELECT * FROM finish();
ROLLBACK;
