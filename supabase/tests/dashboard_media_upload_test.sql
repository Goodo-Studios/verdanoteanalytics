-- Phase 6b: staff upload and delete creator, actor and location photos and videos in Verdanote.
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- The page uploads with the staff member's own login: storage signs an upload link only when
-- the staff write policy on the bucket (migration 20261101000004) allows an insert, the file is
-- sent to that link, and the row is added under the staff row rules (migration 20261101000003).
-- A client login must be refused at every step: signing (the insert policy), the row insert and
-- the delete. This also covers the new function storage_signing_secrets_present() (migration
-- 20261114000001), which Integration health uses to say whether the two vault secrets for
-- copying and removing files are set. It returns names and true or false, never a value, and
-- only the service role can call it.
--
-- Who is who (all made up):
--   client A   a client login linked to an ad account
--   client B   a client login linked to a client through client_members
--   employee   staff

BEGIN;
SELECT plan(62);

-- Newer storage schemas refuse a direct DELETE on storage.objects unless this is set (the Storage
-- API sets it for itself). It changes nothing about who may delete: the delete policy still applies.
SET LOCAL storage.allow_delete_query = 'true';

-- ---------------------------------------------------------------- the secrets check
SELECT has_function('public', 'storage_signing_secrets_present', ARRAY[]::text[], 'storage_signing_secrets_present() exists');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.storage_signing_secrets_present()'::regprocedure), true,
  'it is SECURITY DEFINER, so it can read the vault for the service role');
SELECT ok(NOT has_function_privilege('anon', 'public.storage_signing_secrets_present()', 'EXECUTE'), 'anon cannot call it');
SELECT ok(NOT has_function_privilege('authenticated', 'public.storage_signing_secrets_present()', 'EXECUTE'), 'a signed-in login (staff or client) cannot call it');
SELECT ok(has_function_privilege('service_role', 'public.storage_signing_secrets_present()', 'EXECUTE'), 'the service role can call it');

DELETE FROM vault.secrets WHERE name IN ('storage_signing_project_url', 'storage_signing_service_role_key');
SELECT is(public.storage_signing_secrets_present(),
  '{"storage_signing_project_url": false, "storage_signing_service_role_key": false}'::jsonb,
  'with neither secret in the vault, both are reported missing');
SELECT lives_ok($$SELECT vault.create_secret('placeholder-value-not-real', 'storage_signing_project_url')$$, 'a test project url secret is put in the local test vault');
SELECT is(public.storage_signing_secrets_present(),
  '{"storage_signing_project_url": true, "storage_signing_service_role_key": false}'::jsonb,
  'one present and one missing is reported name by name');
SELECT lives_ok($$SELECT vault.create_secret('another-placeholder-not-real', 'storage_signing_service_role_key')$$, 'a test service key secret is put in the local test vault');
SELECT is(public.storage_signing_secrets_present(),
  '{"storage_signing_project_url": true, "storage_signing_service_role_key": true}'::jsonb,
  'with both in the vault, both are reported present');
SELECT is(position('placeholder' IN public.storage_signing_secrets_present()::text), 0, 'the answer never contains a secret value');
SELECT is((SELECT count(*)::int FROM jsonb_object_keys(public.storage_signing_secrets_present())), 2, 'and carries only the two names');

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('6b000000-0000-4000-8000-000000000002', 'p6b-employee@example.test'),
  ('6b000000-0000-4000-8000-000000000003', 'p6b-client-a@example.test'),
  ('6b000000-0000-4000-8000-000000000004', 'p6b-client-b@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('6b000000-0000-4000-8000-000000000002', 'employee'),
  ('6b000000-0000-4000-8000-000000000003', 'client'),
  ('6b000000-0000-4000-8000-000000000004', 'client');
INSERT INTO public.ad_accounts (id, name) VALUES ('act_p6b_a', 'P6B Alpha');
INSERT INTO public.user_accounts (user_id, account_id) VALUES ('6b000000-0000-4000-8000-000000000003', 'act_p6b_a');
INSERT INTO public.clients (slug, name, status, origin) VALUES ('p6b-alpha', 'P6B Alpha', 'active', 'manual');
INSERT INTO public.client_ad_accounts (account_id, client_slug) VALUES ('act_p6b_a', 'p6b-alpha');
INSERT INTO public.client_members (user_id, client_slug) VALUES ('6b000000-0000-4000-8000-000000000004', 'p6b-alpha');

INSERT INTO public.dashboard_creators (id, name) VALUES ('6b000000-0000-4000-8000-0000000000c1', 'P6B Creator');
INSERT INTO public.actors (id, name) VALUES ('6b000000-0000-4000-8000-0000000000a1', 'P6B Actor');
INSERT INTO public.locations (id, name) VALUES ('6b000000-0000-4000-8000-0000000000e1', 'P6B Location');

-- A file and a row that staff own, which a client must not be able to remove.
INSERT INTO storage.objects (bucket_id, name) VALUES ('creator-videos', '6b/staff-owned.mp4');
INSERT INTO public.creator_photos (id, creator_id, storage_path, category) VALUES
  ('6b000000-0000-4000-8000-0000000000f1', '6b000000-0000-4000-8000-0000000000c1', '6b/staff-owned.jpg', 'family');
INSERT INTO public.location_photos (id, location_id, storage_path, sort_order) VALUES
  ('6b000000-0000-4000-8000-0000000000f2', '6b000000-0000-4000-8000-0000000000e1', '6b/staff-owned-loc.jpg', 0);

-- ---------------------------------------------------------------- a client cannot upload or delete
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '6b000000-0000-4000-8000-000000000003', true);

SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('creator-videos', '6b/c/video-new.mp4')$$, '42501', NULL, 'client A cannot sign or upload a creator video');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('creator-headshots', '6b/c/headshot-new.jpg')$$, '42501', NULL, 'client A cannot upload a creator headshot');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('creator-family-pet-photos', '6b/c/photo-new.jpg')$$, '42501', NULL, 'client A cannot upload a creator family or pet photo');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('creator-filming-locations', '6b/c/location-new.jpg')$$, '42501', NULL, 'client A cannot upload a creator filming location photo');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('actor-headshots', '6b/a/headshot-new.jpg')$$, '42501', NULL, 'client A cannot upload an actor headshot');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('actor-videos', '6b/a/video-new.mp4')$$, '42501', NULL, 'client A cannot upload an actor video');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('actor-photos', '6b/a/photo-new.jpg')$$, '42501', NULL, 'client A cannot upload an actor photo');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('location-photos', '6b/l/photo-new.jpg')$$, '42501', NULL, 'client A cannot upload a location photo');

SELECT throws_ok($$INSERT INTO public.creator_videos (creator_id, storage_path, sort_order) VALUES ('6b000000-0000-4000-8000-0000000000c1', 'x.mp4', 1)$$, '42501', NULL, 'client A cannot add a creator video row');
SELECT throws_ok($$INSERT INTO public.creator_photos (creator_id, storage_path, category) VALUES ('6b000000-0000-4000-8000-0000000000c1', 'x.jpg', 'pet')$$, '42501', NULL, 'client A cannot add a creator photo row');
SELECT throws_ok($$INSERT INTO public.creator_filming_locations (creator_id, storage_path) VALUES ('6b000000-0000-4000-8000-0000000000c1', 'x.jpg')$$, '42501', NULL, 'client A cannot add a filming location row');
SELECT throws_ok($$INSERT INTO public.actor_videos (actor_id, storage_path, sort_order) VALUES ('6b000000-0000-4000-8000-0000000000a1', 'x.mp4', 1)$$, '42501', NULL, 'client A cannot add an actor video row');
SELECT throws_ok($$INSERT INTO public.actor_photos (actor_id, storage_path) VALUES ('6b000000-0000-4000-8000-0000000000a1', 'x.jpg')$$, '42501', NULL, 'client A cannot add an actor photo row');
SELECT throws_ok($$INSERT INTO public.location_photos (location_id, storage_path) VALUES ('6b000000-0000-4000-8000-0000000000e1', 'x.jpg')$$, '42501', NULL, 'client A cannot add a location photo row');

SELECT lives_ok($$DELETE FROM storage.objects WHERE bucket_id = 'creator-videos' AND name = '6b/staff-owned.mp4'$$, 'client A delete of a file runs but matches nothing');
SELECT lives_ok($$DELETE FROM public.creator_photos WHERE id = '6b000000-0000-4000-8000-0000000000f1'$$, 'client A delete of a photo row runs but matches nothing');
SELECT lives_ok($$UPDATE public.location_photos SET sort_order = 9 WHERE id = '6b000000-0000-4000-8000-0000000000f2'$$, 'client A cannot reorder a location photo (matches nothing)');
SELECT lives_ok($$UPDATE public.dashboard_creators SET headshot_path = 'client/headshot.jpg' WHERE id = '6b000000-0000-4000-8000-0000000000c1'$$, 'client A cannot set a headshot (matches nothing)');

SELECT set_config('request.jwt.claim.sub', '6b000000-0000-4000-8000-000000000004', true);
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('location-photos', '6b/l/photo-b.jpg')$$, '42501', NULL, 'client B (member of the client) cannot upload a location photo');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('actor-photos', '6b/a/photo-b.jpg')$$, '42501', NULL, 'client B cannot upload an actor photo');
SELECT throws_ok($$INSERT INTO public.location_photos (location_id, storage_path) VALUES ('6b000000-0000-4000-8000-0000000000e1', 'b.jpg')$$, '42501', NULL, 'client B cannot add a location photo row');
SELECT lives_ok($$DELETE FROM public.location_photos WHERE id = '6b000000-0000-4000-8000-0000000000f2'$$, 'client B delete of a location photo runs but matches nothing');

-- ---------------------------------------------------------------- staff can
SELECT set_config('request.jwt.claim.sub', '6b000000-0000-4000-8000-000000000002', true);

SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'creator-videos' AND name = '6b/staff-owned.mp4'), 1, 'the staff-owned file survived both client deletes');
SELECT is((SELECT count(*)::int FROM public.creator_photos WHERE id = '6b000000-0000-4000-8000-0000000000f1'), 1, 'the staff-owned photo row survived the client delete');
SELECT is((SELECT sort_order FROM public.location_photos WHERE id = '6b000000-0000-4000-8000-0000000000f2'), 0, 'and the client reorder changed nothing');
SELECT is((SELECT headshot_path FROM public.dashboard_creators WHERE id = '6b000000-0000-4000-8000-0000000000c1'), NULL, 'and no client set a headshot');

SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('creator-videos', '6b/c/video-new.mp4')$$, 'staff can sign and upload a creator video');
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('creator-headshots', '6b/c/headshot-new.jpg')$$, 'staff can upload a creator headshot');
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('creator-family-pet-photos', '6b/c/photo-new.jpg')$$, 'staff can upload a creator family or pet photo');
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('creator-filming-locations', '6b/c/location-new.jpg')$$, 'staff can upload a creator filming location photo');
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('actor-headshots', '6b/a/headshot-new.jpg')$$, 'staff can upload an actor headshot');
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('actor-videos', '6b/a/video-new.mp4')$$, 'staff can upload an actor video');
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('actor-photos', '6b/a/photo-new.jpg')$$, 'staff can upload an actor photo');
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('location-photos', '6b/l/photo-new.jpg')$$, 'staff can upload a location photo');

SELECT lives_ok($$INSERT INTO public.creator_videos (creator_id, storage_path, sort_order, title, size_bytes, mime_type) VALUES ('6b000000-0000-4000-8000-0000000000c1', '6b/c/video-new.mp4', 1, 'Take one', 1234, 'video/mp4')$$, 'staff add a creator video row with its size and type');
SELECT lives_ok($$INSERT INTO public.creator_photos (creator_id, storage_path, category, sort_order) VALUES ('6b000000-0000-4000-8000-0000000000c1', '6b/c/photo-new.jpg', 'pet', 1)$$, 'staff add a pet photo row');
SELECT lives_ok($$INSERT INTO public.creator_filming_locations (creator_id, storage_path, sort_order) VALUES ('6b000000-0000-4000-8000-0000000000c1', '6b/c/location-new.jpg', 0)$$, 'staff add a filming location row');
SELECT lives_ok($$INSERT INTO public.actor_videos (actor_id, storage_path, sort_order, size_bytes, mime_type) VALUES ('6b000000-0000-4000-8000-0000000000a1', '6b/a/video-new.mp4', 1, 99, 'video/quicktime')$$, 'staff add an actor video row');
SELECT lives_ok($$INSERT INTO public.actor_photos (actor_id, storage_path, sort_order) VALUES ('6b000000-0000-4000-8000-0000000000a1', '6b/a/photo-new.jpg', 0)$$, 'staff add an actor photo row');
SELECT lives_ok($$INSERT INTO public.location_photos (location_id, storage_path, sort_order) VALUES ('6b000000-0000-4000-8000-0000000000e1', '6b/l/photo-new.jpg', 1)$$, 'staff add a location photo row');

SELECT throws_ok($$INSERT INTO public.creator_videos (creator_id, storage_path, sort_order) VALUES ('6b000000-0000-4000-8000-0000000000c1', '6b/c/video-dup.mp4', 1)$$, '23505', NULL,
  'a video position that is taken is refused, which the page answers by reading the list again and retrying');

SELECT lives_ok($$INSERT INTO public.actor_photos (actor_id, storage_path, sort_order) SELECT '6b000000-0000-4000-8000-0000000000a1', '6b/a/photo-' || g, g FROM generate_series(1, 7) g$$, 'staff fill an actor to 8 photos');
SELECT throws_ok($$INSERT INTO public.actor_photos (actor_id, storage_path, sort_order) VALUES ('6b000000-0000-4000-8000-0000000000a1', '6b/a/photo-9.jpg', 9)$$, '23514', NULL, 'a 9th actor photo is refused by the limit');

SELECT lives_ok($$UPDATE public.dashboard_creators SET headshot_path = '6b/c/headshot-new.jpg', updated_at = now() WHERE id = '6b000000-0000-4000-8000-0000000000c1'$$, 'staff set a headshot');
SELECT is((SELECT headshot_path FROM public.dashboard_creators WHERE id = '6b000000-0000-4000-8000-0000000000c1'), '6b/c/headshot-new.jpg', 'and it is stored');

SELECT lives_ok($$UPDATE public.location_photos SET sort_order = 0 WHERE id = (SELECT id FROM public.location_photos WHERE storage_path = '6b/l/photo-new.jpg')$$, 'staff can set a location photo as the main one');

SELECT lives_ok($$DELETE FROM storage.objects WHERE bucket_id = 'creator-videos' AND name = '6b/staff-owned.mp4'$$, 'staff can delete a file');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'creator-videos' AND name = '6b/staff-owned.mp4'), 0, 'and it is gone');
SELECT lives_ok($$DELETE FROM public.creator_photos WHERE id = '6b000000-0000-4000-8000-0000000000f1'$$, 'staff can delete a photo row');
SELECT is((SELECT count(*)::int FROM public.creator_photos WHERE id = '6b000000-0000-4000-8000-0000000000f1'), 0, 'and it is gone');

SELECT * FROM finish();
ROLLBACK;
