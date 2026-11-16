-- Vault: staff read and manage every item, including a teammate's (audit plan item 1.6, step 1).
--
-- Before: the item read rule let staff see a teammate's item, but vault_visible_item_ids() (used
-- by transcripts, frameworks, tags, embeddings and match_items) returned only the caller's own
-- items, and item update and delete were owner only. So a teammate's item opened with an empty
-- transcript, search skipped it, and edits and deletes did nothing. Clients see nothing either way.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(12);

INSERT INTO auth.users (id, email) VALUES
  ('c1600000-0000-4000-8000-00000000000a', 'vault-owner@example.test'),
  ('c1600000-0000-4000-8000-00000000000b', 'vault-teammate@example.test'),
  ('c1600000-0000-4000-8000-00000000000c', 'vault-client@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1600000-0000-4000-8000-00000000000a', 'employee'),
  ('c1600000-0000-4000-8000-00000000000b', 'builder'),
  ('c1600000-0000-4000-8000-00000000000c', 'client');

-- An item the owner saved, inserted the way service-role functions do (no saved_by).
INSERT INTO public.inspiration_items (id, user_id, title) VALUES
  ('c1600000-0000-4000-8000-0000000000e1', 'c1600000-0000-4000-8000-00000000000a', 'Owner item'),
  ('c1600000-0000-4000-8000-0000000000e2', 'c1600000-0000-4000-8000-00000000000a', 'Second item');
INSERT INTO public.inspiration_transcripts (item_id, raw_transcript) VALUES
  ('c1600000-0000-4000-8000-0000000000e1', 'hello');
INSERT INTO public.inspiration_tags (item_id, tag) VALUES
  ('c1600000-0000-4000-8000-0000000000e1', 'ugc');

SELECT is((SELECT saved_by FROM public.inspiration_items WHERE id = 'c1600000-0000-4000-8000-0000000000e1'),
  'c1600000-0000-4000-8000-00000000000a'::uuid, 'saved_by is filled from user_id when an insert leaves it empty');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND cmd = 'ALL'
      AND tablename IN ('inspiration_transcripts', 'inspiration_frameworks', 'inspiration_tags')),
  0, 'the child tables have no FOR ALL rule left (read and write rules are separate)');

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- teammate (staff)
SELECT pg_temp.as_user('c1600000-0000-4000-8000-00000000000b');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.inspiration_items WHERE id = 'c1600000-0000-4000-8000-0000000000e1'),
  1, 'a teammate sees the item');
SELECT is((SELECT raw_transcript FROM public.inspiration_transcripts WHERE item_id = 'c1600000-0000-4000-8000-0000000000e1'),
  'hello', 'a teammate sees the item''s transcript');
SELECT is((SELECT count(*)::int FROM public.inspiration_tags WHERE item_id = 'c1600000-0000-4000-8000-0000000000e1'),
  1, 'a teammate sees the item''s tags');
SELECT ok('c1600000-0000-4000-8000-0000000000e1'::uuid IN (SELECT public.vault_visible_item_ids()),
  'search covers a teammate''s item (vault_visible_item_ids)');
SELECT lives_ok(
  $$INSERT INTO public.inspiration_tags (item_id, tag) VALUES ('c1600000-0000-4000-8000-0000000000e1', 'hook')$$,
  'a teammate can tag the item');
UPDATE public.inspiration_items SET title = 'Renamed by teammate' WHERE id = 'c1600000-0000-4000-8000-0000000000e1';
DELETE FROM public.inspiration_items WHERE id = 'c1600000-0000-4000-8000-0000000000e2';
RESET ROLE;

SELECT is((SELECT title FROM public.inspiration_items WHERE id = 'c1600000-0000-4000-8000-0000000000e1'),
  'Renamed by teammate', 'a teammate''s edit is saved');
SELECT is((SELECT count(*)::int FROM public.inspiration_items WHERE id = 'c1600000-0000-4000-8000-0000000000e2'),
  0, 'a teammate''s delete removes the item');

-- ---------------------------------------------------------------- client
SELECT pg_temp.as_user('c1600000-0000-4000-8000-00000000000c');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.inspiration_items WHERE id = 'c1600000-0000-4000-8000-0000000000e1'),
  0, 'a client does not see the item');
SELECT is((SELECT count(*)::int FROM public.inspiration_transcripts WHERE item_id = 'c1600000-0000-4000-8000-0000000000e1'),
  0, 'a client does not see the transcript');
SELECT throws_ok(
  $$INSERT INTO public.inspiration_tags (item_id, tag) VALUES ('c1600000-0000-4000-8000-0000000000e1', 'client')$$,
  '42501', NULL, 'a client cannot tag the item');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
