-- Step 5c: the Call sheets page reads call_sheets, call_sheet_crew and
-- call_sheet_talent_entries (migration 20261110220001) and writes only through
-- the checked call sheet functions of migrations 20261101000002 and
-- 20261110220001.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_c55_a, which belongs to client c55-alpha
--   client B   member of client c55-alpha
--   employee   staff
-- A call sheet carries the secret link token, and the talent lines carry rate
-- and internal notes, so no client login reads any of them, not even for its
-- own shoot.

BEGIN;
SELECT plan(35);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('c5500000-0000-4000-8000-000000000002', 'c55-employee@example.test'),
  ('c5500000-0000-4000-8000-000000000003', 'c55-client-a@example.test'),
  ('c5500000-0000-4000-8000-000000000004', 'c55-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c5500000-0000-4000-8000-000000000002', 'employee'),
  ('c5500000-0000-4000-8000-000000000003', 'client'),
  ('c5500000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_c55_a', 'C55 Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('c5500000-0000-4000-8000-000000000003', 'act_c55_a');
INSERT INTO public.clients (slug, name, status, origin, does_creators, does_production) VALUES
  ('c55-alpha', 'C55 Alpha', 'active', 'manual', false, true),
  ('c55-beta', 'C55 Beta', 'active', 'manual', false, true);
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_c55_a', 'c55-alpha');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('c5500000-0000-4000-8000-000000000004', 'c55-alpha');
INSERT INTO public.crew_members (id, name, role, phone) VALUES
  ('c5500000-0000-4000-8000-0000000000a1', 'C55 Shooter', 'Videographer', '555-0141'),
  ('c5500000-0000-4000-8000-0000000000a2', 'C55 Grip', 'Grip', '555-0142');
INSERT INTO public.shoots (id, client_slug, shoot_date) VALUES
  ('c5500000-0000-4000-8000-0000000000e1', 'c55-alpha', current_date + 7),
  ('c5500000-0000-4000-8000-0000000000e2', 'c55-alpha', current_date + 14),
  ('c5500000-0000-4000-8000-0000000000e3', 'c55-beta', current_date + 7);
INSERT INTO public.call_sheets (id, token, shoot_id) VALUES
  ('c5500000-0000-4000-8000-0000000000f1', 'c55SecretCallSheetToken0000000000000000000000001', 'c5500000-0000-4000-8000-0000000000e1');
INSERT INTO public.call_sheet_crew (call_sheet_id, crew_member_id) VALUES
  ('c5500000-0000-4000-8000-0000000000f1', 'c5500000-0000-4000-8000-0000000000a1');
INSERT INTO public.actors (id, name, email, phone) VALUES
  ('c5500000-0000-4000-8000-0000000000b1', 'C55 Actor One', 'c55-actor-one@example.test', '555-0143'),
  ('c5500000-0000-4000-8000-0000000000b2', 'C55 Actor Two', 'c55-actor-two@example.test', '555-0144');
INSERT INTO public.actor_assignments (id, actor_id, client_slug, stage, shoot_id) VALUES
  ('c5500000-0000-4000-8000-0000000000c1', 'c5500000-0000-4000-8000-0000000000b1', 'c55-alpha', 'booked', 'c5500000-0000-4000-8000-0000000000e1'),
  ('c5500000-0000-4000-8000-0000000000c2', 'c5500000-0000-4000-8000-0000000000b2', 'c55-alpha', 'shortlisted', NULL),
  ('c5500000-0000-4000-8000-0000000000c3', 'c5500000-0000-4000-8000-0000000000b2', 'c55-beta', 'booked', 'c5500000-0000-4000-8000-0000000000e3');
INSERT INTO public.call_sheet_talent_entries (call_sheet_id, actor_assignment_id, wardrobe, rate_note, internal_note) VALUES
  ('c5500000-0000-4000-8000-0000000000f1', 'c5500000-0000-4000-8000-0000000000c1', 'Blue sweater', '$400 flat', 'Rebooked after the June shoot');

-- ---------------------------------------------------------------- table rules
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.call_sheet_talent_entries'::regclass), 'row rules are on for call_sheet_talent_entries');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'call_sheet_talent_entries' AND (qual = 'true' OR with_check = 'true')), 0, 'call_sheet_talent_entries has no open policy');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'call_sheet_talent_entries' AND cmd <> 'SELECT'), 0, 'call_sheet_talent_entries has only a read policy; writes go through the checked functions');
SELECT ok(NOT has_table_privilege('anon', 'public.call_sheet_talent_entries', 'SELECT'), 'anon cannot read call_sheet_talent_entries');
SELECT ok(NOT has_table_privilege('authenticated', 'public.call_sheet_talent_entries', 'INSERT'), 'signed-in users hold no insert grant');
SELECT ok(NOT has_function_privilege('anon', 'public.save_call_sheet_talent_entry(uuid, uuid, time without time zone, text, text, text, text)', 'EXECUTE'), 'anon cannot run save_call_sheet_talent_entry');
SELECT ok(NOT has_function_privilege('anon', 'public.remove_call_sheet_talent_entry(uuid, uuid)', 'EXECUTE'), 'anon cannot run remove_call_sheet_talent_entry');

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c5500000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.call_sheets), 0, 'client A reads no call sheets, so no link token, not even for its own shoot');
SELECT is((SELECT count(*)::int FROM public.call_sheet_crew), 0, 'client A reads no call sheet crew');
SELECT is((SELECT count(*)::int FROM public.call_sheet_talent_entries), 0, 'client A reads no talent lines, so no rate or internal note');
SELECT throws_ok($$INSERT INTO public.call_sheet_talent_entries (call_sheet_id, actor_assignment_id) VALUES ('c5500000-0000-4000-8000-0000000000f1', 'c5500000-0000-4000-8000-0000000000c1')$$, '42501', NULL, 'client A cannot write a talent line directly');
SELECT throws_ok($$SELECT public.save_call_sheet_talent_entry('c5500000-0000-4000-8000-0000000000f1', 'c5500000-0000-4000-8000-0000000000c1', p_wardrobe => 'client made')$$, '42501', NULL, 'client A is refused save_call_sheet_talent_entry');
SELECT throws_ok($$SELECT public.remove_call_sheet_talent_entry('c5500000-0000-4000-8000-0000000000f1', 'c5500000-0000-4000-8000-0000000000c1')$$, '42501', NULL, 'client A is refused remove_call_sheet_talent_entry');
SELECT throws_ok($$SELECT public.create_call_sheet('c5500000-0000-4000-8000-0000000000e2', 'c55ClientMadeToken000000000000000000000000001')$$, '42501', NULL, 'client A is refused create_call_sheet');
SELECT throws_ok($$SELECT public.update_call_sheet('c5500000-0000-4000-8000-0000000000f1', '06:00')$$, '42501', NULL, 'client A is refused update_call_sheet');
SELECT throws_ok($$SELECT public.revoke_call_sheet('c5500000-0000-4000-8000-0000000000f1', true)$$, '42501', NULL, 'client A is refused revoke_call_sheet');

SELECT set_config('request.jwt.claim.sub', 'c5500000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.call_sheets), 0, 'client B (member of the client) reads no call sheets');
SELECT is((SELECT count(*)::int FROM public.call_sheet_talent_entries), 0, 'client B reads no talent lines');
SELECT throws_ok($$SELECT public.save_call_sheet_talent_entry('c5500000-0000-4000-8000-0000000000f1', 'c5500000-0000-4000-8000-0000000000c1')$$, '42501', NULL, 'client B is refused save_call_sheet_talent_entry');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'c5500000-0000-4000-8000-000000000002', true);

SELECT is((SELECT rate_note FROM public.call_sheet_talent_entries WHERE actor_assignment_id = 'c5500000-0000-4000-8000-0000000000c1'), '$400 flat', 'employee reads the rate note');
SELECT is((public.create_call_sheet('c5500000-0000-4000-8000-0000000000e2', 'c55EmployeeMadeToken0000000000000000000000001', '07:30', ' about 6 PM ', NULL, ARRAY['c5500000-0000-4000-8000-0000000000a1', 'c5500000-0000-4000-8000-0000000000a2']::uuid[]))->>'wrap_time_estimate', 'about 6 PM', 'employee makes a call sheet, wrap estimate trimmed');
SELECT is((SELECT count(*)::int FROM public.call_sheet_crew cc JOIN public.call_sheets cs ON cs.id = cc.call_sheet_id WHERE cs.shoot_id = 'c5500000-0000-4000-8000-0000000000e2'), 2, 'with both crew on it');
SELECT lives_ok($$SELECT public.update_call_sheet('c5500000-0000-4000-8000-0000000000f1', '06:45', '5 PM', 'Park on the street', ARRAY['c5500000-0000-4000-8000-0000000000a2']::uuid[])$$, 'employee edits a call sheet');
SELECT is((SELECT array_agg(crew_member_id)::text FROM public.call_sheet_crew WHERE call_sheet_id = 'c5500000-0000-4000-8000-0000000000f1'), '{c5500000-0000-4000-8000-0000000000a2}', 'the crew list is replaced');
SELECT is((public.save_call_sheet_talent_entry('c5500000-0000-4000-8000-0000000000f1', 'c5500000-0000-4000-8000-0000000000c1', '07:00', '  Green jacket ', 'Bring sneakers', '$450 flat', NULL))->>'wardrobe', 'Green jacket', 'employee saves a talent line, wardrobe trimmed');
SELECT is((SELECT row(call_time, rate_note, internal_note, updated_by)::text FROM public.call_sheet_talent_entries WHERE actor_assignment_id = 'c5500000-0000-4000-8000-0000000000c1'), '(07:00:00,"$450 flat",,c5500000-0000-4000-8000-000000000002)', 'the save replaces the line and records who saved it');
SELECT is((SELECT count(*)::int FROM public.call_sheet_talent_entries WHERE call_sheet_id = 'c5500000-0000-4000-8000-0000000000f1'), 1, 'saving again updates the one line');
SELECT throws_ok($$SELECT public.save_call_sheet_talent_entry('c5500000-0000-4000-8000-0000000000f1', 'c5500000-0000-4000-8000-0000000000c2')$$, '22023', NULL, 'talent not confirmed onto the shoot is refused');
SELECT throws_ok($$SELECT public.save_call_sheet_talent_entry('c5500000-0000-4000-8000-0000000000f1', 'c5500000-0000-4000-8000-0000000000c3')$$, '22023', NULL, 'talent confirmed onto another client''s shoot is refused');
SELECT throws_ok($$SELECT public.save_call_sheet_talent_entry('c5500000-0000-4000-8000-0000000000f1', 'c5500000-0000-4000-8000-0000000000c1', p_rate_note => repeat('x', 501))$$, '22023', NULL, 'a rate note over 500 characters is refused');
SELECT throws_ok($$SELECT public.save_call_sheet_talent_entry('c5500000-0000-4000-8000-00000000ffff', 'c5500000-0000-4000-8000-0000000000c1')$$, 'P0002', NULL, 'a call sheet that does not exist is refused');
SELECT lives_ok($$SELECT public.revoke_call_sheet('c5500000-0000-4000-8000-0000000000f1', true)$$, 'employee revokes the link');
SELECT is((SELECT revoked FROM public.call_sheets WHERE id = 'c5500000-0000-4000-8000-0000000000f1'), true, 'revoked, and its talent lines stay');
SELECT lives_ok($$SELECT public.remove_call_sheet_talent_entry('c5500000-0000-4000-8000-0000000000f1', 'c5500000-0000-4000-8000-0000000000c1')$$, 'employee removes a talent line');
SELECT throws_ok($$SELECT public.remove_call_sheet_talent_entry('c5500000-0000-4000-8000-0000000000f1', 'c5500000-0000-4000-8000-0000000000c1')$$, 'P0002', NULL, 'removing it again is refused');

SELECT * FROM finish();
ROLLBACK;
