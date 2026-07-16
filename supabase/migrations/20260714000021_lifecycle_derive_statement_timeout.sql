-- Creative Rotation (F2) perf fix: derive_creative_lifecycle_dates aggregates all
-- of an account's creative_daily_metrics in one statement, which exceeds the
-- default statement_timeout on large accounts (1000-1500 creatives × up to 365
-- daily rows) — observed "canceling statement due to statement timeout" during the
-- all-accounts rollout backfill. Give the function room. This is metadata-only
-- (no table lock).
--
-- FOLLOW-UP (do in a maintenance window, NOT here): a covering index
--   CREATE INDEX CONCURRENTLY idx_daily_metrics_account_ad_date
--     ON public.creative_daily_metrics(account_id, ad_id, date) INCLUDE (spend);
-- would make this aggregation fast instead of just allowed. It is omitted from
-- this migration because a non-CONCURRENT CREATE INDEX blocks writes on the hot
-- daily-metrics table during the build, and CONCURRENTLY cannot run inside the
-- migration transaction.

ALTER FUNCTION public.derive_creative_lifecycle_dates(text) SET statement_timeout = '180s';
