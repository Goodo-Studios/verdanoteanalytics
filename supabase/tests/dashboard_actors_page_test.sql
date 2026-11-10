-- Old dashboard batch 2 (step 5b): the Actors page and the actor page read
-- actors, actor_assignments, actor_videos, actor_photos and the actor media
-- buckets, and write actors directly under the staff rules.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Who is who (all made up):
--   client A   linked to ad account act_b2a_a, which belongs to client b2a-alpha
--   client B   linked to client b2a-alpha through client_members
--   employee   staff
-- Actor contact details (email, phone) and media are staff only, even for a
-- client login linked to the client the actor is cast on.

BEGIN;
SELECT plan(20);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('b2a00000-0000-4000-8000-000000000002', 'b2a-employee@example.test'),
  ('b2a00000-0000-4000-8000-000000000003', 'b2a-client-a@example.test'),
  ('b2a00000-0000-4000-8000-000000000004', 'b2a-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b2a00000-0000-4000-8000-000000000002', 'employee'),
  ('b2a00000-0000-4000-8000-000000000003', 'client'),
  ('b2a00000-0000-4000-8000-000000000004', 'client');

INSERT INTO public.ad_accounts (id, name) VALUES ('act_b2a_a', 'B2A Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('b2a00000-0000-4000-8000-000000000003', 'act_b2a_a');
INSERT INTO public.clients (slug, name, status, origin, does_creators, does_production) VALUES ('b2a-alpha', 'B2A Alpha', 'active', 'manual', false, true);
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_b2a_a', 'b2a-alpha');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('b2a00000-0000-4000-8000-000000000004', 'b2a-alpha');

INSERT INTO public.actors (id, name, email, phone, headshot_path) VALUES
  ('b2a00000-0000-4000-8000-0000000000a1', 'B2A Actor', 'b2a-actor@example.test', '555-0101', 'b2a/headshot.jpg');
INSERT INTO public.actor_assignments (id, actor_id, client_slug, stage) VALUES
  ('b2a00000-0000-4000-8000-0000000000d1', 'b2a00000-0000-4000-8000-0000000000a1', 'b2a-alpha', 'booked');
INSERT INTO public.actor_videos (actor_id, storage_path, sort_order) VALUES ('b2a00000-0000-4000-8000-0000000000a1', 'b2a/reel.mp4', 1);
INSERT INTO public.actor_photos (actor_id, storage_path) VALUES ('b2a00000-0000-4000-8000-0000000000a1', 'b2a/photo.jpg');
INSERT INTO storage.objects (bucket_id, name) VALUES ('actor-headshots', 'b2a/headshot.jpg');

-- ---------------------------------------------------------------- client wall
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', 'b2a00000-0000-4000-8000-000000000003', true);

SELECT is((SELECT count(*)::int FROM public.actors), 0, 'client A reads no actors, so no actor email or phone');
SELECT is((SELECT count(*)::int FROM public.actor_assignments), 0, 'client A reads no castings, not even on its own client');
SELECT is((SELECT count(*)::int FROM public.actor_videos), 0, 'client A reads no actor videos');
SELECT is((SELECT count(*)::int FROM public.actor_photos), 0, 'client A reads no actor photos');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'actor-headshots'), 0, 'client A cannot see actor headshot files');
SELECT throws_ok($$INSERT INTO public.actors (name) VALUES ('client actor')$$, '42501', NULL, 'client A cannot add an actor');
SELECT lives_ok($$UPDATE public.actors SET do_not_use_again = true WHERE id = 'b2a00000-0000-4000-8000-0000000000a1'$$,
  'client A update runs but matches no row');
SELECT lives_ok($$DELETE FROM public.actors WHERE id = 'b2a00000-0000-4000-8000-0000000000a1'$$,
  'client A delete runs but matches no row');

SELECT set_config('request.jwt.claim.sub', 'b2a00000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.actors), 0, 'client B (member of the client) reads no actors');
SELECT is((SELECT count(*)::int FROM public.actor_assignments), 0, 'client B reads no castings');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'actor-headshots'), 0, 'client B cannot see actor headshot files');
SELECT throws_ok($$INSERT INTO public.actor_photos (actor_id, storage_path) VALUES ('b2a00000-0000-4000-8000-0000000000a1', 'x.jpg')$$,
  '42501', NULL, 'client B cannot add an actor photo');

-- ---------------------------------------------------------------- employee
SELECT set_config('request.jwt.claim.sub', 'b2a00000-0000-4000-8000-000000000002', true);

SELECT is((SELECT count(*)::int FROM public.actors WHERE id = 'b2a00000-0000-4000-8000-0000000000a1' AND NOT do_not_use_again), 1,
  'the client A update and delete changed nothing');
SELECT is((SELECT phone FROM public.actors WHERE id = 'b2a00000-0000-4000-8000-0000000000a1'), '555-0101', 'employee reads the actor profile');
SELECT is((SELECT stage FROM public.actor_assignments WHERE id = 'b2a00000-0000-4000-8000-0000000000d1'), 'booked', 'employee reads the casting');
SELECT is((SELECT count(*)::int FROM public.actor_videos WHERE actor_id = 'b2a00000-0000-4000-8000-0000000000a1'), 1, 'employee reads actor videos');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'actor-headshots' AND name = 'b2a/headshot.jpg'), 1, 'employee sees the headshot file');
SELECT lives_ok(
  $$UPDATE public.actors SET skills = ARRAY['Comedy'], dog_owner = NULL, updated_at = now() WHERE id = 'b2a00000-0000-4000-8000-0000000000a1'$$,
  'employee saves profile fields');
SELECT is((SELECT skills FROM public.actors WHERE id = 'b2a00000-0000-4000-8000-0000000000a1'), ARRAY['Comedy']::text[], 'and the change is stored');
SELECT lives_ok($$INSERT INTO public.actors (name, email, source) VALUES ('B2A Added By Hand', 'hand@example.test', 'manual')$$,
  'employee adds an actor by hand');

SELECT * FROM finish();
ROLLBACK;
