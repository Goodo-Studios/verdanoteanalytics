-- pgTAP regression test for audit item 8.1: the media refresh feeder
-- (enqueue_media_refresh_candidates) reset attempts = 0 on every re-enqueue and ignored
-- p_max_attempts, so an ad the drain had given up on ('failed' after MAX_ATTEMPTS) went
-- straight back into the queue on the next 15-minute tick, forever.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(8);

INSERT INTO public.ad_accounts (id, name, last_synced_at, media_backfill_enabled) VALUES
  ('act_mra', 'MRA', now(), true);

-- Every creative has impressions and no image, so media_coverage reports image_missing.
INSERT INTO public.creatives (ad_id, account_id, ad_name, impressions, media_last_refresh_at) VALUES
  ('mra_exhausted', 'act_mra', 'MRA exhausted', 10, NULL),
  ('mra_old_fail',  'act_mra', 'MRA old fail',  10, now() - interval '30 days'),
  ('mra_done',      'act_mra', 'MRA done',      10, now() - interval '29 days'),
  ('mra_three',     'act_mra', 'MRA three',     10, now() - interval '28 days'),
  ('mra_fresh',     'act_mra', 'MRA fresh',     10, now() - interval '27 days');

INSERT INTO public.media_cache_queue (ad_id, account_id, status, attempts, enqueued_at, updated_at) VALUES
  -- Gave up an hour ago: must stay failed.
  ('mra_exhausted', 'act_mra', 'failed', 5, now() - interval '2 hours', now() - interval '1 hour'),
  -- Gave up more than a week ago: one fresh round is allowed.
  ('mra_old_fail',  'act_mra', 'failed', 5, now() - interval '9 days', now() - interval '8 days'),
  -- Finished normally: re-enqueued from zero when its media rots again.
  ('mra_done',      'act_mra', 'done',   2, now() - interval '9 days', now() - interval '8 days'),
  -- Gave up after 3 attempts: blocked when the caller's limit is 3.
  ('mra_three',     'act_mra', 'failed', 3, now() - interval '2 hours', now() - interval '1 hour');

-- 1. With a batch of one, an ad the drain just gave up on must not take the slot.
SELECT is(
  public.enqueue_media_refresh_candidates(1, 5),
  1,
  'a batch of one enqueues one ad'
);
SELECT is(
  (SELECT status || ':' || attempts FROM public.media_cache_queue WHERE ad_id = 'mra_exhausted'),
  'failed:5',
  'an ad that just exhausted its attempts is not re-enqueued with attempts reset'
);
SELECT ok(
  (SELECT media_last_refresh_at IS NULL FROM public.creatives WHERE ad_id = 'mra_exhausted'),
  'an exhausted ad does not use up a batch slot'
);
SELECT is(
  (SELECT status || ':' || attempts FROM public.media_cache_queue WHERE ad_id = 'mra_old_fail'),
  'pending:0',
  'an ad that gave up more than a week ago gets one fresh round'
);

-- 2. Full batch with a caller limit of 3 attempts.
SELECT public.enqueue_media_refresh_candidates(100, 3);
SELECT is(
  (SELECT status || ':' || attempts FROM public.media_cache_queue WHERE ad_id = 'mra_three'),
  'failed:3',
  'p_max_attempts is honoured'
);
SELECT is(
  (SELECT status || ':' || attempts FROM public.media_cache_queue WHERE ad_id = 'mra_done'),
  'pending:0',
  'a finished ad is re-enqueued from zero'
);
SELECT is(
  (SELECT status FROM public.media_cache_queue WHERE ad_id = 'mra_fresh'),
  'pending',
  'an ad with no queue row is enqueued'
);
SELECT is(
  (SELECT status || ':' || attempts FROM public.media_cache_queue WHERE ad_id = 'mra_exhausted'),
  'failed:5',
  'the exhausted ad is still failed after the full batch'
);

SELECT * FROM finish();
ROLLBACK;
