-- pgTAP regression test for audit item 8.5: the preview-capture drain lock is held for
-- the whole chain. Chain links refresh running_since with touch_apify_drain_singleflight,
-- so a long chain keeps the lock past the 15-minute stale timeout without a parallel
-- cron flight claiming it.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(6);

SELECT has_function('public', 'touch_apify_drain_singleflight', ARRAY[]::text[],
  'touch_apify_drain_singleflight() exists');

UPDATE public.apify_drain_state SET running_since = NULL WHERE id = true;
SELECT is(public.touch_apify_drain_singleflight(), false,
  'touch does not claim a free lock');
SELECT ok((SELECT running_since IS NULL FROM public.apify_drain_state WHERE id = true),
  'a free lock stays free after touch');

UPDATE public.apify_drain_state SET running_since = now() - interval '14 minutes' WHERE id = true;
SELECT is(public.touch_apify_drain_singleflight(), true,
  'touch refreshes a held lock');
SELECT is(public.claim_apify_drain_singleflight(900), false,
  'a refreshed lock is not stale, so a cron poke cannot claim it');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.touch_apify_drain_singleflight()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.touch_apify_drain_singleflight()', 'EXECUTE'),
  'only the service role can touch the lock'
);

SELECT * FROM finish();
ROLLBACK;
