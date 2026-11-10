-- Client view, phase 5: work grouped by cycle, with past cycles kept.
--
-- The client board used to show only the last 30 days of delivered work, so a finished cycle
-- disappeared. This migration keeps what is needed to show it:
--
--   pipeline_tasks.cycle_month   first day of the month named in the task ("November Asset 3"), with
--                                the year worked out by the sync. Null when the name has no month.
--   pipeline_tasks.delivered_at  the day a delivered task was finished (null while in progress).
--   pipeline_delivered           delivered tasks older than the 30 day window, up to a year back.
--                                Same client-safe fields as the board, nothing else. Written by
--                                sync-clickup-tasks (service role). A separate table on purpose: the
--                                staff Home page reads every pipeline_tasks row in one request, and
--                                a year of finished work there would push it past the 1000 row limit
--                                of that request.
--
-- A client reads pipeline_delivered for its own clients, the same rule as pipeline_tasks. Staff read
-- it. Nobody writes it from the browser. Cycle dates for the header come from engagements, which a
-- client can already read for its own clients (no change there).
--
-- Tests: supabase/tests/pipeline_delivered_test.sql.

-- ------------------------------------------------------------------ pipeline_tasks columns

alter table public.pipeline_tasks
  add column cycle_month date,
  add column delivered_at date;

comment on column public.pipeline_tasks.cycle_month is
  'First day of the cycle month read from the task name ("November Asset 3"). Set by sync-clickup-tasks. Null when the name has no month.';
comment on column public.pipeline_tasks.delivered_at is
  'Day the task was delivered (Ready to Launch). Null while it is still in progress.';

-- ------------------------------------------------------------------ pipeline_delivered

create table public.pipeline_delivered (
  id uuid primary key default gen_random_uuid(),
  clickup_task_id text not null unique,
  client_slug text not null references public.clients(slug) on delete cascade,
  account_id text references public.ad_accounts(id) on delete set null,
  task_name text,
  content_type text,
  cycle_month date,
  delivered_at date not null,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pipeline_delivered_client_slug_idx on public.pipeline_delivered (client_slug);
create index pipeline_delivered_account_id_idx on public.pipeline_delivered (account_id);
create index pipeline_delivered_synced_at_idx on public.pipeline_delivered (synced_at);

comment on table public.pipeline_delivered is
  'Delivered tasks older than the 30 day board window, kept up to a year so past cycles stay visible. Client-safe fields only. Written by sync-clickup-tasks; staff and the owning client read.';

alter table public.pipeline_delivered enable row level security;
revoke all on table public.pipeline_delivered from public, anon, authenticated;
grant select on table public.pipeline_delivered to authenticated;
grant all on table public.pipeline_delivered to service_role;

create policy "Builder/employee can read pipeline_delivered" on public.pipeline_delivered
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Client can view own pipeline_delivered" on public.pipeline_delivered
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'client'::public.app_role)
    and client_slug in (select public.get_user_client_slugs())
  );
