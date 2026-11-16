-- Ready Vault items get search embeddings (audit plan item 4.5).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Nothing ever called vault-embed, so item_embeddings stayed empty and Vault's semantic search
-- returned nothing. queue_vault_embeddings() (run by a cron job) now asks vault-embed to embed
-- ready items that have no embedding, a capped number per run, with a retry limit so an item
-- that cannot be embedded does not cost money forever. When an item leaves 'ready' (for example
-- a re-analyze), its old embedding is removed so the new content gets embedded once it is ready.

BEGIN;
SELECT plan(14);

INSERT INTO auth.users (id, email) VALUES
  ('d4500000-0000-4000-8000-000000000001', 'vault-embed-owner@example.test');
INSERT INTO public.inspiration_items (id, user_id, source_url, platform, status) VALUES
  ('d4500000-0000-4000-8000-0000000000a1', 'd4500000-0000-4000-8000-000000000001', 'https://example.test/1', 'tiktok', 'ready'),
  ('d4500000-0000-4000-8000-0000000000a2', 'd4500000-0000-4000-8000-000000000001', 'https://example.test/2', 'tiktok', 'ready'),
  ('d4500000-0000-4000-8000-0000000000a3', 'd4500000-0000-4000-8000-000000000001', 'https://example.test/3', 'tiktok', 'analyzing'),
  ('d4500000-0000-4000-8000-0000000000a4', 'd4500000-0000-4000-8000-000000000001', 'https://example.test/4', 'tiktok', 'ready');

-- a2 already has an embedding.
INSERT INTO public.item_embeddings (item_id, embedding)
  VALUES ('d4500000-0000-4000-8000-0000000000a2', array_fill(0.1::real, ARRAY[512])::vector);

-- ---------------------------------------------------------------- columns
SELECT has_column('public', 'inspiration_items', 'embed_attempts', 'inspiration_items counts embedding attempts');
SELECT has_column('public', 'inspiration_items', 'embed_last_attempt_at', 'inspiration_items records the last embedding attempt');

-- a4 has already used up its attempts.
UPDATE public.inspiration_items SET embed_attempts = 3, embed_last_attempt_at = now() - interval '1 day'
  WHERE id = 'd4500000-0000-4000-8000-0000000000a4';

-- ---------------------------------------------------------------- the queue
SELECT is(public.queue_vault_embeddings(10), 1, 'only the ready item without an embedding is queued');
SELECT is(
  (SELECT count(*)::int FROM net.http_request_queue
    WHERE url LIKE '%/functions/v1/vault-embed'
      AND convert_from(body, 'UTF8')::jsonb ->> 'item_id' = 'd4500000-0000-4000-8000-0000000000a1'),
  1, 'a vault-embed request is sent for that item');
SELECT is(
  (SELECT embed_attempts FROM public.inspiration_items WHERE id = 'd4500000-0000-4000-8000-0000000000a1'),
  1, 'the attempt is counted');
SELECT is(public.queue_vault_embeddings(10), 0, 'an item just tried is not tried again straight away');

UPDATE public.inspiration_items SET embed_last_attempt_at = now() - interval '2 hours'
  WHERE id = 'd4500000-0000-4000-8000-0000000000a1';
SELECT is(public.queue_vault_embeddings(10), 1, 'an item still missing its embedding is retried later');

-- ---------------------------------------------------------------- the cap
INSERT INTO public.inspiration_items (id, user_id, source_url, platform, status) VALUES
  ('d4500000-0000-4000-8000-0000000000b1', 'd4500000-0000-4000-8000-000000000001', 'https://example.test/b1', 'tiktok', 'ready'),
  ('d4500000-0000-4000-8000-0000000000b2', 'd4500000-0000-4000-8000-000000000001', 'https://example.test/b2', 'tiktok', 'ready'),
  ('d4500000-0000-4000-8000-0000000000b3', 'd4500000-0000-4000-8000-000000000001', 'https://example.test/b3', 'tiktok', 'ready');
SELECT is(public.queue_vault_embeddings(2), 2, 'each run is capped');

-- ---------------------------------------------------------------- re-analysis
UPDATE public.inspiration_items SET status = 'analyzing' WHERE id = 'd4500000-0000-4000-8000-0000000000a2';
SELECT is(
  (SELECT count(*)::int FROM public.item_embeddings WHERE item_id = 'd4500000-0000-4000-8000-0000000000a2'),
  0, 'leaving ready removes the old embedding');
UPDATE public.inspiration_items SET status = 'ready' WHERE id = 'd4500000-0000-4000-8000-0000000000a2';
SELECT is(
  (SELECT embed_attempts FROM public.inspiration_items WHERE id = 'd4500000-0000-4000-8000-0000000000a2'),
  0, 'the attempt count starts again for the new content');

-- ---------------------------------------------------------------- who can run it
SELECT ok(NOT has_function_privilege('anon', 'public.queue_vault_embeddings(integer)', 'EXECUTE'), 'anon cannot queue embeddings');
SELECT ok(NOT has_function_privilege('authenticated', 'public.queue_vault_embeddings(integer)', 'EXECUTE'), 'signed-in users cannot queue embeddings');

-- ---------------------------------------------------------------- the schedule
SELECT is(
  (SELECT count(*)::int FROM cron.job WHERE jobname = 'vault-embed-missing' AND command ILIKE '%queue_vault_embeddings%'),
  1, 'a cron job queues embeddings');
SELECT is(
  (SELECT command ~ 'queue_vault_embeddings\(\s*([1-9][0-9]?)\s*\)' FROM cron.job WHERE jobname = 'vault-embed-missing'),
  true, 'the cron job passes a cap under 100');

SELECT * FROM finish();
ROLLBACK;
