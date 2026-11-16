-- Vault items stuck in a processing state are marked as errors (audit plan item 4.4).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- When a hand-off between Vault functions was lost, an item stayed at pending / extracting /
-- transcribing / analyzing forever, with a spinner and no way out. inspiration_items now records
-- when its status last changed, and fail_stuck_vault_items() (run by a cron job every 10 minutes)
-- moves items that have sat in a processing state past the limit to 'error' with a message. The
-- item page shows the error and the existing Re-analyze button starts it again.

BEGIN;
SELECT plan(12);

INSERT INTO auth.users (id, email) VALUES
  ('d4400000-0000-4000-8000-000000000001', 'vault-stuck-owner@example.test');
INSERT INTO public.inspiration_items (id, user_id, source_url, platform, status) VALUES
  ('d4400000-0000-4000-8000-0000000000a1', 'd4400000-0000-4000-8000-000000000001', 'https://example.test/1', 'tiktok', 'transcribing'),
  ('d4400000-0000-4000-8000-0000000000a2', 'd4400000-0000-4000-8000-000000000001', 'https://example.test/2', 'tiktok', 'analyzing'),
  ('d4400000-0000-4000-8000-0000000000a3', 'd4400000-0000-4000-8000-000000000001', 'https://example.test/3', 'tiktok', 'ready'),
  ('d4400000-0000-4000-8000-0000000000a4', 'd4400000-0000-4000-8000-000000000001', 'https://example.test/4', 'tiktok', 'pending');

-- ---------------------------------------------------------------- status_changed_at
SELECT has_column('public', 'inspiration_items', 'status_changed_at', 'inspiration_items records when its status last changed');
SELECT ok(
  (SELECT status_changed_at IS NOT NULL FROM public.inspiration_items WHERE id = 'd4400000-0000-4000-8000-0000000000a1'),
  'a new item gets a status time');

UPDATE public.inspiration_items SET status_changed_at = now() - interval '3 hours'
  WHERE id = 'd4400000-0000-4000-8000-0000000000a4';
UPDATE public.inspiration_items SET status = 'extracting' WHERE id = 'd4400000-0000-4000-8000-0000000000a4';
SELECT ok(
  (SELECT status_changed_at > now() - interval '1 minute' FROM public.inspiration_items WHERE id = 'd4400000-0000-4000-8000-0000000000a4'),
  'changing the status moves the status time forward');

-- Age three items past the limit: one still processing a long time, one ready, one fresh.
UPDATE public.inspiration_items SET status_changed_at = now() - interval '2 hours'
  WHERE id IN ('d4400000-0000-4000-8000-0000000000a1', 'd4400000-0000-4000-8000-0000000000a3');

-- ---------------------------------------------------------------- the sweep
SELECT is(public.fail_stuck_vault_items(interval '60 minutes'), 1, 'one item is past the limit');
SELECT is(
  (SELECT status FROM public.inspiration_items WHERE id = 'd4400000-0000-4000-8000-0000000000a1'),
  'error', 'the stuck item is marked as an error');
SELECT matches(
  (SELECT error_message FROM public.inspiration_items WHERE id = 'd4400000-0000-4000-8000-0000000000a1'),
  'transcribing', 'the message says which step timed out');
SELECT is(
  (SELECT status FROM public.inspiration_items WHERE id = 'd4400000-0000-4000-8000-0000000000a2'),
  'analyzing', 'an item still within the limit is left alone');
SELECT is(
  (SELECT status FROM public.inspiration_items WHERE id = 'd4400000-0000-4000-8000-0000000000a3'),
  'ready', 'a ready item is left alone however old');
SELECT is(public.fail_stuck_vault_items(interval '60 minutes'), 0, 'a second run finds nothing');

-- ---------------------------------------------------------------- who can run it
SELECT ok(NOT has_function_privilege('anon', 'public.fail_stuck_vault_items(interval)', 'EXECUTE'), 'anon cannot run the sweep');
SELECT ok(NOT has_function_privilege('authenticated', 'public.fail_stuck_vault_items(interval)', 'EXECUTE'), 'signed-in users cannot run the sweep');

-- ---------------------------------------------------------------- the schedule
SELECT is(
  (SELECT count(*)::int FROM cron.job WHERE jobname = 'vault-fail-stuck-items' AND command ILIKE '%fail_stuck_vault_items%'),
  1, 'a cron job runs the sweep');

SELECT * FROM finish();
ROLLBACK;
