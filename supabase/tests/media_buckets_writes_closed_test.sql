-- ad-thumbnails and ad-videos: anyone may read, nobody but the service role may write
-- (audit plan item 1.1).
--
-- The "Service role can upload/update ..." policies had no TO clause. The service role ignores
-- policies, so their only effect was to let anon and every signed-in user upload or overwrite
-- files in both buckets. Every real uploader is an edge function using the service-role key.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(8);

INSERT INTO auth.users (id, email) VALUES
  ('c1100000-0000-4000-8000-000000000001', 'media-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1100000-0000-4000-8000-000000000001', 'client');

-- A file the sync put there, which nobody but the service role may replace.
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('ad-thumbnails', 'c11/existing.jpg'),
  ('ad-videos', 'c11/existing.mp4');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '''ad-(thumbnails|videos)'''),
  0, 'no write policy mentions ad-thumbnails or ad-videos');

-- ---------------------------------------------------------------- anon (2-3)
SET LOCAL ROLE anon;
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('ad-thumbnails', 'c11/anon.jpg')$$,
  '42501', NULL, 'anon cannot upload a thumbnail');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('ad-videos', 'c11/anon.mp4')$$,
  '42501', NULL, 'anon cannot upload a video');
RESET ROLE;

-- ---------------------------------------------------------------- signed in (4-6)
SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1100000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('ad-thumbnails', 'c11/client.jpg')$$,
  '42501', NULL, 'a signed-in client cannot upload a thumbnail');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('ad-videos', 'c11/client.mp4')$$,
  '42501', NULL, 'a signed-in client cannot upload a video');
UPDATE storage.objects SET name = 'c11/overwritten.jpg' WHERE bucket_id = 'ad-thumbnails' AND name = 'c11/existing.jpg';
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'ad-thumbnails' AND name = 'c11/existing.jpg'),
  1, 'a signed-in client cannot overwrite an existing thumbnail (the update matches nothing)');

-- ---------------------------------------------------------------- public read stays (7-8)
SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'ad-thumbnails' AND name = 'c11/existing.jpg'),
  1, 'anon still reads thumbnails');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'ad-videos' AND name = 'c11/existing.mp4'),
  1, 'anon still reads videos');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
