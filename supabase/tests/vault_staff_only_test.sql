-- The Vault is staff only, and its protected fields are set by functions only (audit 1.6 steps 2 and 3).
--
-- Matthew's rule: staff read and manage every Vault item; non-staff have no Vault access. Step 1
-- (live since 2026-11-16) gave staff full access. These checks cover the rest:
--   step 2: no signed-in user may write user_id, file_path, thumbnail_url, thumbnail_path,
--           video_url, saved_by, share_token or shared_at directly (vault-save, vault-share-item
--           and the pipeline set them with the service role);
--   step 3: a non-staff login sees and changes nothing in the Vault, even an item it owns, cannot
--           create a board and cannot upload, read or delete in inspiration-media.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(14);

INSERT INTO auth.users (id, email) VALUES
  ('c1600000-0000-4000-8000-0000000000e1', 'vs-staff@example.test'),
  ('c1600000-0000-4000-8000-0000000000e2', 'vs-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1600000-0000-4000-8000-0000000000e1', 'employee'),
  ('c1600000-0000-4000-8000-0000000000e2', 'client');
INSERT INTO public.inspiration_items (id, user_id, source_url, status, file_path) VALUES
  ('c1600000-0000-4000-8000-0000000000a1', 'c1600000-0000-4000-8000-0000000000e1', 'https://example.test/a', 'ready', 'uploads/c1600000-0000-4000-8000-0000000000e1/a.mp4'),
  ('c1600000-0000-4000-8000-0000000000a2', 'c1600000-0000-4000-8000-0000000000e2', 'https://example.test/b', 'ready', 'uploads/c1600000-0000-4000-8000-0000000000e2/b.mp4');
INSERT INTO public.inspiration_transcripts (item_id, raw_transcript) VALUES
  ('c1600000-0000-4000-8000-0000000000a2', 'client item transcript');

-- Staff
SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1600000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1600000-0000-4000-8000-0000000000e1', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$UPDATE public.inspiration_items SET script_analysis = 'edited' WHERE id = 'c1600000-0000-4000-8000-0000000000a1'$$,
  'staff edit an analysis field');
SELECT throws_ok(
  $$UPDATE public.inspiration_items SET file_path = 'uploads/someone-else/x.mp4' WHERE id = 'c1600000-0000-4000-8000-0000000000a1'$$,
  '42501', NULL, 'staff cannot rewrite file_path directly');
SELECT throws_ok(
  $$UPDATE public.inspiration_items SET saved_by = 'c1600000-0000-4000-8000-0000000000e2' WHERE id = 'c1600000-0000-4000-8000-0000000000a1'$$,
  '42501', NULL, 'staff cannot rewrite saved_by directly');
SELECT throws_ok(
  $$UPDATE public.inspiration_items SET thumbnail_url = 'https://evil.example/x.jpg' WHERE id = 'c1600000-0000-4000-8000-0000000000a1'$$,
  '42501', NULL, 'staff cannot rewrite thumbnail_url directly');
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name) VALUES ('inspiration-media', 'uploads/c1600000-0000-4000-8000-0000000000e1/new.mp4')$$,
  'staff upload into their own inspiration-media folder');
RESET ROLE;

-- Client
SELECT set_config('request.jwt.claims', json_build_object('sub', 'c1600000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'c1600000-0000-4000-8000-0000000000e2', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.inspiration_items), 0, 'a client sees no Vault item, not even one it owns');
SELECT is((SELECT count(*)::int FROM public.inspiration_transcripts), 0, 'a client sees no transcript, not even of its own item');
SELECT is((SELECT count(*)::int FROM public.vault_visible_item_ids()), 0, 'the Vault helper returns nothing for a client');
SELECT throws_ok(
  $$INSERT INTO public.inspiration_items (user_id, source_url, status) VALUES ('c1600000-0000-4000-8000-0000000000e2', 'https://example.test/c', 'pending')$$,
  '42501', NULL, 'a client cannot add a Vault item');
SELECT throws_ok(
  $$INSERT INTO public.boards (user_id, name) VALUES ('c1600000-0000-4000-8000-0000000000e2', 'Client board')$$,
  '42501', NULL, 'a client cannot create a Vault board');
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name) VALUES ('inspiration-media', 'uploads/c1600000-0000-4000-8000-0000000000e2/x.mp4')$$,
  '42501', NULL, 'a client cannot upload into inspiration-media, even in its own folder');
UPDATE public.inspiration_items SET title = 'changed' WHERE id = 'c1600000-0000-4000-8000-0000000000a2';
DELETE FROM public.inspiration_items WHERE id = 'c1600000-0000-4000-8000-0000000000a2';
RESET ROLE;

SELECT is((SELECT title FROM public.inspiration_items WHERE id = 'c1600000-0000-4000-8000-0000000000a2'), NULL,
  'a client''s update of its own item changed nothing');
SELECT is((SELECT count(*)::int FROM public.inspiration_items WHERE id = 'c1600000-0000-4000-8000-0000000000a2'), 1,
  'a client''s delete of its own item removed nothing');
SELECT is((SELECT script_analysis FROM public.inspiration_items WHERE id = 'c1600000-0000-4000-8000-0000000000a1'), 'edited',
  'the staff edit was saved');

SELECT * FROM finish();
ROLLBACK;
