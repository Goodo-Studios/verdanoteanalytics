-- One transcript and one framework per Vault item (audit plan item 4.3).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Re-analysis inserted a new framework row each time, and the Apify webhook could insert a second
-- transcript when it was delivered twice. vault-analyze reads the transcript with .single(), which
-- fails on two rows, and the item page showed whichever row came back first. The migration keeps
-- the newest row per item and adds unique(item_id) to both tables; the functions upsert on item_id.

BEGIN;
SELECT plan(8);

INSERT INTO auth.users (id, email) VALUES
  ('d4310000-0000-4000-8000-000000000001', 'vault-dupes-owner@example.test');
INSERT INTO public.inspiration_items (id, user_id, source_url, platform) VALUES
  ('d4310000-0000-4000-8000-0000000000a1', 'd4310000-0000-4000-8000-000000000001', 'https://example.test/ad', 'facebook_ad');

-- ---------------------------------------------------------------- constraints
SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.inspiration_transcripts'::regclass AND contype = 'u'
            AND pg_get_constraintdef(oid) = 'UNIQUE (item_id)'),
  'inspiration_transcripts has unique(item_id)');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.inspiration_frameworks'::regclass AND contype = 'u'
            AND pg_get_constraintdef(oid) = 'UNIQUE (item_id)'),
  'inspiration_frameworks has unique(item_id)');

-- ---------------------------------------------------------------- a second plain insert is refused
INSERT INTO public.inspiration_transcripts (item_id, raw_transcript) VALUES
  ('d4310000-0000-4000-8000-0000000000a1', 'first');
SELECT throws_ok(
  $$INSERT INTO public.inspiration_transcripts (item_id, raw_transcript) VALUES ('d4310000-0000-4000-8000-0000000000a1', 'second')$$,
  '23505', NULL, 'a second transcript for the same item is refused');

INSERT INTO public.inspiration_frameworks (item_id, hook_type) VALUES
  ('d4310000-0000-4000-8000-0000000000a1', 'question');
SELECT throws_ok(
  $$INSERT INTO public.inspiration_frameworks (item_id, hook_type) VALUES ('d4310000-0000-4000-8000-0000000000a1', 'statement')$$,
  '23505', NULL, 'a second framework for the same item is refused');

-- ---------------------------------------------------------------- upsert on item_id replaces the row
INSERT INTO public.inspiration_frameworks (item_id, hook_type) VALUES
  ('d4310000-0000-4000-8000-0000000000a1', 'statement')
  ON CONFLICT (item_id) DO UPDATE SET hook_type = excluded.hook_type;
SELECT is(
  (SELECT count(*)::int FROM public.inspiration_frameworks WHERE item_id = 'd4310000-0000-4000-8000-0000000000a1'),
  1, 're-analysis upsert leaves one framework row');
SELECT is(
  (SELECT hook_type FROM public.inspiration_frameworks WHERE item_id = 'd4310000-0000-4000-8000-0000000000a1'),
  'statement', 'and it holds the newest analysis');

INSERT INTO public.inspiration_transcripts (item_id, raw_transcript) VALUES
  ('d4310000-0000-4000-8000-0000000000a1', 'webhook delivered twice')
  ON CONFLICT (item_id) DO UPDATE SET raw_transcript = excluded.raw_transcript;
SELECT is(
  (SELECT count(*)::int FROM public.inspiration_transcripts WHERE item_id = 'd4310000-0000-4000-8000-0000000000a1'),
  1, 'a repeated webhook upsert leaves one transcript row');

-- ---------------------------------------------------------------- the dedupe kept nothing behind
SELECT is(
  (SELECT count(*)::int FROM (
     SELECT item_id FROM public.inspiration_transcripts GROUP BY item_id HAVING count(*) > 1
     UNION ALL
     SELECT item_id FROM public.inspiration_frameworks GROUP BY item_id HAVING count(*) > 1) d),
  0, 'no item has more than one transcript or framework');

SELECT * FROM finish();
ROLLBACK;
