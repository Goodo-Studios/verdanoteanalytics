-- Daily cleanup of public application uploads (production only).
--
-- Calls the cleanup-application-uploads edge function with the service role key from the Vault, the
-- same pattern as the other jobs (20261112000003, 20261130080001). The job is production only:
-- scripts/staging-lockdown.sql removes every cron job after each staging deploy.
--
-- It is off by default twice over. The function deletes nothing unless the outbound_switches row
-- 'application_upload_cleanup' exists and is enabled, and no row is created here. Until a builder
-- adds it, the job's calls answer "switch_off" and touch nothing. To look first, call the function by
-- hand with {"dry_run":true} (the default when the body says nothing); it lists what it would delete.
--
-- Turn on:   insert into public.outbound_switches (name, enabled, note)
--              values ('application_upload_cleanup', true, 'delete expired application uploads')
--              on conflict (name) do update set enabled = true;
-- Turn off:  update public.outbound_switches set enabled = false where name = 'application_upload_cleanup';
-- Rollback:  select cron.unschedule('cleanup-application-uploads-daily');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  r record;
begin
  for r in select jobid from cron.job where jobname = 'cleanup-application-uploads-daily' loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'cleanup-application-uploads-daily',
  '20 4 * * *',
  $$
    select net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/cleanup-application-uploads',
      headers := json_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'service_role_key'
          limit 1
        ),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{"dry_run":false,"limit":50}'::jsonb,
      timeout_milliseconds := 55000
    )
  $$
);

-- Verify after applying:
--   select jobname, schedule, active from cron.job where jobname = 'cleanup-application-uploads-daily';
