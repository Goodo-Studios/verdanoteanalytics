-- Audit Batch 9: drop plain indexes that repeat a primary or unique key on the same columns.
--
-- Found by a read-only production check (2026-11-16). Each kept index covers exactly the same
-- columns, so reads lose nothing; writes stop maintaining a second copy. Indexes that back a
-- constraint are not touched. supabase/tests/no_duplicate_indexes_test.sql keeps new ones out.
--
--   creative_daily_metrics  idx_daily_metrics_ad_date (65 MB)   kept: creative_daily_metrics_pkey
--   creatives               idx_creatives_ad_id                 kept: creatives_pkey
--   ad_library_boards       idx_ad_lib_boards_token             kept: ad_library_boards_share_token_key
--   client_bids             client_bids_client_idx              kept: client_bids_client_slug_version_key
--   client_highlights       idx_client_highlights_account_period kept: client_highlights_account_period_unique
--   time_invoices           time_invoices_person_idx            kept: time_invoices_one_per_period

DROP INDEX IF EXISTS public.idx_daily_metrics_ad_date;
DROP INDEX IF EXISTS public.idx_creatives_ad_id;
DROP INDEX IF EXISTS public.idx_ad_lib_boards_token;
DROP INDEX IF EXISTS public.client_bids_client_idx;
DROP INDEX IF EXISTS public.idx_client_highlights_account_period;
DROP INDEX IF EXISTS public.time_invoices_person_idx;
