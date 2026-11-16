-- annotations bucket: signed-in users can no longer upload or delete files (audit plan item 1.2).
--
-- "Auth users can upload annotations" and "Auth users can delete own annotations" only checked
-- the bucket, so any signed-in user (and, with public sign-up on, anyone) could add files or
-- delete anyone's file. Nothing in the app or the edge functions uses annotations today. The
-- account-scoped read policy from 20260808000002 stays.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(5);

SET LOCAL storage.allow_delete_query = 'true';

INSERT INTO auth.users (id, email) VALUES
  ('c1200000-0000-4000-8000-000000000001', 'annotations-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1200000-0000-4000-8000-000000000001', 'client');

-- A file someone else put there.
INSERT INTO storage.objects (bucket_id, name) VALUES ('annotations', 'c12/other.png');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '''annotations'''),
  0, 'no write policy mentions the annotations bucket');

SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1200000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('annotations', 'c12/new.png')$$,
  '42501', NULL, 'a signed-in user cannot upload an annotation image');
SELECT lives_ok($$DELETE FROM storage.objects WHERE bucket_id = 'annotations' AND name = 'c12/other.png'$$,
  'a signed-in user delete runs but matches nothing');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'annotations' AND name = 'c12/other.png'),
  1, 'the other file is still there');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Staff or linked clients can view annotations'),
  1, 'the account-scoped read policy stays');

SELECT * FROM finish();
ROLLBACK;
