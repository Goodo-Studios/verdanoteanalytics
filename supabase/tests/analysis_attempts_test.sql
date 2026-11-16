-- pgTAP regression test for audit item 8.6 (part 1): analysis retries are capped.
--
-- A creative whose analysis timed out went back to 'pending' with no attempt limit, and
-- an orphaned 'analyzing' row was reclaimed with no limit either, so a creative that
-- always times out was claimed (and paid for) forever. claim_creatives_for_analysis now
-- counts attempts and gives up after 3.
--
-- Run with the local stack (requires Docker):  supabase test db

BEGIN;
SELECT plan(7);

SELECT has_column('public', 'creatives', 'analysis_attempts',
  'creatives has an analysis_attempts column');

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES ('act_aat', 'AAT', now());
-- Set up in the INSERT: the creatives updated_at trigger rewrites updated_at on UPDATE.
INSERT INTO public.creatives (ad_id, account_id, ad_name, analysis_status, analysis_attempts, updated_at) VALUES
  ('aat_fresh',  'act_aat', 'AAT fresh',  'pending',   0, now()),
  ('aat_spent',  'act_aat', 'AAT spent',  'pending',   3, now()),
  ('aat_orphan', 'act_aat', 'AAT orphan', 'analyzing', 3, now() - interval '10 minutes'),
  ('aat_live',   'act_aat', 'AAT live',   'analyzing', 3, now());

SELECT is(
  ARRAY(SELECT ad_id FROM public.claim_creatives_for_analysis('act_aat', 10) ORDER BY ad_id),
  ARRAY['aat_fresh']::text[],
  'only the creative under the attempt limit is claimed'
);
SELECT is(
  (SELECT analysis_status || ':' || analysis_attempts FROM public.creatives WHERE ad_id = 'aat_fresh'),
  'analyzing:1',
  'a claim counts an attempt'
);
SELECT is(
  (SELECT analysis_status FROM public.creatives WHERE ad_id = 'aat_spent'),
  'failed',
  'a pending creative at the limit is marked failed, so it stops counting as work'
);
SELECT is(
  (SELECT analysis_status FROM public.creatives WHERE ad_id = 'aat_orphan'),
  'failed',
  'an orphaned analyzing row at the limit is marked failed instead of reclaimed'
);
SELECT is(
  (SELECT analysis_status FROM public.creatives WHERE ad_id = 'aat_live'),
  'analyzing',
  'a live analyzing row is left alone'
);

-- A timed-out item is recycled to pending and reclaimed; the attempt keeps counting.
UPDATE public.creatives SET analysis_status = 'pending' WHERE ad_id = 'aat_fresh';
SELECT public.claim_creatives_for_analysis('act_aat', 10);
SELECT is(
  (SELECT analysis_attempts FROM public.creatives WHERE ad_id = 'aat_fresh'),
  2,
  'a recycled creative keeps its attempt count'
);

SELECT * FROM finish();
ROLLBACK;
