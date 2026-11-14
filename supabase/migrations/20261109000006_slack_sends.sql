-- Goodo OS foundations 4: Slack reminders and owner alerts (consolidation step 3)
--
-- The run-slack-jobs edge function sends slack.reminder and slack.owner_alert jobs
-- (migration 20261109000005). It sends only when all three hold:
--   1. it runs in the production project (checked in the function code, never in
--      the database, so the staging lockdown cannot rewrite it);
--   2. outbound_switches row 'slack_sends' exists with enabled = true. No row is
--      inserted here, so sending is off until a builder turns it on;
--   3. SLACK_BOT_TOKEN is set.
--
--   outbound_switches     named on/off switches for anything that writes to an
--                         outside service. Builder writes; staff read.
--   enqueue_owner_alert   service role: queues one owner alert for the active,
--                         builder-confirmed owner_alerts destination. Returns
--                         null and queues nothing when there is none.
--   cron                  run-slack-jobs every 5 minutes. Staging:
--                         scripts/staging-lockdown.sql removes every cron job
--                         after each push.

create table public.outbound_switches (
  name text primary key check (name ~ '^[a-z][a-z0-9_]{0,59}$'),
  enabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

comment on table public.outbound_switches is
  'On/off switches for writes to outside services (slack_sends). Off when the row is missing. Builder writes; staff read.';

alter table public.outbound_switches enable row level security;
revoke all on table public.outbound_switches from public, anon, authenticated;
grant select, insert, update, delete on table public.outbound_switches to authenticated;
grant all on table public.outbound_switches to service_role;

create policy "Builder/employee can read outbound_switches" on public.outbound_switches
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder can manage outbound_switches" on public.outbound_switches
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

create trigger update_outbound_switches_updated_at before update on public.outbound_switches
  for each row execute function public.update_updated_at_column();

-- One owner alert, deduplicated by p_key (a second call with the same key returns
-- the first job). Goes to the oldest active, confirmed owner_alerts destination.
create or replace function public.enqueue_owner_alert(p_key text, p_text text)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_channel text;
  v_job public.durable_jobs;
begin
  if p_key is null or length(btrim(p_key)) = 0 or length(p_key) > 200 then
    raise exception 'owner alert key must be 1 to 200 characters' using errcode = '22023';
  end if;
  if p_text is null or length(btrim(p_text)) = 0 or length(p_text) > 3000 then
    raise exception 'owner alert text must be 1 to 3000 characters' using errcode = '22023';
  end if;
  select d.channel_id into v_channel
    from public.slack_destinations d
   where d.purpose = 'owner_alerts' and d.active and d.owner_confirmed
   order by d.created_at, d.id
   limit 1;
  if v_channel is null then
    return null;
  end if;
  v_job := public.enqueue_job('slack.owner_alert', 'owner-alert:' || btrim(p_key),
    jsonb_build_object('channel_id', v_channel, 'text', p_text));
  return v_job.id;
end;
$$;

revoke all on function public.enqueue_owner_alert(text, text) from public, anon, authenticated;
grant execute on function public.enqueue_owner_alert(text, text) to service_role;

-- Schedule. Production only in effect: the staging lockdown removes it, and the
-- function refuses to send outside production anyway.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  r record;
begin
  for r in select jobid from cron.job where jobname = 'run-slack-jobs-5m' loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'run-slack-jobs-5m',
  '*/5 * * * *',
  $$
    select net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/run-slack-jobs',
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
      body    := '{}'::jsonb
    )
  $$
);
