-- Growth Dashboard (consolidation step 1)
--
-- The old Growth Dashboard (goodo-growth-dashboard.vercel.app) kept every number in
-- the browser's localStorage under the key `goodo3m_v1`, and its plan figures were
-- written into the page source. Here both live in this table, one row per key:
--
--   key 'state'  the old localStorage object, same shape: rev, calls, deals, weeks, targets
--   key 'plan'   the plan figures: year, goal, Jan to Jun actuals, Jul to Dec plan per month
--
-- Builder only. Employees and clients read nothing and cannot write: every policy
-- names builder and nothing else. supabase/tests/growth_dashboard_wall_test.sql
-- proves it. No rows are seeded; the builder imports the numbers once from the page.

create table if not exists public.growth_dashboard_data (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint growth_dashboard_data_is_object check (jsonb_typeof(data) = 'object')
);

comment on table public.growth_dashboard_data is
  'Growth Dashboard numbers (builder only). key state = the old goodo3m_v1 localStorage object, key plan = plan figures.';

alter table public.growth_dashboard_data enable row level security;

revoke all on table public.growth_dashboard_data from public, anon, authenticated;
grant select, insert, update, delete on table public.growth_dashboard_data to authenticated;
grant all on table public.growth_dashboard_data to service_role;

create policy "Builder read growth_dashboard_data" on public.growth_dashboard_data
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role));

create policy "Builder insert growth_dashboard_data" on public.growth_dashboard_data
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

create policy "Builder update growth_dashboard_data" on public.growth_dashboard_data
  for update to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

create policy "Builder delete growth_dashboard_data" on public.growth_dashboard_data
  for delete to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role));

drop trigger if exists update_growth_dashboard_data_updated_at on public.growth_dashboard_data;
create trigger update_growth_dashboard_data_updated_at
  before update on public.growth_dashboard_data
  for each row execute function public.update_updated_at_column();
