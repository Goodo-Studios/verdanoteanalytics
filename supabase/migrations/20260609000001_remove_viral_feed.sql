-- Remove the Viral Feed backend (2026-06-09).
--
-- The Viral Feed UI was intentionally removed (routes now redirect to the Ad
-- Library), but the backend automation kept running: pg_cron fired the
-- vault-viral-cron -> vault-viral-refresh -> Apify scrape -> Claude
-- classification pipeline every Sunday, populating viral_feed_items — a table
-- with no remaining readers. The operator confirmed full teardown on
-- 2026-06-09: this migration unschedules both cron jobs and drops the table.
-- The three vault-viral-* edge functions and _shared/trending-configs.ts are
-- deleted from the repo in the same change and removed from the platform via
-- `supabase functions delete`.
--
-- viral_feed_items has no inbound foreign keys (its saved_item_id column
-- references inspiration_items with ON DELETE SET NULL, not the other way
-- around), so a plain DROP suffices. Data is re-scrapeable if the feature
-- ever returns; nothing else depends on it.

-- ── Unschedule the viral feed cron jobs (idempotent, by jobname) ─────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'viral-feed-daily',
      'viral-feed-daily-cleanup',
      'viral-feed-weekly',
      'viral-feed-weekly-cleanup'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$$;

-- ── Drop the feed table (indexes and RLS policies go with it) ────────────────
DROP TABLE IF EXISTS public.viral_feed_items;
