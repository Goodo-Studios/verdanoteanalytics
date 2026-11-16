-- Storage write holes in ad-thumbnails, ad-videos and annotations (audit Batch 9, ground rule 4
-- step (c)).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- "Service role can upload/update thumbnails/videos" were created TO public with only a bucket
-- check, so any signed-in user (clients included) could upload or overwrite files in the two
-- publicly served ad media buckets. "Auth users can upload annotations" and "Auth users can
-- delete own annotations" had no owner check. Only edge functions write these buckets, with the
-- service role, which bypasses these rules; no app code writes them (checked in the code, the live
-- bundle and the storage logs on 2026-11-16). The fix drops the six policies.
--
-- Fixtures, all made up: a client login, a staff (employee) login, and one file per bucket owned
-- by neither.

BEGIN;
SELECT plan(8);

INSERT INTO auth.users (id, email) VALUES
  ('5c000000-0000-4000-8000-000000000001', 'admedia-client@example.test'),
  ('5c000000-0000-4000-8000-000000000002', 'admedia-staff@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('5c000000-0000-4000-8000-000000000001', 'client'),
  ('5c000000-0000-4000-8000-000000000002', 'employee');

INSERT INTO storage.objects (bucket_id, name) VALUES
  ('ad-thumbnails', 'seed/thumb.jpg'),
  ('ad-videos', 'seed/video.mp4'),
  ('annotations', 'seed/note.png');

-- Buckets (of the three) where the current role could upload a new file.
CREATE FUNCTION pg_temp.uploads_allowed() RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  b text;
  allowed text[] := ARRAY[]::text[];
BEGIN
  FOREACH b IN ARRAY ARRAY['ad-thumbnails', 'ad-videos', 'annotations'] LOOP
    BEGIN
      INSERT INTO storage.objects (bucket_id, name) VALUES (b, 'probe/' || auth.uid() || '/upload.jpg');
      allowed := allowed || b;
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
      NULL;
    END;
  END LOOP;
  RETURN allowed;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.uploads_allowed() TO authenticated;

-- Seeded files the current role could overwrite (UPDATE) or delete. RLS hides rows it refuses,
-- so a refused change touches 0 rows instead of raising.
CREATE FUNCTION pg_temp.seed_files_changed() RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  n int := 0;
  k int;
BEGIN
  UPDATE storage.objects SET metadata = '{"overwritten": true}'::jsonb
   WHERE name LIKE 'seed/%' AND bucket_id IN ('ad-thumbnails', 'ad-videos', 'annotations');
  GET DIAGNOSTICS k = ROW_COUNT;
  n := n + k;
  DELETE FROM storage.objects WHERE bucket_id = 'annotations' AND name = 'seed/note.png';
  GET DIAGNOSTICS k = ROW_COUNT;
  RETURN n + k;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN n;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.seed_files_changed() TO authenticated;

-- The six policies are gone.
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN (
       'Service role can upload thumbnails', 'Service role can update thumbnails',
       'Service role can upload videos', 'Service role can update videos',
       'Auth users can upload annotations', 'Auth users can delete own annotations')),
  0,
  'the six open write policies on ad-thumbnails, ad-videos and annotations are dropped'
);

-- Reads that stay: the two ad media buckets are still public.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
            AND policyname = 'Public can view ad thumbnails'),
  'public read of ad thumbnails stays'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
            AND policyname = 'Public can view ad videos'),
  'public read of ad videos stays'
);

-- As the client.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '5c000000-0000-4000-8000-000000000001', true);
SELECT is(pg_temp.uploads_allowed(), ARRAY[]::text[], 'a client can upload into none of the three buckets');
SELECT is(pg_temp.seed_files_changed(), 0, 'a client can overwrite or delete no file in them');
RESET role;

-- As staff: the app has no staff upload for these buckets either; edge functions write them.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '5c000000-0000-4000-8000-000000000002', true);
SELECT is(pg_temp.uploads_allowed(), ARRAY[]::text[], 'staff can upload into none of the three buckets');
SELECT is(pg_temp.seed_files_changed(), 0, 'staff can overwrite or delete no file in them');
RESET role;

-- The service role (edge functions) still writes.
SET LOCAL role service_role;
INSERT INTO storage.objects (bucket_id, name) VALUES ('ad-thumbnails', 'service/thumb.jpg');
RESET role;
SELECT ok(
  EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'ad-thumbnails' AND name = 'service/thumb.jpg'),
  'the service role can still upload'
);

SELECT * FROM finish();
ROLLBACK;
