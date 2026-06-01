-- US-003: pg_cron schedule for the Coda Tasks -> coda_tasks pipeline sync.
--
-- Calls the sync-coda-tasks edge function every 4 hours so the live pipeline
-- view (/pipeline) stays current without anyone opening Coda. The function is
-- GET-only against the Coda API and upserts only the active subset of rows into
-- coda_tasks (terminal/empty/not-applicable stages are skipped at sync time).
--
-- Cadence: '0 */4 * * *' (every 4h, on the hour — 00/04/08/12/16/20 UTC).
-- Operator decision (2026-05-31): intraday freshness preferred over the
-- once-daily cadence the names cron uses, since staff and clients watch the
-- pipeline through the day.
--
-- Scheduling lives in this migration (NOT an HQ-session cron, which evaporates
-- at session end). The service role key is read from Supabase Vault at runtime
-- and is never hardcoded.
--
-- Prerequisite: a 'service_role_key' secret must exist in Supabase Vault. The
-- sync-coda-names cron already relies on it, so the secret is present in prod.

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── Unschedule any previous registration (idempotent) ───────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job WHERE jobname = 'sync-coda-tasks-4h'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$$;

-- ── Coda Tasks sync — every 4 hours ─────────────────────────────────────────
SELECT cron.schedule(
  'sync-coda-tasks-4h',
  '0 */4 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/sync-coda-tasks',
      headers := json_build_object(
        'Authorization',
        'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'service_role_key'
          LIMIT 1
        ),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running this migration, confirm with:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'sync-coda-tasks-4h';
