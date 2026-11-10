-- Old dashboard batch 3 (step 5c): the Production calendar reads shoots,
-- shoot_schedule_blocks, their talent and crew links, call_sheets and
-- actor_assignments, and writes only through the checked shoot, block and
-- confirm functions of migration 20261101000002.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_c55_a, which belongs to client c55-alpha
--   client B   member of client c55-alpha
--   employee   staff
-- A shoot names where talent and crew will be and when, so no client login
-- reads any of it, not even its own shoot.

BEGIN;
SELECT plan(33);

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
INSERT INTO public.locations (id, name) VALUES ('c5500000-0000-4000-8000-0000000000f1', 'C55 Loft');
INSERT INTO public.crew_members (id, name, role, phone) VALUES ('c5500000-0000-4000-8000-0000000000c1', 'C55 Shooter', 'Videographer', '555-0140');
INSERT INTO public.actors (id, name, phone) VALUES
  ('c5500000-0000-4000-8000-0000000000a1', 'C55 Actor One', '555-0141'),
  ('c5500000-0000-4000-8000-0000000000a2', 'C55 Actor Two', '555-0142');
INSERT INTO public.actor_assignments (id, actor_id, client_slug, stage) VALUES
  ('c5500000-0000-4000-8000-0000000000d1', 'c5500000-0000-4000-8000-0000000000a1', 'c55-alpha', 'booked'),
  ('c5500000-0000-4000-8000-0000000000d2', 'c5500000-0000-4000-8000-0000000000a2', 'c55-beta', 'booked');
INSERT INTO public.shoots (id, client_slug, shoot_date, location) VALUES
  ('c5500000-0000-4000-8000-0000000000e1', 'c55-alpha', current_date + 7, 'Typed studio');
INSERT INTO public.shoot_schedule_blocks (id, shoot_id, label, start_time, end_time) VALUES
  ('c5500000-0000-4000-8000-0000000000b1', 'c5500000-0000-4000-8000-0000000000e1', 'Setup', '08:00', '09:00');
INSERT INTO public.shoot_schedule_block_crew (block_id, crew_member_id) VALUES ('c5500000-0000-4000-8000-0000000000b1', 'c5500000-0000-4000-8000-0000000000c1');

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c5500000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.shoots), 0, 'client A reads no shoots, not even its own');
SELECT is((SELECT count(*)::int FROM public.shoot_schedule_blocks), 0, 'client A reads no schedule blocks');
SELECT is((SELECT count(*)::int FROM public.shoot_schedule_block_crew), 0, 'client A reads no block crew');
SELECT is((SELECT count(*)::int FROM public.shoot_schedule_block_talent), 0, 'client A reads no block talent');
SELECT is((SELECT count(*)::int FROM public.actor_assignments), 0, 'client A reads no castings');
SELECT throws_ok($$INSERT INTO public.shoots (client_slug, shoot_date) VALUES ('c55-alpha', current_date)$$, '42501', NULL, 'client A cannot write shoots directly');
SELECT throws_ok($$SELECT public.create_shoot('c55-alpha', current_date)$$, '42501', NULL, 'client A is refused create_shoot');
SELECT throws_ok($$SELECT public.update_shoot('c5500000-0000-4000-8000-0000000000e1', current_date)$$, '42501', NULL, 'client A is refused update_shoot');
SELECT throws_ok($$SELECT public.delete_shoot('c5500000-0000-4000-8000-0000000000e1')$$, '42501', NULL, 'client A is refused delete_shoot');
SELECT throws_ok($$SELECT public.create_shoot_schedule_block('c5500000-0000-4000-8000-0000000000e1', 'x', '10:00', '11:00')$$, '42501', NULL, 'client A is refused create_shoot_schedule_block');
SELECT throws_ok($$SELECT public.update_shoot_schedule_block('c5500000-0000-4000-8000-0000000000b1', 'x', '10:00', '11:00')$$, '42501', NULL, 'client A is refused update_shoot_schedule_block');
SELECT throws_ok($$SELECT public.delete_shoot_schedule_block('c5500000-0000-4000-8000-0000000000b1')$$, '42501', NULL, 'client A is refused delete_shoot_schedule_block');
SELECT throws_ok($$SELECT public.confirm_actor_for_shoot('c5500000-0000-4000-8000-0000000000d1', 'c5500000-0000-4000-8000-0000000000e1')$$, '42501', NULL, 'client A is refused confirm_actor_for_shoot');
SELECT throws_ok($$SELECT public.unconfirm_actor_from_shoot('c5500000-0000-4000-8000-0000000000d1')$$, '42501', NULL, 'client A is refused unconfirm_actor_from_shoot');

SELECT set_config('request.jwt.claim.sub', 'c5500000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.shoots), 0, 'client B (member of the client) reads no shoots');
SELECT throws_ok($$SELECT public.create_shoot('c55-alpha', current_date)$$, '42501', NULL, 'client B is refused create_shoot');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'c5500000-0000-4000-8000-000000000002', true);

SELECT is(
  (SELECT count(*)::int FROM public.shoots s JOIN public.shoot_schedule_blocks b ON b.shoot_id = s.id JOIN public.shoot_schedule_block_crew c ON c.block_id = b.id WHERE s.id = 'c5500000-0000-4000-8000-0000000000e1'),
  1, 'employee reads a shoot with its blocks and crew');
SELECT is((public.create_shoot('c55-alpha', current_date + 14, 'ignored text', 'Bring props', 'c5500000-0000-4000-8000-0000000000f1'))->>'location', 'C55 Loft', 'a linked location wins over typed text');
SELECT throws_ok($$SELECT public.create_shoot('c55-gone', current_date)$$, 'P0002', NULL, 'a client that does not exist is refused');
SELECT throws_ok($$SELECT public.create_shoot('c55-alpha', NULL)$$, '22023', NULL, 'a shoot needs a date');
SELECT lives_ok($$SELECT public.update_shoot('c5500000-0000-4000-8000-0000000000e1', current_date + 8, 'Typed studio', 'Moved a day')$$, 'employee moves a shoot');
SELECT throws_ok($$SELECT public.confirm_actor_for_shoot('c5500000-0000-4000-8000-0000000000d2', 'c5500000-0000-4000-8000-0000000000e1')$$, '22023', NULL, 'a casting of another client cannot be confirmed onto the shoot');
SELECT lives_ok($$SELECT public.confirm_actor_for_shoot('c5500000-0000-4000-8000-0000000000d1', 'c5500000-0000-4000-8000-0000000000e1')$$, 'employee confirms talent onto the shoot');
SELECT is((SELECT scheduled_shoot_date - current_date FROM public.actor_assignments WHERE id = 'c5500000-0000-4000-8000-0000000000d1'), 8, 'the casting takes the shoot date');
SELECT throws_ok($$SELECT public.create_shoot_schedule_block('c5500000-0000-4000-8000-0000000000e1', 'Late', '22:00', '01:00')$$, '22023', NULL, 'a block that ends before it starts is refused');
SELECT throws_ok($$SELECT public.create_shoot_schedule_block('c5500000-0000-4000-8000-0000000000e1', 'Wrong talent', '10:00', '11:00', NULL, NULL, ARRAY['c5500000-0000-4000-8000-0000000000d2']::uuid[])$$, '22023', NULL, 'only talent confirmed onto the shoot can be called for a block');
SELECT lives_ok($$SELECT public.create_shoot_schedule_block('c5500000-0000-4000-8000-0000000000e1', 'Kitchen', '10:00', '12:00', 'Kitchen', NULL, ARRAY['c5500000-0000-4000-8000-0000000000d1']::uuid[], ARRAY['c5500000-0000-4000-8000-0000000000c1']::uuid[])$$, 'employee adds a block with talent and crew');
SELECT is((SELECT count(*)::int FROM public.shoot_schedule_block_talent t JOIN public.shoot_schedule_blocks b ON b.id = t.block_id WHERE b.label = 'Kitchen'), 1, 'the talent is called for the block');
SELECT lives_ok($$SELECT public.update_shoot_schedule_block('c5500000-0000-4000-8000-0000000000b1', 'Setup and lighting', '07:30', '09:00')$$, 'employee edits a block');
SELECT throws_ok($$SELECT public.delete_shoot('c5500000-0000-4000-8000-0000000000e1')$$, '22023', NULL, 'a shoot with confirmed talent cannot be deleted');
SELECT lives_ok($$SELECT public.unconfirm_actor_from_shoot('c5500000-0000-4000-8000-0000000000d1')$$, 'employee removes the talent from the shoot');
SELECT lives_ok($$SELECT public.delete_shoot_schedule_block('c5500000-0000-4000-8000-0000000000b1')$$, 'employee deletes a block');
SELECT is((public.delete_shoot('c5500000-0000-4000-8000-0000000000e1'))->>'id', 'c5500000-0000-4000-8000-0000000000e1', 'then the shoot can be deleted');

SELECT * FROM finish();
ROLLBACK;
