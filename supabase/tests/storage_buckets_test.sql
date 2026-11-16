-- Storage wall: every bucket, checked as anon, as a client and as the bucket list (audit Batch 9).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- The table side of the client wall is client_reads_only_own_rows_test.sql. This is the storage
-- side. Fixtures, all made up: a client login (linked to no account) and an "other" user who owns
-- one file in every bucket, under other/<other user id>/.
--
-- Checks
--   1. The buckets are exactly the 20 production has (production-check 2026-11-15), so a bucket
--      made by hand in the dashboard and missing from migrations fails CI.
--   2. Only ad-media, ad-thumbnails and ad-videos are public.
--   3. One file was seeded in every bucket, so the checks below cannot pass by seeing nothing.
--   4. anon reads no file in a private bucket.
--   5. anon can upload into no bucket.
--   6. A client reads no other user's file in a private bucket.
--   7. A client can upload into no bucket.
--
-- KNOWN OPEN HOLES, listed so they stay visible. Each is closed by its own restrictive release
-- (plan ground rule 4) and removed from these lists in that release:
--   client upload: ad-thumbnails, ad-videos (policies "Service role can upload ..." are TO public
--                  with only a bucket check), annotations ("Auth users can upload
--                  annotations" has no owner check), inspiration-media (own folder; Vault is
--                  staff only per decision 5)

BEGIN;
SELECT plan(7);

INSERT INTO auth.users (id, email) VALUES
  ('5b000000-0000-4000-8000-000000000001', 'storage-client@example.test'),
  ('5b000000-0000-4000-8000-000000000002', 'storage-other@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('5b000000-0000-4000-8000-000000000001', 'client');

-- The bucket list, read here as the test owner so the role checks below do not depend on whether
-- anon or a client may list buckets.
CREATE TEMP TABLE wall_buckets AS SELECT id, public FROM storage.buckets;
GRANT SELECT ON wall_buckets TO anon, authenticated;

-- One file per bucket, owned by the other user.
INSERT INTO storage.objects (bucket_id, name, owner)
SELECT id, 'other/5b000000-0000-4000-8000-000000000002/file.jpg', '5b000000-0000-4000-8000-000000000002'
  FROM wall_buckets;

-- 1. The bucket list matches production.
SELECT set_eq(
  $$SELECT id FROM wall_buckets$$,
  ARRAY[
    'actor-application-headshots', 'actor-application-videos', 'actor-headshots', 'actor-photos',
    'actor-videos', 'ad-media', 'ad-thumbnails', 'ad-videos', 'annotations', 'company-docs',
    'creative-archive', 'creator-application-headshots', 'creator-application-videos',
    'creator-family-pet-photos', 'creator-filming-locations', 'creator-headshots', 'creator-videos',
    'inspiration-media', 'location-photos', 'moodboard-refs'
  ],
  'the buckets are exactly the 20 that production has'
);

-- 2. Only the three ad media buckets are public.
SELECT set_eq(
  $$SELECT id FROM wall_buckets WHERE public$$,
  ARRAY['ad-media', 'ad-thumbnails', 'ad-videos'],
  'only ad-media, ad-thumbnails and ad-videos are public'
);

-- 3. The seed reached every bucket.
SELECT is(
  (SELECT count(DISTINCT bucket_id)::int FROM storage.objects WHERE name LIKE 'other/%'),
  (SELECT count(*)::int FROM wall_buckets),
  'one file was seeded in every bucket'
);

-- Tries one upload per bucket as the current role, into the caller's own folder (the most
-- generous path), and returns the buckets where it went through.
CREATE FUNCTION pg_temp.uploads_allowed(p_folder text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  b text;
  allowed text[] := ARRAY[]::text[];
BEGIN
  FOR b IN SELECT id FROM wall_buckets ORDER BY id LOOP
    BEGIN
      INSERT INTO storage.objects (bucket_id, name) VALUES (b, 'probe/' || p_folder || '/upload.jpg');
      allowed := allowed || b;
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
      NULL;
    END;
  END LOOP;
  RETURN allowed;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.uploads_allowed(text) TO anon, authenticated;

-- Private-bucket files the current role can read (other users' only when p_other_only). Some
-- storage policies are TO public and call has_role(), which anon may not execute, so for anon the
-- read is refused with 42501 instead of returning rows; a refused read counts as zero files.
CREATE FUNCTION pg_temp.readable_private_files(p_other_only boolean) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  n int;
BEGIN
  SELECT count(*)::int INTO n FROM storage.objects
   WHERE bucket_id IN (SELECT id FROM wall_buckets WHERE NOT public)
     AND (NOT p_other_only OR name LIKE 'other/%');
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN 0;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.readable_private_files(boolean) TO anon, authenticated;

-- 4 and 5 as anon.
SET LOCAL role anon;
SELECT is(pg_temp.readable_private_files(false), 0, 'anon reads no file in a private bucket');
SELECT set_eq(
  $$SELECT unnest(pg_temp.uploads_allowed('anon'))$$,
  -- The "Service role can upload ..." policies are TO public, so they also cover anon. anon is
  -- refused today only because another TO public policy calls has_role(), which anon may not run
  -- (same in production, checked 2026-11-16). Granting has_role to anon would open these buckets,
  -- and this check would catch it.
  ARRAY[]::text[],
  'anon can upload into no bucket'
);
RESET role;

-- 6 and 7 as the client.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '5b000000-0000-4000-8000-000000000001', true);
SELECT is(pg_temp.readable_private_files(true), 0, 'a client reads no other user''s file in a private bucket');
SELECT set_eq(
  $$SELECT unnest(pg_temp.uploads_allowed('5b000000-0000-4000-8000-000000000001'))$$,
  -- ad-thumbnails, ad-videos and annotations were closed by migration 20261216490001.
  -- inspiration-media stays open until the Vault upload moves server-side (audit 1.6 step 3).
  ARRAY['inspiration-media'],
  'a client can upload only where a known open hole is listed'
);
RESET role;

SELECT * FROM finish();
ROLLBACK;
