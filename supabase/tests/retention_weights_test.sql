-- Retention quartiles use their own weights (audit plan item 6.5, part 5).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- rollup_creatives_from_daily divided p25, p75 and p100 by the views of days that had a p50,
-- so a day with p25 or p100 but no p50 could push them past 100%. Same fixture as
-- supabase/functions/sync/retention-weights.test.ts. All rows are made up, dates in 2020.

BEGIN;
SELECT plan(4);

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES ('act_rw', 'RW', now());
INSERT INTO public.creatives (ad_id, account_id, ad_name, ad_type) VALUES ('rw_1', 'act_rw', 'RW1_video', 'Video');
INSERT INTO public.creative_daily_metrics
  (ad_id, account_id, date, video_views, retention_p25, retention_p50, retention_p75, retention_p100) VALUES
  ('rw_1', 'act_rw', '2020-07-01', 100, 80, 60, 40, 20),
  ('rw_1', 'act_rw', '2020-07-02', 300, 90, NULL, NULL, 10);

SELECT public.rollup_creatives_from_daily('act_rw', '2020-07-01', '2020-07-31');

SELECT is((SELECT round(retention_p25::numeric, 4) FROM public.creatives WHERE ad_id = 'rw_1'), 87.5000::numeric,
  'p25 is weighted by the views of the days that report p25');
SELECT is((SELECT round(retention_p50::numeric, 4) FROM public.creatives WHERE ad_id = 'rw_1'), 60.0000::numeric,
  'p50 is weighted by the views of the days that report p50');
SELECT is((SELECT round(retention_p75::numeric, 4) FROM public.creatives WHERE ad_id = 'rw_1'), 40.0000::numeric,
  'p75 is weighted by the views of the days that report p75');
SELECT is((SELECT round(retention_p100::numeric, 4) FROM public.creatives WHERE ad_id = 'rw_1'), 12.5000::numeric,
  'p100 is weighted by the views of the days that report p100');

SELECT * FROM finish();
ROLLBACK;
