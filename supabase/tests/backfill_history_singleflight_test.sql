-- One history backfill run at a time (audit plan item 8.2, shipped with 5.3).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- The 20-minute cron started a new backfill chain while one was still running, so chains
-- stacked up. backfill-daily-history now claims a single-row lock on a cron poke and its
-- last chain link releases it. A lock older than the stale window can be reclaimed, so a
-- crashed run cannot block the backfill forever.

BEGIN;
SELECT plan(7);

SELECT has_table('public', 'backfill_history_state', 'the backfill lock table exists');

UPDATE public.backfill_history_state SET running_since = NULL;
SELECT is(public.claim_backfill_history_singleflight(900), true, 'a free lock can be claimed');
SELECT is(public.claim_backfill_history_singleflight(900), false, 'a held lock cannot be claimed again');

SELECT public.release_backfill_history_singleflight();
SELECT is(public.claim_backfill_history_singleflight(900), true, 'a released lock can be claimed');

UPDATE public.backfill_history_state SET running_since = now() - interval '20 minutes';
SELECT is(public.claim_backfill_history_singleflight(900), true, 'a stale lock can be reclaimed');

SELECT ok(NOT has_function_privilege('anon', 'public.claim_backfill_history_singleflight(integer)', 'EXECUTE'),
  'anon cannot claim the lock');
SELECT ok(NOT has_function_privilege('authenticated', 'public.release_backfill_history_singleflight()', 'EXECUTE'),
  'signed-in users cannot release the lock');

SELECT * FROM finish();
ROLLBACK;
