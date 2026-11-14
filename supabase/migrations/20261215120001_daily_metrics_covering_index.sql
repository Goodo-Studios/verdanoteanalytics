-- Covering index for the date-range aggregation behind creatives_list_page (creatives?all=1).
--
-- The all-accounts home view aggregates about 197k daily rows (90 days) per ad. With only
-- idx_daily_metrics_date the plan fetches every row from the table (about 105k buffers on
-- production). This index holds every column that aggregation reads, so Postgres answers it with an
-- index-only scan and no table fetches.
--
-- Staging measurement on a 400k-row scratch table of production shape (EXPLAIN, dropped afterwards):
--   plain date index:   90,817 buffers, Index Scan
--   covering index:      1,154 buffers, Index Only Scan, Heap Fetches 0
-- The aggregation itself still runs, so the gain in time on production is expected to be a
-- few times, not hundreds. It needs a vacuum-fed visibility map to avoid table fetches; autovacuum
-- keeps it current on this table.
--
-- Cost: about 70 MB on production, and writes to creative_daily_metrics wait while it builds
-- (a few seconds for about 721k rows).

CREATE INDEX IF NOT EXISTS idx_daily_metrics_date_covering
  ON public.creative_daily_metrics (date)
  INCLUDE (ad_id, account_id, spend, impressions, clicks, purchases, purchase_value,
           adds_to_cart, video_views, frequency, thumb_stop_rate, hold_rate, video_avg_play_time);
