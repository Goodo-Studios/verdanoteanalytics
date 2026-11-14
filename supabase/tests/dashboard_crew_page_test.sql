-- Old dashboard batch 3 (step 5c): the Crew page reads crew_members and
-- call_sheet_crew and writes crew only through the checked functions of
-- migration 20261101000002.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_c53_a, which belongs to client c53-alpha
--   client B   member of client c53-alpha
--   employee   staff
-- Crew rows hold phone numbers, emails and rates, so no client login reads
-- them, not even the crew booked for its own shoot.

BEGIN;
SELECT plan(21);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('c5300000-0000-4000-8000-000000000002', 'c53-employee@example.test'),
  ('c5300000-0000-4000-8000-000000000003', 'c53-client-a@example.test'),
  ('c5300000-0000-4000-8000-000000000004', 'c53-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c5300000-0000-4000-8000-000000000002', 'employee'),
  ('c5300000-0000-4000-8000-000000000003', 'client'),
  ('c5300000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_c53_a', 'C53 Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('c5300000-0000-4000-8000-000000000003', 'act_c53_a');
INSERT INTO public.clients (slug, name, status, origin, does_creators, does_production) VALUES
  ('c53-alpha', 'C53 Alpha', 'active', 'manual', false, true);
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_c53_a', 'c53-alpha');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('c5300000-0000-4000-8000-000000000004', 'c53-alpha');
INSERT INTO public.crew_members (id, name, role, rate_notes, phone, email) VALUES
  ('c5300000-0000-4000-8000-0000000000a1', 'C53 Shooter', 'Videographer', '$600 / day', '555-0131', 'c53-shooter@example.test');
INSERT INTO public.shoots (id, client_slug, shoot_date) VALUES ('c5300000-0000-4000-8000-0000000000e1', 'c53-alpha', current_date + 7);
INSERT INTO public.call_sheets (id, token, shoot_id) VALUES ('c5300000-0000-4000-8000-0000000000f1', 'c53SecretCallSheetToken0000000000000000000000001', 'c5300000-0000-4000-8000-0000000000e1');
INSERT INTO public.call_sheet_crew (call_sheet_id, crew_member_id) VALUES ('c5300000-0000-4000-8000-0000000000f1', 'c5300000-0000-4000-8000-0000000000a1');

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c5300000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.crew_members), 0, 'client A reads no crew, so no phone, email or rate');
SELECT is((SELECT count(*)::int FROM public.call_sheet_crew), 0, 'client A reads no call sheet crew, not even for its own shoot');
SELECT throws_ok($$INSERT INTO public.crew_members (name, role) VALUES ('client made', 'PA')$$, '42501', NULL, 'client A cannot write crew directly');
SELECT throws_ok($$SELECT public.create_crew_member('client made', 'PA')$$, '42501', NULL, 'client A is refused create_crew_member');
SELECT throws_ok($$SELECT public.update_crew_member('c5300000-0000-4000-8000-0000000000a1', 'renamed', 'PA')$$, '42501', NULL, 'client A is refused update_crew_member');
SELECT throws_ok($$SELECT public.archive_crew_member('c5300000-0000-4000-8000-0000000000a1', false)$$, '42501', NULL, 'client A is refused archive_crew_member');

SELECT set_config('request.jwt.claim.sub', 'c5300000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.crew_members), 0, 'client B (member of the client) reads no crew');
SELECT is((SELECT count(*)::int FROM public.call_sheet_crew), 0, 'client B reads no call sheet crew');
SELECT throws_ok($$SELECT public.create_crew_member('client made', 'PA')$$, '42501', NULL, 'client B is refused create_crew_member');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'c5300000-0000-4000-8000-000000000002', true);

SELECT is((SELECT phone FROM public.crew_members WHERE id = 'c5300000-0000-4000-8000-0000000000a1'), '555-0131', 'employee reads the phone number');
SELECT is((SELECT count(*)::int FROM public.call_sheet_crew WHERE crew_member_id = 'c5300000-0000-4000-8000-0000000000a1'), 1, 'employee reads which call sheets a person is on');
SELECT is((public.create_crew_member('  C53 Grip  ', ' PA ', p_email => 'c53-grip@example.test'))->>'name', 'C53 Grip', 'employee adds a crew member, name trimmed');
SELECT is((SELECT role FROM public.crew_members WHERE name = 'C53 Grip'), 'PA', 'and the role trimmed');
SELECT throws_ok($$SELECT public.create_crew_member('   ', 'PA')$$, '22023', NULL, 'a blank name is refused');
SELECT throws_ok($$SELECT public.create_crew_member('C53 Nobody', '  ')$$, '22023', NULL, 'a blank role is refused');
SELECT lives_ok($$SELECT public.update_crew_member('c5300000-0000-4000-8000-0000000000a1', 'C53 Shooter', 'Director', p_rate_notes => '$700 / day', p_phone => '555-0132')$$, 'employee edits a crew member');
SELECT is((SELECT row(role, rate_notes, phone)::text FROM public.crew_members WHERE id = 'c5300000-0000-4000-8000-0000000000a1'), '(Director,"$700 / day",555-0132)', 'the edit is saved');
SELECT lives_ok($$SELECT public.archive_crew_member('c5300000-0000-4000-8000-0000000000a1', false)$$, 'employee archives a crew member');
SELECT is((SELECT active FROM public.crew_members WHERE id = 'c5300000-0000-4000-8000-0000000000a1'), false, 'archived');
SELECT is((SELECT count(*)::int FROM public.call_sheet_crew WHERE crew_member_id = 'c5300000-0000-4000-8000-0000000000a1'), 1, 'an archived person stays on past call sheets');
SELECT throws_ok($$SELECT public.archive_crew_member('c5300000-0000-4000-8000-00000000ffff', true)$$, 'P0002', NULL, 'a crew member that does not exist is refused');

SELECT * FROM finish();
ROLLBACK;
