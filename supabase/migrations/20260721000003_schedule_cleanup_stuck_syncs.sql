-- =============================================================================
-- Schedule cleanup-stuck-syncs — the missing serial-queue watchdog
-- =============================================================================
-- Idempotent (unschedule-by-name then schedule). Manual `supabase db push --linked`.
-- Numbered off the remote frontier (20260721000002 was highest applied at authoring).
--
-- The sync queue is SERIAL: promoteNextQueued() advances exactly one queued sync to
-- running, and it is only called WHEN a sync completes/fails. So if a running sync
-- wedges (stops heart-beating without completing — e.g. a large account whose
-- continuation drops), nothing promotes the next queued sync and the entire queue
-- stalls behind it indefinitely. cleanup-stuck-syncs is the watchdog that detects a
-- wedged running sync (stale heartbeat > 5m for phases 2-5, > 40m for the phase-1
-- metadata fetch, 24h absolute backstop) and requeues/fails it so the queue drains
-- — but it was NEVER scheduled, so the safety net never ran. This is the same class
-- of gap as the (now-fixed) missing scheduled-sync cron: a recovery job that exists
-- but was not wired to pg_cron.
--
-- Observed impact (2026-07-21): Flatpack + Velora sat "queued" for 20+ min behind a
-- wedged run with nothing to clear it. A 5-minute cadence matches the function's own
-- 5-minute activity threshold and the existing scheduled-sync cadence.
-- Same idiom as scheduled-sync-5min: hardcoded URL + service-role bearer from Vault.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'cleanup-stuck-syncs-5min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'cleanup-stuck-syncs-5min',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/cleanup-stuck-syncs',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- Verify: SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'cleanup-stuck-syncs-5min';
