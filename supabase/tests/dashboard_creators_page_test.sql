-- Old dashboard batch 2 (step 5b): the Creators page and the creator page read
-- dashboard_creators, creator_assignments, creator_videos, creator_photos,
-- creator_filming_locations and the creator media buckets, and write
-- dashboard_creators and creator_assignments directly under the staff rules.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_b2c_a, which belongs to client b2c-alpha
--   client B   linked to client b2c-alpha through client_members
--   employee   staff
-- Creator contact details (email, shipping address) and media are staff only,
-- whatever a client login is linked to.

BEGIN;
SELECT plan(24);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('b2c00000-0000-4000-8000-000000000002', 'b2c-employee@example.test'),
  ('b2c00000-0000-4000-8000-000000000003', 'b2c-client-a@example.test'),
  ('b2c00000-0000-4000-8000-000000000004', 'b2c-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b2c00000-0000-4000-8000-000000000002', 'employee'),
  ('b2c00000-0000-4000-8000-000000000003', 'client'),
  ('b2c00000-0000-4000-8000-000000000004', 'client');

INSERT INTO public.ad_accounts (id, name) VALUES ('act_b2c_a', 'B2C Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('b2c00000-0000-4000-8000-000000000003', 'act_b2c_a');
INSERT INTO public.clients (slug, name, status, origin) VALUES ('b2c-alpha', 'B2C Alpha', 'active', 'manual');
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_b2c_a', 'b2c-alpha');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('b2c00000-0000-4000-8000-000000000004', 'b2c-alpha');

INSERT INTO public.dashboard_creators (id, name, email, shipping_address, headshot_path) VALUES
  ('b2c00000-0000-4000-8000-0000000000c1', 'B2C Creator', 'b2c-creator@example.test', '1 Test Street', 'b2c/headshot.jpg');
INSERT INTO public.creator_assignments (id, creator_id, client_slug, stage) VALUES
  ('b2c00000-0000-4000-8000-0000000000d1', 'b2c00000-0000-4000-8000-0000000000c1', 'b2c-alpha', 'shortlisted');
INSERT INTO public.creator_videos (creator_id, storage_path, sort_order) VALUES
  ('b2c00000-0000-4000-8000-0000000000c1', 'b2c/video-1.mp4', 1);
INSERT INTO public.creator_photos (creator_id, storage_path, category) VALUES
  ('b2c00000-0000-4000-8000-0000000000c1', 'b2c/pet.jpg', 'pet');
INSERT INTO public.creator_filming_locations (creator_id, storage_path) VALUES
  ('b2c00000-0000-4000-8000-0000000000c1', 'b2c/kitchen.jpg');
INSERT INTO storage.objects (bucket_id, name) VALUES ('creator-headshots', 'b2c/headshot.jpg');

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'b2c00000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.dashboard_creators), 0, 'client A reads no creators, so no creator email or address');
SELECT is((SELECT count(*)::int FROM public.creator_assignments), 0, 'client A reads no creator assignments, not even on its own client');
SELECT is((SELECT count(*)::int FROM public.creator_videos), 0, 'client A reads no creator videos');
SELECT is((SELECT count(*)::int FROM public.creator_photos), 0, 'client A reads no creator photos');
SELECT is((SELECT count(*)::int FROM public.creator_filming_locations), 0, 'client A reads no filming locations');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'creator-headshots'), 0, 'client A cannot see creator headshot files');
SELECT throws_ok($$INSERT INTO public.dashboard_creators (name) VALUES ('client creator')$$, '42501', NULL, 'client A cannot add a creator');
SELECT lives_ok($$UPDATE public.dashboard_creators SET do_not_use_again = true WHERE id = 'b2c00000-0000-4000-8000-0000000000c1'$$,
  'client A update runs but matches no row');
SELECT throws_ok($$INSERT INTO public.creator_videos (creator_id, storage_path, sort_order) VALUES ('b2c00000-0000-4000-8000-0000000000c1', 'x.mp4', 2)$$,
  '42501', NULL, 'client A cannot add a creator video');

SELECT set_config('request.jwt.claim.sub', 'b2c00000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.dashboard_creators), 0, 'client B (member of the client) reads no creators');
SELECT is((SELECT count(*)::int FROM public.creator_assignments), 0, 'client B reads no creator assignments');
SELECT is((SELECT count(*)::int FROM public.creator_videos), 0, 'client B reads no creator videos');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'creator-headshots'), 0, 'client B cannot see creator headshot files');
SELECT throws_ok($$INSERT INTO public.creator_assignments (creator_id, client_slug) VALUES ('b2c00000-0000-4000-8000-0000000000c1', 'b2c-alpha')$$,
  '42501', NULL, 'client B cannot add a creator to its own client');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'b2c00000-0000-4000-8000-000000000002', true);

SELECT is((SELECT do_not_use_again FROM public.dashboard_creators WHERE id = 'b2c00000-0000-4000-8000-0000000000c1'), false,
  'the client A update changed nothing');
SELECT is((SELECT email FROM public.dashboard_creators WHERE id = 'b2c00000-0000-4000-8000-0000000000c1'), 'b2c-creator@example.test',
  'employee reads the creator profile');
SELECT is((SELECT count(*)::int FROM public.creator_videos WHERE creator_id = 'b2c00000-0000-4000-8000-0000000000c1'), 1, 'employee reads creator videos');
SELECT is((SELECT count(*)::int FROM public.creator_photos WHERE creator_id = 'b2c00000-0000-4000-8000-0000000000c1'), 1, 'employee reads creator photos');
SELECT is((SELECT count(*)::int FROM public.creator_filming_locations WHERE creator_id = 'b2c00000-0000-4000-8000-0000000000c1'), 1, 'employee reads filming locations');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'creator-headshots' AND name = 'b2c/headshot.jpg'), 1, 'employee sees the headshot file');
SELECT lives_ok(
  $$UPDATE public.dashboard_creators SET location = 'Boston', updated_at = now() WHERE id = 'b2c00000-0000-4000-8000-0000000000c1'$$,
  'employee saves a profile field');
SELECT is((SELECT location FROM public.dashboard_creators WHERE id = 'b2c00000-0000-4000-8000-0000000000c1'), 'Boston',
  'and the change is stored');
SELECT lives_ok(
  $$INSERT INTO public.dashboard_creators (name, email, source) VALUES ('B2C Added By Hand', 'hand@example.test', 'manual')$$,
  'employee adds a creator by hand');
SELECT throws_ok(
  $$INSERT INTO public.creator_assignments (creator_id, client_slug) VALUES ('b2c00000-0000-4000-8000-0000000000c1', 'b2c-alpha')$$,
  '23505', NULL, 'adding a creator to a brand they are already on is refused');

SELECT * FROM finish();
ROLLBACK;
