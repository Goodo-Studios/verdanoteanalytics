-- Covering index on creative_daily_metrics (migration 20261215120001).
--
-- Run with the local stack (requires Docker):  supabase test db
--
-- Checks the index exists, is keyed on date, and includes every column the per-ad aggregation in
-- creatives_list_page reads (so an index-only scan can answer it). That the planner picks an
-- index-only scan was measured with EXPLAIN on staging (see the migration comment); a plan check
-- here would need VACUUM, which cannot run inside the test transaction.

BEGIN;
SELECT plan(3);

SELECT has_index(
  'public', 'creative_daily_metrics', 'idx_daily_metrics_date_covering',
  'the covering index exists'
);

SELECT is(
  (SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE c.relname = 'idx_daily_metrics_date_covering' AND k.ord <= i.indnkeyatts),
  'date',
  'the key is the date column only'
);

SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attname)
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE c.relname = 'idx_daily_metrics_date_covering' AND k.ord > i.indnkeyatts),
  ARRAY['account_id','ad_id','adds_to_cart','clicks','frequency','hold_rate','impressions',
        'purchase_value','purchases','spend','thumb_stop_rate','video_avg_play_time','video_views'],
  'it includes every column the per-ad aggregation reads'
);

SELECT * FROM finish();
ROLLBACK;
