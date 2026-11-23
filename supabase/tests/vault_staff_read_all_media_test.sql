-- Staff read every file in inspiration-media, including files in a teammate's folder; a client
-- still reads nothing (20261216570001). Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(3);

INSERT INTO auth.users (id, email) VALUES
  ('c1700000-0000-4000-8000-0000000000e1', 'vm-staff@example.test'),
  ('c1700000-0000-4000-8000-0000000000e2', 'vm-client@example.test'),
  ('c1700000-0000-4000-8000-0000000000e3', 'vm-mate@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1700000-0000-4000-8000-0000000000e1', 'employee'),
  ('c1700000-0000-4000-8000-0000000000e2', 'client'),
  ('c1700000-0000-4000-8000-0000000000e3', 'employee');

-- Files written by functions with the service role: one in the staff user's own folder, one in a
-- teammate's folder, one in the imported-library folder of a third user.
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('inspiration-media', 'uploads/c1700000-0000-4000-8000-0000000000e1/own.mp4'),
  ('inspiration-media', 'uploads/c1700000-0000-4000-8000-0000000000e3/mate.mp4'),
  ('inspiration-media', 'atria/c1700000-0000-4000-8000-0000000000e3/imported.mp4');

SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1700000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1700000-0000-4000-8000-0000000000e1', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'inspiration-media'), 3,
  'staff read their own file and the files in teammates folders');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'inspiration-media' AND name LIKE 'atria/%'), 1,
  'staff read a file in the imported-library folder');
RESET ROLE;

SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1700000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1700000-0000-4000-8000-0000000000e2', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'inspiration-media'), 0,
  'a client reads no inspiration-media file');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
