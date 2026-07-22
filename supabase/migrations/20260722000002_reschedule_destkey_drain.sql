-- =============================================================================
-- Re-schedule landing-pages-destkey-drain — 4th evaporated cron (audit finding)
-- =============================================================================
-- Idempotent (unschedule-by-name then schedule). Manual `supabase db push --linked`.
-- Numbered off the remote frontier (20260722000001 was highest applied at authoring).
--
-- Cron-registration audit (2026-07-22): the destkey drain (20260714000022) is
-- self-terminating BY DESIGN — it unschedules itself only when NO account has
-- creatives with destination_key IS NULL AND impressions > 0. But it is absent
-- from cron.job while 3,122 undrained rows remain across 8 ACTIVE accounts
-- (Bearaby 1156, Smokeshow 857, Bartesian 642, …) — so it did not finish and
-- self-terminate; it evaporated mid-job in the same pg_cron wipe that killed
-- scheduled-sync, cleanup-stuck-syncs, and backfill-daily-history.
--
-- Re-register with the EXACT original definition: one account per 15-min tick
-- (throttle-safe vs Meta's app-wide limit), biggest-backlog-first, and the same
-- self-unschedule once fully drained. Verbatim body from 20260714000022.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'landing-pages-destkey-drain'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'landing-pages-destkey-drain',
  '*/15 * * * *',
  $CRON$
    DO $inner$
    DECLARE
      v_account text;
      v_key     text;
    BEGIN
      -- Account with the most remaining unprocessed destinations (biggest first).
      SELECT c.account_id INTO v_account
      FROM public.creatives c
      WHERE c.destination_key IS NULL AND c.impressions > 0
      GROUP BY c.account_id
      ORDER BY count(*) DESC
      LIMIT 1;

      -- Done: nothing left to drain anywhere → remove this job.
      IF v_account IS NULL THEN
        PERFORM cron.unschedule('landing-pages-destkey-drain');
        RETURN;
      END IF;

      SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

      PERFORM net.http_post(
        url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/backfill-destination-key',
        headers := json_build_object(
          'Authorization', 'Bearer ' || v_key,
          'Content-Type', 'application/json'
        )::jsonb,
        body    := json_build_object('account_id', v_account)::jsonb
      );
    END;
    $inner$;
  $CRON$
);

-- Verify:   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'landing-pages-destkey-drain';
-- Progress: SELECT account_id, count(*) FILTER (WHERE destination_key IS NULL AND impressions > 0) AS remaining
--           FROM public.creatives GROUP BY account_id HAVING count(*) FILTER (WHERE destination_key IS NULL AND impressions > 0) > 0;
