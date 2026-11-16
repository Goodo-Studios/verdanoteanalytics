-- pgTAP regression test for audit item 8.3: claim_media_cache_queue took pending rows
-- oldest-first with no notion of "not before", so a failed or rate-limited row was
-- reclaimed by the very next chain link.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(5);

SELECT has_column('public', 'media_cache_queue', 'next_attempt_at',
  'media_cache_queue has a next_attempt_at column');

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES ('act_mcb', 'MCB', now());
INSERT INTO public.creatives (ad_id, account_id, ad_name) VALUES
  ('mcb_later', 'act_mcb', 'MCB later'),
  ('mcb_due',   'act_mcb', 'MCB due'),
  ('mcb_new',   'act_mcb', 'MCB new');

-- mcb_later is the oldest row but is deferred for 30 minutes.
INSERT INTO public.media_cache_queue (ad_id, account_id, status, attempts, enqueued_at, updated_at) VALUES
  ('mcb_later', 'act_mcb', 'pending', 1, now() - interval '3 hours', now()),
  ('mcb_due',   'act_mcb', 'pending', 1, now() - interval '2 hours', now()),
  ('mcb_new',   'act_mcb', 'pending', 0, now() - interval '1 hour',  now());
UPDATE public.media_cache_queue SET next_attempt_at = now() + interval '30 minutes' WHERE ad_id = 'mcb_later';
UPDATE public.media_cache_queue SET next_attempt_at = now() - interval '1 minute'   WHERE ad_id = 'mcb_due';

SELECT is(
  ARRAY(SELECT ad_id FROM public.claim_media_cache_queue(10) ORDER BY ad_id),
  ARRAY['mcb_due', 'mcb_new']::text[],
  'a deferred row is skipped; due and new rows are claimed'
);
SELECT is(
  (SELECT status || ':' || attempts FROM public.media_cache_queue WHERE ad_id = 'mcb_later'),
  'pending:1',
  'the deferred row is untouched'
);

-- Once its time has passed, the deferred row is claimable again.
UPDATE public.media_cache_queue SET next_attempt_at = now() - interval '1 second' WHERE ad_id = 'mcb_later';
SELECT is(
  ARRAY(SELECT ad_id FROM public.claim_media_cache_queue(10)),
  ARRAY['mcb_later']::text[],
  'a row whose time has passed is claimed'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.claim_media_cache_queue(integer)', 'EXECUTE'),
  'only the service role can claim'
);

SELECT * FROM finish();
ROLLBACK;
