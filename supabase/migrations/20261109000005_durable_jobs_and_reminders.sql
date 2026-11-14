-- Goodo OS foundations 2: durable job queue and reminders (consolidation step 3, PR 2)
--
-- Port of Goodo OS's durable_jobs, job_audit, job_manual_resolutions and reminder
-- tables, in the simplest form Verdanote's pg_cron + edge function pattern needs.
-- Goodo OS's runtime identities, capability grants and command receipts are not
-- ported: in Verdanote only the service role (edge functions, cron) runs jobs, and
-- staff act through two checked functions. Design: docs/goodo-os-foundations.md.
--
--   durable_jobs        one row per unit of outside work (a Slack message, a sync).
--                       dedupe_key makes enqueueing idempotent. A worker claims a
--                       job with a lease and a fence; a stale worker (old fence,
--                       expired lease) cannot finish or fail it.
--   job_audit           append-only history of every job transition.
--   slack_destinations  Slack channels reminders and owner alerts may go to. Only a
--                       builder can add one or confirm it (owner_confirmed).
--   reminders           a message due at a time, for a confirmed destination.
--
-- At-most-once outside effects: before an effect the worker calls
-- mark_job_sending(). If its lease then runs out without finish_job/fail_job, the
-- next claim moves the job to 'recovery' instead of running it again, because the
-- effect may already have happened. Staff look and either replay it
-- (replay_job) or close it (resolve_job_manually).
--
-- Nothing here schedules anything or calls anything outside the database. The
-- worker and the reminder schedule arrive with the Slack connector, behind an
-- off-by-default switch. Tests: supabase/tests/durable_jobs_test.sql.

-- ------------------------------------------------------------------ tables

create table public.durable_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind ~ '^[a-z][a-z0-9_.-]{0,59}$'),
  dedupe_key text not null unique check (length(dedupe_key) between 1 and 300),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  client_slug text references public.clients(slug) on delete set null,
  engagement_id uuid references public.engagements(id) on delete set null,
  state text not null default 'queued'
    check (state in ('queued', 'leased', 'delivered', 'recovery', 'canceled', 'resolved_manually')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  fence bigint not null default 0,
  send_started_fence bigint,
  last_error text,
  receipt jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index durable_jobs_ready_idx on public.durable_jobs (available_at, created_at)
  where state in ('queued', 'leased');
create index durable_jobs_state_idx on public.durable_jobs (state);

create table public.job_audit (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.durable_jobs(id),
  action text not null,
  fence bigint not null,
  actor text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index job_audit_job_id_idx on public.job_audit (job_id, id);

create table public.slack_destinations (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(btrim(label)) between 1 and 120),
  channel_id text not null check (channel_id ~ '^[CGD][A-Z0-9]{2,20}$'),
  purpose text not null check (purpose in ('client_reminders', 'owner_alerts', 'internal')),
  client_slug text references public.clients(slug) on delete cascade,
  owner_confirmed boolean not null default false,
  active boolean not null default true,
  quiet_start_minute integer not null default 0 check (quiet_start_minute between 0 and 1439),
  quiet_end_minute integer not null default 0 check (quiet_end_minute between 0 and 1439),
  quiet_timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint slack_destinations_channel_purpose_unique unique (channel_id, purpose),
  constraint slack_destinations_client_reminders_have_client
    check (purpose <> 'client_reminders' or client_slug is not null)
);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('approval', 'handoff', 'owner_alert', 'custom')),
  destination_id uuid not null references public.slack_destinations(id) on delete cascade,
  client_slug text references public.clients(slug) on delete cascade,
  engagement_id uuid references public.engagements(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 3000),
  due_at timestamptz not null,
  dedupe_key text unique,
  state text not null default 'scheduled'
    check (state in ('scheduled', 'queued', 'sent', 'canceled', 'failed')),
  job_id uuid references public.durable_jobs(id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index reminders_due_idx on public.reminders (due_at) where state = 'scheduled';
create index reminders_job_id_idx on public.reminders (job_id);

comment on table public.durable_jobs is 'Durable job queue (port of Goodo OS durable_jobs). Staff read; writes through the queue functions only.';
comment on table public.job_audit is 'Append-only history of job transitions. Staff read.';
comment on table public.slack_destinations is 'Slack channels reminders and owner alerts may go to. Builder writes and confirms; employee reads.';
comment on table public.reminders is 'Reminders due at a time for a confirmed Slack destination. Staff only.';

create trigger update_durable_jobs_updated_at before update on public.durable_jobs
  for each row execute function public.update_updated_at_column();
create trigger update_slack_destinations_updated_at before update on public.slack_destinations
  for each row execute function public.update_updated_at_column();
create trigger update_reminders_updated_at before update on public.reminders
  for each row execute function public.update_updated_at_column();

-- job_audit is append-only.
create or replace function public.prevent_job_audit_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'job_audit is append-only' using errcode = '23514';
end;
$$;
create trigger job_audit_immutable before update or delete on public.job_audit
  for each row execute function public.prevent_job_audit_rewrite();
create trigger job_audit_no_truncate before truncate on public.job_audit
  for each statement execute function public.prevent_job_audit_rewrite();

-- ------------------------------------------------------------------ grants and row rules

alter table public.durable_jobs enable row level security;
alter table public.job_audit enable row level security;
alter table public.slack_destinations enable row level security;
alter table public.reminders enable row level security;

revoke all on table public.durable_jobs, public.job_audit, public.slack_destinations, public.reminders
  from public, anon, authenticated;
grant select on table public.durable_jobs, public.job_audit to authenticated;
grant select, insert, update, delete on table public.slack_destinations, public.reminders to authenticated;
grant all on table public.durable_jobs, public.job_audit, public.slack_destinations, public.reminders to service_role;

create policy "Builder/employee can read durable_jobs" on public.durable_jobs
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder/employee can read job_audit" on public.job_audit
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder/employee can read slack_destinations" on public.slack_destinations
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder can manage slack_destinations" on public.slack_destinations
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

create policy "Builder/employee can manage reminders" on public.reminders
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ queue functions (service role)

create or replace function public.job_audit_write(p_job_id uuid, p_fence bigint, p_action text, p_actor text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
set search_path = public
as $$
  insert into public.job_audit (job_id, action, fence, actor, detail)
  values (p_job_id, p_action, p_fence, p_actor, coalesce(p_detail, '{}'::jsonb));
$$;

-- Idempotent: a second call with the same dedupe_key returns the existing job.
create or replace function public.enqueue_job(
  p_kind text,
  p_dedupe_key text,
  p_payload jsonb default '{}'::jsonb,
  p_client_slug text default null,
  p_engagement_id uuid default null,
  p_available_at timestamptz default now(),
  p_max_attempts integer default 3
)
returns public.durable_jobs
language plpgsql
set search_path = public
as $$
declare
  v_job public.durable_jobs;
begin
  insert into public.durable_jobs (kind, dedupe_key, payload, client_slug, engagement_id, available_at, max_attempts)
  values (p_kind, p_dedupe_key, coalesce(p_payload, '{}'::jsonb), p_client_slug, p_engagement_id,
          coalesce(p_available_at, now()), coalesce(p_max_attempts, 3))
  on conflict (dedupe_key) do nothing
  returning * into v_job;
  if v_job.id is null then
    select * into v_job from public.durable_jobs where dedupe_key = p_dedupe_key;
    return v_job;
  end if;
  perform public.job_audit_write(v_job.id, v_job.fence, 'enqueued', 'service', jsonb_build_object('kind', p_kind));
  return v_job;
end;
$$;

-- Claims up to p_limit ready jobs of the given kinds. Independent workers get
-- different jobs (skip locked). An expired lease is reclaimed, except when the
-- worker had started an outside effect at that fence or the job has used all its
-- attempts: then the job goes to 'recovery'.
create or replace function public.claim_jobs(
  p_kinds text[],
  p_owner text,
  p_lease_seconds integer default 60,
  p_limit integer default 10
)
returns setof public.durable_jobs
language plpgsql
set search_path = public
as $$
declare
  v_job public.durable_jobs;
  v_next public.durable_jobs;
  v_claimed integer := 0;
begin
  if p_owner is null or length(btrim(p_owner)) = 0 then
    raise exception 'claim_jobs needs an owner' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'lease must be between 1 and 900 seconds' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'limit must be between 1 and 100' using errcode = '22023';
  end if;

  for v_job in
    select * from public.durable_jobs j
     where j.kind = any (p_kinds)
       and ((j.state = 'queued' and j.available_at <= now())
            or (j.state = 'leased' and j.lease_until <= now()))
     order by j.available_at, j.created_at
     limit p_limit * 4
     for update skip locked
  loop
    exit when v_claimed >= p_limit;
    if v_job.state = 'leased' and (v_job.send_started_fence = v_job.fence or v_job.attempts >= v_job.max_attempts) then
      update public.durable_jobs
         set state = 'recovery', lease_owner = null, lease_until = null,
             last_error = case when v_job.send_started_fence = v_job.fence
                               then 'lease expired after an outside effect started; outcome unknown'
                               else 'lease expired on the last attempt' end
       where id = v_job.id
       returning * into v_next;
      perform public.job_audit_write(v_next.id, v_next.fence, 'recovery', 'service', jsonb_build_object('reason', v_next.last_error, 'prior_owner', v_job.lease_owner));
      continue;
    end if;
    update public.durable_jobs
       set state = 'leased', attempts = attempts + 1, fence = fence + 1,
           lease_owner = p_owner, lease_until = now() + make_interval(secs => p_lease_seconds)
     where id = v_job.id
     returning * into v_next;
    perform public.job_audit_write(v_next.id, v_next.fence, 'claimed', p_owner, jsonb_build_object('prior_state', v_job.state));
    v_claimed := v_claimed + 1;
    return next v_next;
  end loop;
  return;
end;
$$;

-- Records that an outside effect is about to start. False if the lease is stale.
create or replace function public.mark_job_sending(p_job_id uuid, p_fence bigint, p_owner text)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_job public.durable_jobs;
begin
  select * into v_job from public.durable_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.state <> 'leased' or v_job.fence <> p_fence
     or v_job.lease_owner is distinct from p_owner or v_job.lease_until <= now() then
    return false;
  end if;
  update public.durable_jobs set send_started_fence = fence where id = p_job_id returning * into v_job;
  perform public.job_audit_write(v_job.id, v_job.fence, 'send_started', p_owner);
  return true;
end;
$$;

create or replace function public.finish_job(p_job_id uuid, p_fence bigint, p_owner text, p_receipt jsonb default '{}'::jsonb)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_job public.durable_jobs;
begin
  select * into v_job from public.durable_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.state <> 'leased' or v_job.fence <> p_fence
     or v_job.lease_owner is distinct from p_owner or v_job.lease_until <= now() then
    return false;
  end if;
  update public.durable_jobs
     set state = 'delivered', receipt = coalesce(p_receipt, '{}'::jsonb), lease_owner = null, lease_until = null, last_error = null
   where id = p_job_id
   returning * into v_job;
  perform public.job_audit_write(v_job.id, v_job.fence, 'delivered', p_owner, jsonb_build_object('receipt', v_job.receipt));
  return true;
end;
$$;

-- A definite failure. Retries after p_retry_seconds, or goes to 'recovery' when
-- permanent or out of attempts. Returns the new state, or null if the lease is stale.
create or replace function public.fail_job(
  p_job_id uuid,
  p_fence bigint,
  p_owner text,
  p_error text,
  p_retry_seconds integer default 60,
  p_permanent boolean default false
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_job public.durable_jobs;
  v_state text;
begin
  select * into v_job from public.durable_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.state <> 'leased' or v_job.fence <> p_fence
     or v_job.lease_owner is distinct from p_owner or v_job.lease_until <= now() then
    return null;
  end if;
  v_state := case when coalesce(p_permanent, false) or v_job.attempts >= v_job.max_attempts then 'recovery' else 'queued' end;
  update public.durable_jobs
     set state = v_state, lease_owner = null, lease_until = null,
         last_error = left(coalesce(p_error, 'unknown error'), 1000),
         available_at = case when v_state = 'queued'
                             then now() + make_interval(secs => greatest(coalesce(p_retry_seconds, 60), 0))
                             else available_at end
   where id = p_job_id
   returning * into v_job;
  perform public.job_audit_write(v_job.id, v_job.fence, case when v_state = 'queued' then 'retry' else 'recovery' end, p_owner,
    jsonb_build_object('error', v_job.last_error, 'permanent', coalesce(p_permanent, false)));
  return v_state;
end;
$$;

-- Cancels a job that has not run (queued) or is waiting for staff (recovery).
create or replace function public.cancel_job(p_job_id uuid, p_reason text)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_job public.durable_jobs;
begin
  update public.durable_jobs
     set state = 'canceled', last_error = left(coalesce(p_reason, 'canceled'), 1000), lease_owner = null, lease_until = null
   where id = p_job_id and state in ('queued', 'recovery')
   returning * into v_job;
  if v_job.id is null then return false; end if;
  perform public.job_audit_write(v_job.id, v_job.fence, 'canceled', 'service', jsonb_build_object('reason', v_job.last_error));
  return true;
end;
$$;

-- ------------------------------------------------------------------ staff actions on stuck jobs

-- Puts a job in recovery back in the queue with fresh attempts. Staff only.
create or replace function public.replay_job(p_job_id uuid)
returns public.durable_jobs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_job public.durable_jobs;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can replay a job' using errcode = 'insufficient_privilege';
  end if;
  update public.durable_jobs
     set state = 'queued', attempts = 0, available_at = now(), send_started_fence = null, last_error = null
   where id = p_job_id and state = 'recovery'
   returning * into v_job;
  if v_job.id is null then
    raise exception 'job is not in recovery' using errcode = '55000';
  end if;
  perform public.job_audit_write(v_job.id, v_job.fence, 'manual_replay', coalesce(auth.uid()::text, 'unknown'));
  return v_job;
end;
$$;

-- Closes a job in recovery after a manual check. It is never marked delivered.
create or replace function public.resolve_job_manually(p_job_id uuid, p_outcome text, p_note text)
returns public.durable_jobs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_job public.durable_jobs;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can resolve a job' using errcode = 'insufficient_privilege';
  end if;
  if p_outcome is null or p_outcome not in ('effect_confirmed', 'abandoned') then
    raise exception 'outcome must be effect_confirmed or abandoned' using errcode = '22023';
  end if;
  if p_note is null or length(btrim(p_note)) not between 10 and 2000 then
    raise exception 'note must be 10 to 2000 characters' using errcode = '22023';
  end if;
  update public.durable_jobs
     set state = 'resolved_manually', last_error = null
   where id = p_job_id and state = 'recovery'
   returning * into v_job;
  if v_job.id is null then
    raise exception 'job is not in recovery' using errcode = '55000';
  end if;
  perform public.job_audit_write(v_job.id, v_job.fence, 'resolved_manually', coalesce(auth.uid()::text, 'unknown'),
    jsonb_build_object('outcome', p_outcome, 'note', btrim(p_note)));
  update public.reminders
     set state = case when p_outcome = 'effect_confirmed' then 'sent' else 'canceled' end,
         cancel_reason = case when p_outcome = 'abandoned' then btrim(p_note) else cancel_reason end
   where job_id = v_job.id;
  return v_job;
end;
$$;

-- ------------------------------------------------------------------ reminders

-- True when the destination's quiet hours cover p_at. Equal start and end means
-- none. An unknown time zone counts as quiet, so nothing is sent to it.
create or replace function public.slack_destination_is_quiet(p_start integer, p_end integer, p_timezone text, p_at timestamptz)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_local timestamp;
  v_minute integer;
begin
  if p_start = p_end then
    return false;
  end if;
  begin
    v_local := p_at at time zone p_timezone;
  exception when others then
    return true;
  end;
  v_minute := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  if p_start < p_end then
    return v_minute >= p_start and v_minute < p_end;
  end if;
  return v_minute >= p_start or v_minute < p_end;
end;
$$;

-- Turns due reminders into slack.reminder jobs. Only for active, builder-confirmed
-- destinations outside quiet hours; the rest wait. Returns the number queued.
-- Writes to the database only; sending is the worker's job.
create or replace function public.enqueue_due_reminders(p_limit integer default 200)
returns integer
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_job public.durable_jobs;
  v_count integer := 0;
begin
  for r in
    select rm.*, d.channel_id, d.purpose
      from public.reminders rm
      join public.slack_destinations d on d.id = rm.destination_id
     where rm.state = 'scheduled'
       and rm.due_at <= now()
       and d.active and d.owner_confirmed
       and not public.slack_destination_is_quiet(d.quiet_start_minute, d.quiet_end_minute, d.quiet_timezone, now())
     order by rm.due_at
     limit greatest(coalesce(p_limit, 200), 1)
     for update of rm skip locked
  loop
    v_job := public.enqueue_job(
      'slack.reminder',
      'reminder:' || r.id::text,
      jsonb_build_object('reminder_id', r.id, 'channel_id', r.channel_id, 'purpose', r.purpose, 'kind', r.kind, 'body', r.body),
      r.client_slug, r.engagement_id, now(), 3);
    update public.reminders set state = 'queued', job_id = v_job.id where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Keeps a reminder's state in step with its job. resolve_job_manually sets the
-- reminder itself, because only it knows whether the message went out.
create or replace function public.sync_reminder_from_job()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind = 'slack.reminder' and new.state is distinct from old.state
     and new.state in ('delivered', 'recovery', 'canceled', 'queued') then
    update public.reminders
       set state = case new.state
                     when 'delivered' then 'sent'
                     when 'recovery' then 'failed'
                     when 'canceled' then 'canceled'
                     else 'queued' end
     where job_id = new.id;
  end if;
  return new;
end;
$$;
create trigger durable_jobs_sync_reminder after update of state on public.durable_jobs
  for each row execute function public.sync_reminder_from_job();

-- ------------------------------------------------------------------ function grants

revoke all on function public.job_audit_write(uuid, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_job(text, text, jsonb, text, uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.claim_jobs(text[], text, integer, integer) from public, anon, authenticated;
revoke all on function public.mark_job_sending(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.finish_job(uuid, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_job(uuid, bigint, text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.cancel_job(uuid, text) from public, anon, authenticated;
revoke all on function public.slack_destination_is_quiet(integer, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.enqueue_due_reminders(integer) from public, anon, authenticated;
revoke all on function public.replay_job(uuid) from public, anon, authenticated;
revoke all on function public.resolve_job_manually(uuid, text, text) from public, anon, authenticated;
revoke all on function public.prevent_job_audit_rewrite() from public, anon, authenticated;
revoke all on function public.sync_reminder_from_job() from public, anon, authenticated;

grant execute on function public.job_audit_write(uuid, bigint, text, text, jsonb) to service_role;
grant execute on function public.enqueue_job(text, text, jsonb, text, uuid, timestamptz, integer) to service_role;
grant execute on function public.claim_jobs(text[], text, integer, integer) to service_role;
grant execute on function public.mark_job_sending(uuid, bigint, text) to service_role;
grant execute on function public.finish_job(uuid, bigint, text, jsonb) to service_role;
grant execute on function public.fail_job(uuid, bigint, text, text, integer, boolean) to service_role;
grant execute on function public.cancel_job(uuid, text) to service_role;
grant execute on function public.slack_destination_is_quiet(integer, integer, text, timestamptz) to service_role;
grant execute on function public.enqueue_due_reminders(integer) to service_role;
grant execute on function public.replay_job(uuid) to authenticated, service_role;
grant execute on function public.resolve_job_manually(uuid, text, text) to authenticated, service_role;
