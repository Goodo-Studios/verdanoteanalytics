-- Throttled, self-terminating backfill of creatives.destination_key across all
-- accounts (Landing Pages rollout). The initial rollout drained 8 of 15 accounts;
-- the rest were paused when Meta returned its app-wide rate limit ("too many calls")
-- to avoid starving the live nightly sync.
--
-- This cron drains ONE account per tick (every 15 min): it picks the account with
-- the most creatives still missing destination_key and fires backfill-destination-key
-- for it. One account / 15 min keeps Meta load low relative to the sync. When no
-- account has unprocessed destinations left, it unschedules itself. Idempotent.
--
-- (backfill-destination-key already marks no-link ads with a '' sentinel, so a
-- drained account has no `destination_key IS NULL AND impressions > 0` rows and is
-- never re-picked.)

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'landing-pages-destkey-drain'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END;
$$;

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

-- Inspect:  SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'landing-pages-destkey-drain';
-- Progress: SELECT account_id, count(*) FILTER (WHERE destination_key IS NULL AND impressions > 0) AS remaining
--           FROM public.creatives GROUP BY account_id HAVING count(*) FILTER (WHERE destination_key IS NULL AND impressions > 0) > 0;
