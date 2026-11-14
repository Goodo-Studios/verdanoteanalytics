-- Goodo OS wave D: operating costs, builder only (consolidation step 4d). Port of Goodo OS
-- migration 058_operating_costs.sql, backend/services/operatingCosts.ts and the staff page
-- src/pages/staff/OperatingCosts.tsx (US-065, operating cost visibility for the owner).
--
--   operating_cost_entries   fixed monthly costs a builder records: label, category, monthly
--                            amount in USD, basis (proposed, quoted, invoiced) and where the
--                            figure comes from. One current row per entry key with a version;
--                            changed only by record_operating_cost_entry.
--   operating_budgets        the monthly budget: a limit and a warning amount below it. One
--                            row per budget key with a version; changed only by
--                            record_operating_budget.
--   operating_cost_events    every recorded entry, budget and budget check. Immutable.
--   operating_budget_alerts  one row per threshold crossing (budget, month, level and the
--                            budget version whose threshold was crossed), with the owner alert
--                            job it queued, if any. Immutable.
--
-- Budget alerts go through the step 3 owner alert path (enqueue_owner_alert): a job is queued
-- only when a builder-confirmed owner alert Slack channel exists, and run-slack-jobs sends only
-- from production with the slack_sends switch on. Staging has neither, so nothing is sent.
--
-- Differences from Goodo OS (conservative, see "Needs the owner" in the plan): Goodo OS measured
-- model spend from the token usage its model adapter reported on agent jobs, evaluations and
-- meeting recaps. Verdanote's meeting recaps and agent evaluations do not record token usage,
-- so model spend is not measured here and there is one budget, 'total', over the active fixed
-- entries. Without variable spend a month-end forecast equals the fixed total, so the
-- 'forecast' level is not ported; 'warning' and 'limit' are. The Goodo OS alert outbox with
-- its own lease and reconcile is replaced by the shared job queue.
--
-- Sensitive: builders read every table; employees and clients read nothing. Writes go only
-- through the checked functions (SECURITY DEFINER, builder tested in each body).
-- Tests: supabase/tests/operating_costs_test.sql.

create table public.operating_cost_entries (
  entry_key text primary key check (entry_key ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
  label text not null check (length(btrim(label)) between 3 and 200),
  category text not null check (category in ('worker_compute', 'database', 'frontend_hosting', 'monitoring', 'model_provider', 'other')),
  monthly_usd numeric(12,2) not null check (monthly_usd >= 0 and monthly_usd <= 100000),
  basis text not null check (basis in ('proposed', 'quoted', 'invoiced')),
  source_reference text not null check (length(btrim(source_reference)) between 3 and 500),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);

create table public.operating_budgets (
  budget_key text primary key check (budget_key in ('total')),
  monthly_limit_usd numeric(12,2) not null check (monthly_limit_usd > 0 and monthly_limit_usd <= 100000),
  warning_usd numeric(12,2) not null check (warning_usd > 0),
  version integer not null default 1 check (version > 0),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  check (warning_usd < monthly_limit_usd)
);

create table public.operating_cost_events (
  id bigint generated always as identity primary key,
  action text not null check (action in ('entry_recorded', 'budget_recorded', 'budgets_evaluated')),
  target_key text not null,
  version integer not null,
  actor_id uuid not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index operating_cost_events_created_idx on public.operating_cost_events (created_at desc);

create table public.operating_budget_alerts (
  id uuid primary key default gen_random_uuid(),
  budget_key text not null references public.operating_budgets(budget_key) on delete restrict,
  period_month date not null check (extract(day from period_month) = 1),
  level text not null check (level in ('warning', 'limit')),
  spend_usd numeric(12,2) not null check (spend_usd >= 0),
  threshold_usd numeric(12,2) not null check (threshold_usd > 0),
  monthly_limit_usd numeric(12,2) not null check (monthly_limit_usd > 0),
  budget_version integer not null check (budget_version > 0),
  crossing_key text not null unique,
  job_id uuid references public.durable_jobs(id) on delete restrict,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (crossing_key = budget_key || ':' || to_char(period_month, 'YYYY-MM') || ':' || level || ':v' || budget_version)
);
create index operating_budget_alerts_created_idx on public.operating_budget_alerts (created_at desc);

comment on table public.operating_cost_entries is 'Fixed monthly operating costs (port of Goodo OS operating_cost_entries). Builder only; written by record_operating_cost_entry.';
comment on table public.operating_budgets is 'Monthly operating budget with a warning amount. Builder only; written by record_operating_budget.';
comment on table public.operating_cost_events is 'History of recorded cost entries, budgets and budget checks. Builder only. Immutable.';
comment on table public.operating_budget_alerts is 'One row per budget threshold crossing, with the owner alert job it queued. Builder only. Immutable.';

create or replace function public.prevent_operating_cost_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'operating cost history is immutable' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_operating_cost_rewrite() from public, anon, authenticated;

create trigger operating_cost_events_immutable before update or delete on public.operating_cost_events
  for each row execute function public.prevent_operating_cost_rewrite();
create trigger operating_cost_events_no_truncate before truncate on public.operating_cost_events
  for each statement execute function public.prevent_operating_cost_rewrite();
create trigger operating_budget_alerts_immutable before update or delete on public.operating_budget_alerts
  for each row execute function public.prevent_operating_cost_rewrite();
create trigger operating_budget_alerts_no_truncate before truncate on public.operating_budget_alerts
  for each statement execute function public.prevent_operating_cost_rewrite();
create trigger operating_cost_entries_no_delete before delete on public.operating_cost_entries
  for each row execute function public.prevent_operating_cost_rewrite();
create trigger operating_budgets_no_delete before delete on public.operating_budgets
  for each row execute function public.prevent_operating_cost_rewrite();

-- ------------------------------------------------------------------ grants and row rules

alter table public.operating_cost_entries enable row level security;
alter table public.operating_budgets enable row level security;
alter table public.operating_cost_events enable row level security;
alter table public.operating_budget_alerts enable row level security;

revoke all on table public.operating_cost_entries, public.operating_budgets, public.operating_cost_events, public.operating_budget_alerts
  from public, anon, authenticated;
grant select on table public.operating_cost_entries, public.operating_budgets, public.operating_cost_events, public.operating_budget_alerts
  to authenticated;
grant all on table public.operating_cost_entries, public.operating_budgets, public.operating_cost_events, public.operating_budget_alerts
  to service_role;

create policy "Builder can read operating_cost_entries" on public.operating_cost_entries
  for select to authenticated using (public.has_role(auth.uid(), 'builder'::public.app_role));
create policy "Builder can read operating_budgets" on public.operating_budgets
  for select to authenticated using (public.has_role(auth.uid(), 'builder'::public.app_role));
create policy "Builder can read operating_cost_events" on public.operating_cost_events
  for select to authenticated using (public.has_role(auth.uid(), 'builder'::public.app_role));
create policy "Builder can read operating_budget_alerts" on public.operating_budget_alerts
  for select to authenticated using (public.has_role(auth.uid(), 'builder'::public.app_role));

-- ------------------------------------------------------------------ checked functions

-- Builder: record a fixed monthly cost (new entry at expected version 0, or the next
-- version of an existing one). Returns the new version.
create or replace function public.record_operating_cost_entry(
  p_entry_key text,
  p_label text,
  p_category text,
  p_monthly_usd numeric,
  p_basis text,
  p_source_reference text,
  p_active boolean,
  p_expected_version integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_current integer;
  v_version integer;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can record operating costs' using errcode = 'insufficient_privilege';
  end if;
  if p_entry_key is null or p_entry_key !~ '^[a-z0-9][a-z0-9_-]{1,79}$'
     or p_label is null or length(btrim(p_label)) not between 3 and 200
     or p_category is null or p_category not in ('worker_compute', 'database', 'frontend_hosting', 'monitoring', 'model_provider', 'other')
     or p_monthly_usd is null or p_monthly_usd < 0 or p_monthly_usd > 100000 or p_monthly_usd <> round(p_monthly_usd, 2)
     or p_basis is null or p_basis not in ('proposed', 'quoted', 'invoiced')
     or p_source_reference is null or length(btrim(p_source_reference)) not between 3 and 500
     or p_active is null or p_expected_version is null or p_expected_version < 0 then
    raise exception 'check the cost entry fields' using errcode = '22023';
  end if;
  select version into v_current from public.operating_cost_entries where entry_key = p_entry_key for update;
  if coalesce(v_current, 0) <> p_expected_version then
    raise exception 'the cost entry changed since it was opened' using errcode = '40001';
  end if;
  insert into public.operating_cost_entries (entry_key, label, category, monthly_usd, basis, source_reference, active, updated_by)
  values (p_entry_key, btrim(p_label), p_category, p_monthly_usd, p_basis, btrim(p_source_reference), p_active, auth.uid())
  on conflict (entry_key) do update
     set label = excluded.label, category = excluded.category, monthly_usd = excluded.monthly_usd, basis = excluded.basis,
         source_reference = excluded.source_reference, active = excluded.active, updated_by = excluded.updated_by,
         updated_at = now(), version = public.operating_cost_entries.version + 1
  returning version into v_version;
  insert into public.operating_cost_events (action, target_key, version, actor_id, detail)
  values ('entry_recorded', p_entry_key, v_version, auth.uid(),
          jsonb_build_object('label', btrim(p_label), 'category', p_category, 'monthly_usd', p_monthly_usd, 'basis', p_basis,
                             'source_reference', btrim(p_source_reference), 'active', p_active));
  return v_version;
end;
$$;

-- Builder: record the monthly budget (limit and a warning amount below it). Returns the new version.
create or replace function public.record_operating_budget(
  p_budget_key text,
  p_monthly_limit_usd numeric,
  p_warning_usd numeric,
  p_expected_version integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_current integer;
  v_version integer;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can record a budget' using errcode = 'insufficient_privilege';
  end if;
  if p_budget_key is null or p_budget_key not in ('total')
     or p_monthly_limit_usd is null or p_monthly_limit_usd <= 0 or p_monthly_limit_usd > 100000 or p_monthly_limit_usd <> round(p_monthly_limit_usd, 2)
     or p_warning_usd is null or p_warning_usd <= 0 or p_warning_usd <> round(p_warning_usd, 2)
     or p_warning_usd >= p_monthly_limit_usd
     or p_expected_version is null or p_expected_version < 0 then
    raise exception 'the warning amount must be above zero and below the limit' using errcode = '22023';
  end if;
  select version into v_current from public.operating_budgets where budget_key = p_budget_key for update;
  if coalesce(v_current, 0) <> p_expected_version then
    raise exception 'the budget changed since it was opened' using errcode = '40001';
  end if;
  insert into public.operating_budgets (budget_key, monthly_limit_usd, warning_usd, updated_by)
  values (p_budget_key, p_monthly_limit_usd, p_warning_usd, auth.uid())
  on conflict (budget_key) do update
     set monthly_limit_usd = excluded.monthly_limit_usd, warning_usd = excluded.warning_usd, updated_by = excluded.updated_by,
         updated_at = now(), version = public.operating_budgets.version + 1
  returning version into v_version;
  insert into public.operating_cost_events (action, target_key, version, actor_id, detail)
  values ('budget_recorded', p_budget_key, v_version, auth.uid(),
          jsonb_build_object('monthly_limit_usd', p_monthly_limit_usd, 'warning_usd', p_warning_usd));
  return v_version;
end;
$$;

-- Builder: check the budgets for the current month (UTC) now. Records one alert per new
-- threshold crossing and queues an owner alert for it when a confirmed owner alert channel
-- exists. Idempotent per budget, month, level and budget version. Returns the number of new
-- crossings.
create or replace function public.evaluate_operating_budgets()
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
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can check the budgets' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(sum(monthly_usd), 0) into v_fixed from public.operating_cost_entries where active;
  for v_budget in select * from public.operating_budgets order by budget_key for update loop
    foreach v_level in array array['warning', 'limit'] loop
      v_threshold := case when v_level = 'warning' then v_budget.warning_usd else v_budget.monthly_limit_usd end;
      continue when v_fixed < v_threshold;
      v_crossing := v_budget.budget_key || ':' || to_char(v_month, 'YYYY-MM') || ':' || v_level || ':v' || v_budget.version;
      -- The budget row is locked above, so checks of the same budget run one at a time.
      continue when exists (select 1 from public.operating_budget_alerts where crossing_key = v_crossing);
      -- Queued first so the immutable alert row is written once, with its job. The owner
      -- alert is deduplicated by key and is queued only for a confirmed owner channel.
      v_job := public.enqueue_owner_alert('budget:' || v_crossing,
        case when v_level = 'limit'
             then format('Operating costs reached the $%s monthly limit (fixed costs $%s for %s).', v_budget.monthly_limit_usd, v_fixed, to_char(v_month, 'YYYY-MM'))
             else format('Operating costs passed the $%s warning amount (limit $%s; fixed costs $%s for %s).', v_threshold, v_budget.monthly_limit_usd, v_fixed, to_char(v_month, 'YYYY-MM'))
        end);
      v_alert := null;
      insert into public.operating_budget_alerts (budget_key, period_month, level, spend_usd, threshold_usd, monthly_limit_usd,
                                                  budget_version, crossing_key, job_id, created_by)
      values (v_budget.budget_key, v_month, v_level, v_fixed, v_threshold, v_budget.monthly_limit_usd, v_budget.version, v_crossing, v_job, auth.uid())
      on conflict (crossing_key) do nothing
      returning id into v_alert;
      if v_alert is not null then
        v_created := v_created + 1;
      end if;
    end loop;
  end loop;
  insert into public.operating_cost_events (action, target_key, version, actor_id, detail)
  values ('budgets_evaluated', to_char(v_month, 'YYYY-MM'), 0, auth.uid(), jsonb_build_object('fixed_usd', v_fixed, 'created', v_created));
  return v_created;
end;
$$;

revoke all on function public.record_operating_cost_entry(text, text, text, numeric, text, text, boolean, integer),
  public.record_operating_budget(text, numeric, numeric, integer),
  public.evaluate_operating_budgets()
  from public, anon;
grant execute on function public.record_operating_cost_entry(text, text, text, numeric, text, text, boolean, integer),
  public.record_operating_budget(text, numeric, numeric, integer),
  public.evaluate_operating_budgets()
  to authenticated, service_role;
