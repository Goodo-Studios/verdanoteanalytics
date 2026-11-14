-- Phase 4, PR 3: the budget check and the alert check run on a schedule.
--
-- Until now both checks ran only when a builder pressed a button (Operating costs, "Check
-- budgets now"; Integration health, "Check and alert now"). This migration adds:
--
--   check_runs                         one row per run of either check: which check, whether a
--                                      person or the schedule ran it, and how it ended. The two
--                                      pages show the latest row as "last run". Staff read it;
--                                      nothing is written from the browser.
--   run_operating_budget_check(actor)  the body of the budget check, with no caller test, for
--                                      the schedule and for evaluate_operating_budgets(). Service
--                                      role only.
--   run_scheduled_budget_check()       what the schedule calls. A failure is recorded in
--                                      check_runs instead of only in the cron log. Service role
--                                      only.
--   evaluate_operating_budgets()       unchanged for a person: still builder only, still the
--                                      "Check budgets now" button; it now calls the shared body.
--
-- Two pg_cron jobs (production only: scripts/staging-lockdown.sql removes every cron job after
-- each staging deploy, so staging never runs them):
--   check-operating-budgets-daily   13:15 UTC, runs the budget check directly in the database.
--   check-integration-alerts-30m    every 30 minutes, calls integration-health with
--                                   {"action":"evaluate"} and the service role key from the Vault
--                                   (the same pattern as the ClickUp sync). Alerts are queued once
--                                   per problem per UTC day, so running often does not repeat them.
--
-- A scheduled budget check has no signed-in person, so the actor columns of the two budget tables
-- may now be empty. Owner alerts still go only to a builder-confirmed owner channel, and
-- run-slack-jobs still sends only from production with the slack_sends switch on.
-- Tests: supabase/tests/scheduled_checks_test.sql.

-- ------------------------------------------------------------------ the run record

create table public.check_runs (
  id bigint generated always as identity primary key,
  check_key text not null check (check_key in ('budget_check', 'alert_check')),
  trigger text not null check (trigger in ('manual', 'scheduled')),
  outcome text not null check (outcome in ('ok', 'failed')),
  actor_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- A scheduled run has no person; a manual run always does.
  check ((trigger = 'scheduled') = (actor_id is null))
);
create index check_runs_key_created_idx on public.check_runs (check_key, created_at desc);

comment on table public.check_runs is 'Runs of the budget check and the alert check, by hand or on schedule (phase 4). Staff read; written by the check functions and the integration-health function.';

alter table public.check_runs enable row level security;
revoke all on table public.check_runs from public, anon, authenticated;
grant select on table public.check_runs to authenticated;
grant all on table public.check_runs to service_role;

create policy "Builder/employee can read check_runs" on public.check_runs
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ the budget check

alter table public.operating_cost_events alter column actor_id drop not null;
alter table public.operating_budget_alerts alter column created_by drop not null;

-- The body of the budget check. p_actor is the builder who pressed the button, or null for the
-- schedule. Records one alert per new threshold crossing and queues an owner alert for it when a
-- confirmed owner alert channel exists. Idempotent per budget, month, level and budget version.
-- Returns the number of new crossings.
create or replace function public.run_operating_budget_check(p_actor uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_fixed numeric(12,2);
  v_budget public.operating_budgets;
  v_level text;
  v_threshold numeric(12,2);
  v_crossing text;
  v_alert uuid;
  v_job uuid;
  v_created integer := 0;
begin
  select coalesce(sum(monthly_usd), 0) into v_fixed from public.operating_cost_entries where active;
  for v_budget in select * from public.operating_budgets order by budget_key for update loop
    foreach v_level in array array['warning', 'limit'] loop
      v_threshold := case when v_level = 'warning' then v_budget.warning_usd else v_budget.monthly_limit_usd end;
      continue when v_fixed < v_threshold;
      v_crossing := v_budget.budget_key || ':' || to_char(v_month, 'YYYY-MM') || ':' || v_level || ':v' || v_budget.version;
      -- The budget row is locked above, so checks of the same budget run one at a time.
      continue when exists (select 1 from public.operating_budget_alerts where crossing_key = v_crossing);
      v_job := public.enqueue_owner_alert('budget:' || v_crossing,
        case when v_level = 'limit'
             then format('Operating costs reached the $%s monthly limit (fixed costs $%s for %s).', v_budget.monthly_limit_usd, v_fixed, to_char(v_month, 'YYYY-MM'))
             else format('Operating costs passed the $%s warning amount (limit $%s; fixed costs $%s for %s).', v_threshold, v_budget.monthly_limit_usd, v_fixed, to_char(v_month, 'YYYY-MM'))
        end);
      v_alert := null;
      insert into public.operating_budget_alerts (budget_key, period_month, level, spend_usd, threshold_usd, monthly_limit_usd,
                                                  budget_version, crossing_key, job_id, created_by)
      values (v_budget.budget_key, v_month, v_level, v_fixed, v_threshold, v_budget.monthly_limit_usd, v_budget.version, v_crossing, v_job, p_actor)
      on conflict (crossing_key) do nothing
      returning id into v_alert;
      if v_alert is not null then
        v_created := v_created + 1;
      end if;
    end loop;
  end loop;
  insert into public.operating_cost_events (action, target_key, version, actor_id, detail)
  values ('budgets_evaluated', to_char(v_month, 'YYYY-MM'), 0, p_actor,
          jsonb_build_object('fixed_usd', v_fixed, 'created', v_created, 'scheduled', p_actor is null));
  insert into public.check_runs (check_key, trigger, outcome, actor_id, detail)
  values ('budget_check', case when p_actor is null then 'scheduled' else 'manual' end, 'ok', p_actor,
          jsonb_build_object('fixed_usd', v_fixed, 'new_alerts', v_created));
  return v_created;
end;
$$;

-- Builder: check the budgets for the current month (UTC) now. Same behavior as before.
create or replace function public.evaluate_operating_budgets()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can check the budgets' using errcode = 'insufficient_privilege';
  end if;
  return public.run_operating_budget_check(auth.uid());
end;
$$;

-- What the schedule calls. If the check fails, its changes are rolled back and a failed run is
-- recorded, so the Operating costs page can say the last scheduled run did not finish.
create or replace function public.run_scheduled_budget_check()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.run_operating_budget_check(null);
exception when others then
  insert into public.check_runs (check_key, trigger, outcome, actor_id, detail)
  values ('budget_check', 'scheduled', 'failed', null, jsonb_build_object('sqlstate', sqlstate));
end;
$$;

revoke all on function public.run_operating_budget_check(uuid) from public, anon, authenticated;
revoke all on function public.run_scheduled_budget_check() from public, anon, authenticated;
grant execute on function public.run_operating_budget_check(uuid) to service_role;
grant execute on function public.run_scheduled_budget_check() to service_role;

-- ------------------------------------------------------------------ the schedules

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  r record;
begin
  for r in
    select jobid from cron.job where jobname in ('check-operating-budgets-daily', 'check-integration-alerts-30m')
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'check-operating-budgets-daily',
  '15 13 * * *',
  $$ select public.run_scheduled_budget_check() $$
);

select cron.schedule(
  'check-integration-alerts-30m',
  '*/30 * * * *',
  $$
    select net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/integration-health',
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
      body    := '{"action":"evaluate"}'::jsonb
    )
  $$
);

-- Verify after applying:
--   select jobname, schedule, active from cron.job where jobname like 'check-%';
