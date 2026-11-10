-- Goodo OS foundations 1: one client model (consolidation step 3, PR 1)
--
-- Design: docs/goodo-os-foundations.md. The old dashboard's `clients` table is the
-- one client list and `clients.slug` is the one client id. New tables:
--
--   client_ad_accounts        client -> zero or more ad accounts (an ad account
--                             belongs to at most one client). Staff only.
--   client_members            client login -> client, for clients with no ad
--                             account. Staff, and a user reads their own rows.
--   engagements               one row per 45-day cycle (each a separate purchase).
--                             Staff, and a client reads its own client's rows.
--   engagement_notes          internal side of an engagement. Staff only.
--   source_mappings           client (and optional engagement) -> outside id
--                             (ClickUp folder, Slack channel, Goodo OS client id).
--                             Staff only.
--   goodo_os_workspace_users  copy of Goodo OS workspace_users for the one-time
--                             role mapping. Builder only.
--
-- Client access starts from get_user_account_ids: get_user_client_slugs() returns
-- the clients owning an ad account the caller is linked to, plus clients the
-- caller is a member of. It answers only for auth.uid(). No existing policy or
-- helper changes. Tests: supabase/tests/goodo_os_foundations_test.sql.

-- ------------------------------------------------------------------ tables

create table public.client_ad_accounts (
  account_id text primary key references public.ad_accounts(id) on delete cascade,
  client_slug text not null references public.clients(slug) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index client_ad_accounts_client_slug_idx on public.client_ad_accounts (client_slug);

create table public.client_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_slug text not null references public.clients(slug) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (user_id, client_slug)
);
create index client_members_client_slug_idx on public.client_members (client_slug);

create table public.engagements (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on delete cascade,
  cycle_number integer not null check (cycle_number > 0),
  engagement_type text not null default 'standard_sprint'
    check (engagement_type in ('standard_sprint', 'retainer', 'custom')),
  status text not null default 'planned'
    check (status in ('planned', 'active', 'closed', 'cancelled')),
  start_date date,
  day30_date date generated always as
    (case when engagement_type = 'standard_sprint' then start_date + 29 end) stored,
  day45_date date generated always as
    (case when engagement_type = 'standard_sprint' then start_date + 44 end) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint engagements_client_cycle_unique unique (client_slug, cycle_number),
  constraint engagements_id_client_unique unique (id, client_slug),
  constraint engagements_started_has_date check (status not in ('active', 'closed') or start_date is not null)
);
create unique index engagements_one_active_sprint_per_client
  on public.engagements (client_slug)
  where engagement_type = 'standard_sprint' and status = 'active';

create table public.engagement_notes (
  engagement_id uuid primary key references public.engagements(id) on delete cascade,
  purchase_reference text,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table public.source_mappings (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on delete cascade,
  engagement_id uuid,
  provider text not null check (provider in ('clickup', 'fireflies', 'slack', 'goodo_os')),
  kind text not null check (kind ~ '^[a-z][a-z_]{0,39}$'),
  external_id text not null check (length(btrim(external_id)) between 1 and 200),
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  -- An engagement mapping must point at an engagement of the same client.
  constraint source_mappings_engagement_same_client
    foreign key (engagement_id, client_slug) references public.engagements(id, client_slug) on delete cascade
);
create unique index source_mappings_active_identity
  on public.source_mappings (provider, kind, external_id) where active;
create index source_mappings_client_slug_idx on public.source_mappings (client_slug);

create table public.goodo_os_workspace_users (
  id text primary key,
  auth_subject uuid,
  email text,
  display_name text,
  role text not null check (role in ('staff', 'client', 'owner', 'agent')),
  active boolean not null default true,
  client_ids text[] not null default '{}',
  imported_at timestamptz not null default now()
);

comment on table public.client_ad_accounts is 'Client to ad accounts (zero or more). Staff only. docs/goodo-os-foundations.md';
comment on table public.client_members is 'Client login to client, for clients with no ad account. Staff; a user reads own rows.';
comment on table public.engagements is 'One row per 45-day cycle (separate purchase). Staff; a client reads its own client''s rows.';
comment on table public.engagement_notes is 'Internal side of an engagement (purchase reference, notes). Staff only.';
comment on table public.source_mappings is 'Client or engagement to an outside id (ClickUp folder, Slack channel, Goodo OS client). Staff only.';
comment on table public.goodo_os_workspace_users is 'Copy of Goodo OS workspace_users for the one-time role mapping. Builder only.';

-- One-time copy of the legacy single account link. Only where the ad account exists.
insert into public.client_ad_accounts (account_id, client_slug, created_by)
select c.verdanote_account_id, c.slug, null
  from public.clients c
  join public.ad_accounts a on a.id = c.verdanote_account_id
 where c.verdanote_account_id is not null
on conflict (account_id) do nothing;

-- ------------------------------------------------------------------ updated_at

create trigger update_engagements_updated_at before update on public.engagements
  for each row execute function public.update_updated_at_column();
create trigger update_engagement_notes_updated_at before update on public.engagement_notes
  for each row execute function public.update_updated_at_column();
create trigger update_source_mappings_updated_at before update on public.source_mappings
  for each row execute function public.update_updated_at_column();

-- ------------------------------------------------------------------ helper

-- Clients the signed-in user belongs to. Only ever answers for auth.uid().
create or replace function public.get_user_client_slugs()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select ca.client_slug
    from public.client_ad_accounts ca
   where ca.account_id in (select public.get_user_account_ids(auth.uid()))
  union
  select cm.client_slug
    from public.client_members cm
   where cm.user_id = auth.uid()
$$;

revoke all on function public.get_user_client_slugs() from public, anon, authenticated;
grant execute on function public.get_user_client_slugs() to authenticated, service_role;

-- ------------------------------------------------------------------ grants and row rules

alter table public.client_ad_accounts enable row level security;
alter table public.client_members enable row level security;
alter table public.engagements enable row level security;
alter table public.engagement_notes enable row level security;
alter table public.source_mappings enable row level security;
alter table public.goodo_os_workspace_users enable row level security;

revoke all on table public.client_ad_accounts, public.client_members, public.engagements,
  public.engagement_notes, public.source_mappings, public.goodo_os_workspace_users
  from public, anon, authenticated;
grant select, insert, update, delete on table public.client_ad_accounts, public.client_members,
  public.engagements, public.engagement_notes, public.source_mappings, public.goodo_os_workspace_users
  to authenticated;
grant all on table public.client_ad_accounts, public.client_members, public.engagements,
  public.engagement_notes, public.source_mappings, public.goodo_os_workspace_users
  to service_role;

-- Staff (builder or employee) manage these five.
create policy "Builder/employee can manage client_ad_accounts" on public.client_ad_accounts
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder/employee can manage client_members" on public.client_members
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder/employee can manage engagements" on public.engagements
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder/employee can manage engagement_notes" on public.engagement_notes
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder/employee can manage source_mappings" on public.source_mappings
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- Builder only: holds staff emails from Goodo OS.
create policy "Builder can manage goodo_os_workspace_users" on public.goodo_os_workspace_users
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

-- Client reads: engagement dates of their own client, and their own membership rows.
create policy "Client can view own client engagements" on public.engagements
  for select to authenticated
  using (public.has_role(auth.uid(), 'client'::public.app_role)
         and client_slug in (select public.get_user_client_slugs()));

create policy "Users can read own client_members" on public.client_members
  for select to authenticated
  using (user_id = auth.uid());

-- ------------------------------------------------------------------ Goodo OS role mapping

-- owner -> builder, staff -> employee, client -> client, agent -> none.
-- There is no read-only staff role in Verdanote (Matthew's open decision).
create or replace function public.goodo_os_role_to_verdanote_role(p_role text)
returns public.app_role
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(p_role))
    when 'owner' then 'builder'::public.app_role
    when 'staff' then 'employee'::public.app_role
    when 'client' then 'client'::public.app_role
    else null
  end;
$$;

revoke all on function public.goodo_os_role_to_verdanote_role(text) from public, anon, authenticated;
grant execute on function public.goodo_os_role_to_verdanote_role(text) to authenticated, service_role;

-- What the mapping would do for each copied Goodo OS user. Internal: called by the
-- two functions below, never directly by a browser.
--   action: not_mapped | inactive | no_login | add_role | has_role | keeps_existing_role | conflict
create or replace function public.goodo_os_user_role_plan()
returns table (
  workspace_user_id text,
  email text,
  goodo_os_role text,
  active boolean,
  verdanote_role public.app_role,
  verdanote_user_id uuid,
  existing_roles text[],
  client_ids text[],
  action text
)
language sql
stable
set search_path = public
as $$
  with g as (
    select gw.id, gw.role, gw.active, gw.client_ids,
           lower(btrim(coalesce(gw.email, au.email))) as email,
           public.goodo_os_role_to_verdanote_role(gw.role) as vrole
      from public.goodo_os_workspace_users gw
      left join public.app_users au on au.auth_user_id = gw.auth_subject
  ), m as (
    select g.*, u.id as uid,
           (select array_agg(ur.role::text order by ur.role::text)
              from public.user_roles ur where ur.user_id = u.id) as roles
      from g
      left join auth.users u on g.email is not null and lower(u.email) = g.email
  )
  select m.id, m.email, m.role, m.active, m.vrole, m.uid, coalesce(m.roles, '{}'), m.client_ids,
         case
           when m.vrole is null then 'not_mapped'
           when not m.active then 'inactive'
           when m.uid is null then 'no_login'
           when m.roles is null then 'add_role'
           when m.vrole::text = any (m.roles) then 'has_role'
           when m.vrole = 'client'::public.app_role or 'client' = any (m.roles) then 'conflict'
           else 'keeps_existing_role'
         end
    from m
   order by m.id;
$$;

-- Owner only: it reads auth.users and is reached through the two definer functions.
revoke all on function public.goodo_os_user_role_plan() from public, anon, authenticated, service_role;

-- Preview for the staff page. Builder only: it lists staff emails.
create or replace function public.goodo_os_user_role_mapping()
returns table (
  workspace_user_id text,
  email text,
  goodo_os_role text,
  active boolean,
  verdanote_role public.app_role,
  verdanote_user_id uuid,
  existing_roles text[],
  client_ids text[],
  action text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only builders can read the Goodo OS role mapping'
      using errcode = 'insufficient_privilege';
  end if;
  return query select * from public.goodo_os_user_role_plan();
end;
$$;

revoke all on function public.goodo_os_user_role_mapping() from public, anon, authenticated;
grant execute on function public.goodo_os_user_role_mapping() to authenticated, service_role;

-- Applies the mapping. Service role only. Adds a role only to a login with no role,
-- never removes or changes one, and never gives a staff role to a client login or
-- the client role to a staff login (reported as conflicts). For client users it adds
-- client_members rows for Goodo OS client ids that have an active source mapping
-- (provider goodo_os, kind client).
create or replace function public.apply_goodo_os_user_role_mapping()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_members integer;
  v_roles integer;
  v_conflicts text[];
begin
  select coalesce(array_agg(p.workspace_user_id order by p.workspace_user_id), '{}')
    into v_conflicts
    from public.goodo_os_user_role_plan() p
   where p.action = 'conflict';

  -- Memberships first: the plan's actions change once roles are added.
  insert into public.client_members (user_id, client_slug, created_by)
  select distinct p.verdanote_user_id, sm.client_slug, null::uuid
    from public.goodo_os_user_role_plan() p
    cross join lateral unnest(p.client_ids) as cid(id)
    join public.source_mappings sm
      on sm.provider = 'goodo_os' and sm.kind = 'client' and sm.external_id = cid.id and sm.active
   where p.verdanote_role = 'client'::public.app_role
     and p.action in ('add_role', 'has_role')
  on conflict (user_id, client_slug) do nothing;
  get diagnostics v_members = row_count;

  insert into public.user_roles (user_id, role)
  select p.verdanote_user_id, p.verdanote_role
    from public.goodo_os_user_role_plan() p
   where p.action = 'add_role'
  on conflict (user_id, role) do nothing;
  get diagnostics v_roles = row_count;

  return jsonb_build_object(
    'roles_added', v_roles,
    'memberships_added', v_members,
    'conflicts', to_jsonb(v_conflicts));
end;
$$;

revoke all on function public.apply_goodo_os_user_role_mapping() from public, anon, authenticated;
grant execute on function public.apply_goodo_os_user_role_mapping() to service_role;
