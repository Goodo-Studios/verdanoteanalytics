-- One set of video metric formulas in SQL (audit plan item 6.1, part 6).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Before this fix the two SQL paths and the TypeScript helper each had their own hook, hold,
-- play time and frequency rules. They now all use the shared formulas in
-- supabase/functions/_shared/metric-math.ts:
--   hook rate  = video views / impressions, both from days that had video views, x 100
--   hold rate  = sum(hold_rate / 100 x video views) / video views, x 100
--   play time  = sum(play time x video views) / video views
--   frequency  = sum(frequency x impressions) / impressions, over every day
--
-- The fixture below is the same one used by _shared/creatives-aggregate.test.ts
-- ("video formulas match the shared metric-math formulas"), so SQL and TypeScript give the
-- same answer:
--   day 1: 1000 impressions, 100 views, hold 40, play 5s,  frequency 2
--   day 2: 3000 impressions,   0 views (no video delivery), frequency 1
--   day 3: 1000 impressions, 200 views, hold 0,  play 0s,  frequency 0
-- Expected: hook 15, hold 13.3333, play time 1.6667, frequency 1.
-- All rows are made up and use dates in 2020.

BEGIN;
SELECT plan(8);

INSERT INTO public.ad_accounts (id, name, last_synced_at) VALUES ('act_vmf', 'VMF', now());
INSERT INTO public.creatives (ad_id, account_id, ad_name, ad_type) VALUES
  ('vmf_1', 'act_vmf', 'VMF1_video', 'Video');
INSERT INTO public.creative_daily_metrics
  (ad_id, account_id, date, impressions, spend, video_views, thumb_stop_rate, hold_rate, video_avg_play_time, frequency) VALUES
  ('vmf_1', 'act_vmf', '2020-04-01', 1000, 10, 100, 10, 40, 5, 2),
  ('vmf_1', 'act_vmf', '2020-04-02', 3000, 10,   0,  0,  0, 0, 1),
  ('vmf_1', 'act_vmf', '2020-04-03', 1000, 10, 200, 20,  0, 0, 0);

-- ---------------------------------------------------------------- rollup_creatives_from_daily (1-4)
SELECT public.rollup_creatives_from_daily('act_vmf', '2020-04-01', '2020-04-30');

SELECT is((SELECT round(thumb_stop_rate::numeric, 4) FROM public.creatives WHERE ad_id = 'vmf_1'),
  15.0000::numeric, 'rollup: hook rate counts impressions only from days with video views');
SELECT is((SELECT round(hold_rate::numeric, 4) FROM public.creatives WHERE ad_id = 'vmf_1'),
  13.3333::numeric, 'rollup: hold rate is weighted by video views, a 0% day counts');
SELECT is((SELECT round(video_avg_play_time::numeric, 4) FROM public.creatives WHERE ad_id = 'vmf_1'),
  1.6667::numeric, 'rollup: play time is weighted by video views, a 0s day counts');
SELECT is((SELECT round(frequency::numeric, 4) FROM public.creatives WHERE ad_id = 'vmf_1'),
  1.0000::numeric, 'rollup: frequency is weighted by impressions over every day');

-- ---------------------------------------------------------------- creatives_list_page (5-8)
CREATE TEMP TABLE vmf AS SELECT public.creatives_list_page(
  p_account_id := 'act_vmf', p_date_from := '2020-04-01', p_date_to := '2020-04-30') -> 'data' -> 0 AS r;

SELECT is((SELECT round((r->>'thumb_stop_rate')::numeric, 4) FROM vmf),
  15.0000::numeric, 'list page: hook rate counts impressions only from days with video views');
SELECT is((SELECT round((r->>'hold_rate')::numeric, 4) FROM vmf),
  13.3333::numeric, 'list page: hold rate is weighted by video views, a 0% day counts');
SELECT is((SELECT round((r->>'video_avg_play_time')::numeric, 4) FROM vmf),
  1.6667::numeric, 'list page: play time is weighted by video views, a 0s day counts');
SELECT is((SELECT round((r->>'frequency')::numeric, 4) FROM vmf),
  1.0000::numeric, 'list page: frequency is weighted by impressions over every day');

SELECT * FROM finish();
ROLLBACK;
