-- =============================================================================
-- PAUSE the two queue-based media crons (throttle re-appeared on re-enable)
-- =============================================================================
-- Idempotent. Manual `supabase db push --linked`.
--
-- Re-enabling drain-media-queue-2min + refresh-media-queue-15min at full cadence
-- (drain every 2 min, each self-chaining to MAX_CHAIN, plus the 15-min feeder poking
-- the drain) put too many concurrent drain workers on the Meta Graph API at once:
-- live drain batches returned throttled=4/5 (reasons: {throttled}), cached=0, and
-- portfolio video_ok stayed flat while re-queued throttled rows piled up. The
-- single-invocation canary was clean because it ran ONE bounded self-chain; the crons
-- overlap many. Unschedule both to stop the churn. Re-enable later at a safer cadence
-- (e.g. drain every 5-10 min, no feeder poke, and/or scoped to assigned-page accounts
-- so the queue is not flooded with the ~28 unassigned accounts' unresolvable ads).
-- =============================================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job
           WHERE jobname IN ('drain-media-queue-2min', 'refresh-media-queue-15min')
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;
