-- Old dashboard batch 3 (step 5c): the Locations page reads locations,
-- location_photos, location_boards and location_board_items, writes locations
-- through the checked functions of migration 20261101000002 and writes shared
-- links directly under the staff rules.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_c51_a, which belongs to client c51-alpha
--   client B   member of client c51-alpha
--   employee   staff
-- A location holds the host's contact email, wifi and entry instructions, and a
-- link token opens the public location page without a login, so no client
-- login may read any of it, not even rows shared with its own client.

BEGIN;
SELECT plan(33);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('c5100000-0000-4000-8000-000000000002', 'c51-employee@example.test'),
  ('c5100000-0000-4000-8000-000000000003', 'c51-client-a@example.test'),
  ('c5100000-0000-4000-8000-000000000004', 'c51-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c5100000-0000-4000-8000-000000000002', 'employee'),
  ('c5100000-0000-4000-8000-000000000003', 'client'),
  ('c5100000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_c51_a', 'C51 Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('c5100000-0000-4000-8000-000000000003', 'act_c51_a');
INSERT INTO public.clients (slug, name, status, origin, does_creators, does_production) VALUES
  ('c51-alpha', 'C51 Alpha', 'active', 'manual', false, true);
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_c51_a', 'c51-alpha');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('c5100000-0000-4000-8000-000000000004', 'c51-alpha');

INSERT INTO public.locations (id, name, neighborhood, contact_name, contact_email, wifi_name, entry_instructions) VALUES
  ('c5100000-0000-4000-8000-0000000000a1', 'C51 Loft', 'Testville', 'Host Person', 'c51-host@example.test', 'c51-wifi', 'Code at the side door'),
  ('c5100000-0000-4000-8000-0000000000a2', 'C51 Garage', 'Sampletown', NULL, NULL, NULL, NULL);
INSERT INTO public.location_photos (location_id, storage_path) VALUES ('c5100000-0000-4000-8000-0000000000a1', 'c51/loft.jpg');
INSERT INTO storage.objects (bucket_id, name) VALUES ('location-photos', 'c51/loft.jpg');
INSERT INTO public.location_boards (id, client_slug, label, token) VALUES
  ('c5100000-0000-4000-8000-0000000000b1', 'c51-alpha', 'C51 shoot', 'c51SecretLocationToken00000000000000000000000001');
INSERT INTO public.location_board_items (board_id, location_id) VALUES
  ('c5100000-0000-4000-8000-0000000000b1', 'c5100000-0000-4000-8000-0000000000a1'),
  ('c5100000-0000-4000-8000-0000000000b1', 'c5100000-0000-4000-8000-0000000000a2');

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'c5100000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.locations), 0, 'client A reads no locations, so no host contact or wifi');
SELECT is((SELECT count(*)::int FROM public.location_photos), 0, 'client A reads no location photo rows');
SELECT is((SELECT count(*)::int FROM public.location_boards), 0, 'client A reads no location link, not even one for its own client');
SELECT is((SELECT count(*)::int FROM public.location_board_items), 0, 'client A reads no link items');
SELECT throws_ok($$INSERT INTO public.locations (name) VALUES ('client made')$$, '42501', NULL, 'client A cannot write locations directly');
SELECT throws_ok($$SELECT public.create_location('client made')$$, '42501', NULL, 'client A is refused create_location');
SELECT throws_ok($$SELECT public.update_location('c5100000-0000-4000-8000-0000000000a1', 'renamed')$$, '42501', NULL, 'client A is refused update_location');
SELECT throws_ok($$SELECT public.delete_location('c5100000-0000-4000-8000-0000000000a2')$$, '42501', NULL, 'client A is refused delete_location');
SELECT throws_ok($$SELECT public.set_location_capacity('c5100000-0000-4000-8000-0000000000a1', 1, 1, 1)$$, '42501', NULL, 'client A is refused set_location_capacity');
SELECT throws_ok($$SELECT public.set_location_entry_instructions('c5100000-0000-4000-8000-0000000000a1', 'x')$$, '42501', NULL, 'client A is refused set_location_entry_instructions');
SELECT throws_ok($$INSERT INTO public.location_boards (client_slug, token) VALUES ('c51-alpha', 'clientmade')$$, '42501', NULL, 'client A cannot make a location link');
SELECT lives_ok($$UPDATE public.location_boards SET revoked = true WHERE id = 'c5100000-0000-4000-8000-0000000000b1'$$, 'client A revoke runs but matches no row');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'location-photos'), 0, 'client A cannot see location photo files');

SELECT set_config('request.jwt.claim.sub', 'c5100000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.locations), 0, 'client B (member of the client) reads no locations');
SELECT is((SELECT count(*)::int FROM public.location_boards), 0, 'client B reads no location links');
SELECT throws_ok($$SELECT public.create_location('client made')$$, '42501', NULL, 'client B is refused create_location');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'c5100000-0000-4000-8000-000000000002', true);

SELECT is((SELECT revoked FROM public.location_boards WHERE id = 'c5100000-0000-4000-8000-0000000000b1'), false, 'the client A revoke changed nothing');
SELECT is((SELECT contact_email FROM public.locations WHERE id = 'c5100000-0000-4000-8000-0000000000a1'), 'c51-host@example.test', 'employee reads the host contact');
SELECT is((public.create_location('  C51 New  ', p_cost => 120, p_cost_period => 'daily'))->>'name', 'C51 New', 'employee adds a location, name trimmed');
SELECT throws_ok($$SELECT public.create_location('   ')$$, '22023', NULL, 'a blank name is refused');
SELECT throws_ok($$SELECT public.create_location('C51 Bad', p_cost => -1)$$, '22023', NULL, 'a negative cost is refused');
SELECT lives_ok($$SELECT public.update_location('c5100000-0000-4000-8000-0000000000a1', 'C51 Loft', p_neighborhood => 'Testville', p_have_rented => true, p_contact_email => 'c51-host@example.test')$$, 'employee edits a location');
SELECT is((SELECT have_rented FROM public.locations WHERE id = 'c5100000-0000-4000-8000-0000000000a1'), true, 'the edit is saved');
SELECT throws_ok($$SELECT public.set_location_capacity('c5100000-0000-4000-8000-0000000000a1', 2, -1, 4)$$, '22023', NULL, 'negative bathrooms are refused');
SELECT lives_ok($$SELECT public.set_location_capacity('c5100000-0000-4000-8000-0000000000a1', 2, 1.5, 6)$$, 'employee sets bedrooms, bathrooms and guests');
SELECT is((SELECT bathrooms FROM public.locations WHERE id = 'c5100000-0000-4000-8000-0000000000a1'), 1.5::numeric, 'half bathrooms are kept');
SELECT throws_ok($$SELECT public.update_location('c5100000-0000-4000-8000-00000000ffff', 'Nowhere')$$, 'P0002', NULL, 'editing a location that does not exist is refused');
SELECT lives_ok(
  $$WITH b AS (INSERT INTO public.location_boards (client_slug, label, token) VALUES (NULL, 'Scout list', 'c51SecretLocationToken00000000000000000000000002') RETURNING id)
    INSERT INTO public.location_board_items (board_id, location_id) SELECT id, 'c5100000-0000-4000-8000-0000000000a1' FROM b$$,
  'employee shares a location as a link with no client');
SELECT throws_ok(
  $$INSERT INTO public.location_board_items (board_id, location_id) VALUES ('c5100000-0000-4000-8000-0000000000b1', 'c5100000-0000-4000-8000-0000000000a1')$$,
  '23505', NULL, 'a location is on a link once');
SELECT lives_ok($$UPDATE public.location_boards SET revoked = true WHERE id = 'c5100000-0000-4000-8000-0000000000b1'$$, 'employee revokes a link');
SELECT is((public.delete_location('c5100000-0000-4000-8000-0000000000a2'))->>'name', 'C51 Garage', 'employee deletes a location with no photos');
SELECT is((SELECT count(*)::int FROM public.location_board_items WHERE board_id = 'c5100000-0000-4000-8000-0000000000b1'), 1, 'the deleted location left the link');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'location-photos' AND name = 'c51/loft.jpg'), 1, 'employee sees the photo file');

SELECT * FROM finish();
ROLLBACK;
