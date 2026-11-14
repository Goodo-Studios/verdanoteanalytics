-- Old dashboard batch 4, Settings and team (consolidation step 5d, PR 1): one staff list.
--
-- Three lists describe the staff today and they drift apart:
--   app_users      the old dashboard team list, copied in by PR 133. Owner dropdowns
--                  (creator pipeline, casting, follow-ups) list it, and follow-ups and the
--                  application reviewer find the signed-in person in it by login email.
--   auth.users     Verdanote logins (with profiles for the display name).
--   user_roles     Verdanote roles: builder, employee, client.
--
-- This migration does not merge anyone. People are matched only by exact email (trimmed,
-- case ignored), the same rule every staff function already uses. A same-name, different-email
-- pair is reported as a possible match for a person to check; it is never joined.
--
--   staff_role_mappings  the dashboard role to Verdanote role mapping as data, shown on the
--                        Team page. Seeded with the conservative default while owner decision 2
--                        is open: admin -> builder, producer -> employee, viewer -> employee with
--                        needs_owner_decision set. A flagged row is shown and proposed but never
--                        applied (dashboard_role_to_verdanote_role returns null for it), so
--                        viewers keep getting no role until the owner decides.
--   staff_invites        invites prepared for team list members who have no Verdanote login.
--                        Prepared or cancelled only. Nothing here sends an email; sending is a
--                        release step.
--   staff_admin_events   an immutable record of every change made through the functions below.
--
-- Read rules: staff (builder or employee) read the mapping; only builders read invites and
-- events. Clients read none of the three. Signed-in users hold no write grants: every change
-- goes through a checked SECURITY DEFINER function that tests the role in its own body
-- before it looks at any argument.
--
--   staff_reconciliation()              builder: one row per person with the mismatches
--   set_staff_role_mapping(...)         builder: change one mapping row (records the decision)
--   prepare_staff_invite(id)            builder: prepare an invite for a team list member
--   cancel_staff_invite(id, reason)     builder
--   add_login_to_team_list(user, name)  builder: put a staff login on the team list
--   update_team_member(...)             builder: name, dashboard role, active on the team list
--   set_staff_role(user, role)          builder: builder or employee on a staff login; never
--                                       the caller's own role, never a client login
--
-- Tests: supabase/tests/staff_team_reconciliation_test.sql.

-- ------------------------------------------------------------------ tables

create table public.staff_role_mappings (
  dashboard_role text primary key check (dashboard_role in ('admin', 'producer', 'viewer')),
  verdanote_role public.app_role not null check (verdanote_role in ('builder', 'employee')),
  needs_owner_decision boolean not null default false,
  note text not null default '' check (length(note) <= 500),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into public.staff_role_mappings (dashboard_role, verdanote_role, needs_owner_decision, note) values
  ('admin', 'builder', false, 'In the plan: a dashboard admin manages the team, as a builder does.'),
  ('producer', 'employee', false, 'Conservative default while owner decision 2 is open. A producer may later get a narrower role.'),
  ('viewer', 'employee', true, 'Owner decision 2 is open. A viewer only reads on the old dashboard and an employee can write, so this is proposed, never applied, until the owner decides.');

create table public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references public.app_users(id) on delete restrict,
  email text not null check (length(btrim(email)) between 3 and 320),
  name text not null check (length(btrim(name)) between 1 and 120),
  proposed_role public.app_role not null check (proposed_role in ('builder', 'employee')),
  mapping_flagged boolean not null,
  status text not null default 'prepared' check (status in ('prepared', 'cancelled')),
  prepared_by uuid not null,
  prepared_at timestamptz not null default now(),
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(btrim(cancel_reason)) between 3 and 500),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create unique index staff_invites_one_prepared_per_email on public.staff_invites (lower(btrim(email))) where status = 'prepared';

create table public.staff_admin_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('mapping_changed', 'invite_prepared', 'invite_cancelled',
    'team_member_added', 'team_member_updated', 'staff_role_set')),
  subject text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);
create index staff_admin_events_created_idx on public.staff_admin_events (created_at desc);

comment on table public.staff_role_mappings is 'Dashboard role to Verdanote role mapping (step 5d). Rows with needs_owner_decision are proposed, never applied. Staff read; builders change through set_staff_role_mapping.';
comment on table public.staff_invites is 'Invites prepared for team list members without a Verdanote login (step 5d). Never sent from here. Builders only.';
comment on table public.staff_admin_events is 'Immutable record of staff list and role changes made through the step 5d functions. Builders only.';

create or replace function public.prevent_staff_admin_event_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'staff admin events are immutable' using errcode = '23514';
end;
$$;
revoke all on function public.prevent_staff_admin_event_rewrite() from public, anon, authenticated;

create trigger staff_admin_events_immutable before update or delete on public.staff_admin_events
  for each row execute function public.prevent_staff_admin_event_rewrite();
create trigger staff_admin_events_no_truncate before truncate on public.staff_admin_events
  for each statement execute function public.prevent_staff_admin_event_rewrite();

-- ------------------------------------------------------------------ grants and row rules

alter table public.staff_role_mappings enable row level security;
alter table public.staff_invites enable row level security;
alter table public.staff_admin_events enable row level security;

revoke all on table public.staff_role_mappings, public.staff_invites, public.staff_admin_events from public, anon, authenticated;
grant select on table public.staff_role_mappings, public.staff_invites, public.staff_admin_events to authenticated;
grant all on table public.staff_role_mappings, public.staff_invites, public.staff_admin_events to service_role;

create policy "Builder/employee can read staff_role_mappings" on public.staff_role_mappings
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder can read staff_invites" on public.staff_invites
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role));
create policy "Builder can read staff_admin_events" on public.staff_admin_events
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role));

-- ------------------------------------------------------------------ the mapping as data

-- The role that is applied for a dashboard role. Reads staff_role_mappings under the caller's
-- row rules (not SECURITY DEFINER), so a client gets null. A flagged row gives null: it is a
-- proposal, not a decision. apply_app_user_role_mapping() and app_user_role_mapping() (PR 133)
-- go through this, so they follow the table from now on.
create or replace function public.dashboard_role_to_verdanote_role(p_role text)
returns public.app_role
language sql
stable
set search_path = public
as $$
  select m.verdanote_role
    from public.staff_role_mappings m
   where m.dashboard_role = p_role
     and not m.needs_owner_decision;
$$;
revoke all on function public.dashboard_role_to_verdanote_role(text) from public, anon, authenticated;
grant execute on function public.dashboard_role_to_verdanote_role(text) to authenticated;

-- PR 133's apply step, now also skipping a login that holds the client role: a client login
-- that shares an email with a team list member is reported (client_login), never given a
-- staff role. Emails are compared trimmed with case ignored, as in the reconciliation. Still
-- service role only and still never removes a role or creates a login.
create or replace function public.apply_app_user_role_mapping()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_added integer;
begin
  insert into public.user_roles (user_id, role)
  select u.id, public.dashboard_role_to_verdanote_role(au.role)
  from public.app_users au
  join auth.users u on lower(btrim(u.email)) = lower(btrim(au.email))
  where au.active
    and public.dashboard_role_to_verdanote_role(au.role) is not null
    and not exists (select 1 from public.user_roles c where c.user_id = u.id and c.role = 'client')
  on conflict (user_id, role) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;
revoke all on function public.apply_app_user_role_mapping() from public, anon, authenticated;
grant execute on function public.apply_app_user_role_mapping() to service_role;

-- ------------------------------------------------------------------ reconciliation

-- One row per person: every team list member, plus every login that holds a staff role.
-- issues (empty when everything lines up):
--   no_login                  active on the team list, no Verdanote login with that email
--   client_login              on the team list, but the login with that email is a client
--   no_staff_role             active on the team list, login has no role at all
--   role_differs              active on the team list, staff roles are not exactly the mapped role
--   mapping_needs_owner       active on the team list with a dashboard role whose mapping is flagged
--   inactive_with_staff_role  deactivated on the team list, login still holds a staff role
--   not_on_team_list          staff login with no team list row (missing from owner dropdowns;
--                             follow-ups cannot find them and show everyone)
--   possible_name_match       same name as someone under a different email; never merged
create or replace function public.staff_reconciliation()
returns table (
  email text,
  team_member_id uuid,
  team_name text,
  team_role text,
  team_active boolean,
  user_id uuid,
  login_name text,
  staff_roles text[],
  has_client_role boolean,
  mapped_role text,
  mapping_flagged boolean,
  prepared_invite_id uuid,
  possible_match text,
  issues text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can read the staff reconciliation'
      using errcode = '42501';
  end if;

  return query
  with team as (
    select au.id, au.name, au.email, lower(btrim(au.email)) as k, au.role, au.active
      from public.app_users au
  ),
  logins as (
    select u.id as uid,
           lower(btrim(u.email)) as k,
           u.email::text as login_email,
           p.display_name,
           coalesce(array_agg(ur.role::text order by ur.role::text)
                      filter (where ur.role in ('builder', 'employee')), '{}'::text[]) as sroles,
           coalesce(bool_or(ur.role = 'client'), false) as is_client
      from auth.users u
      left join public.profiles p on p.user_id = u.id
      left join public.user_roles ur on ur.user_id = u.id
     where u.email is not null and btrim(u.email) <> ''
     group by u.id, u.email, p.display_name
  ),
  people as (
    select coalesce(t.k, l.k) as k,
           coalesce(t.email, l.login_email) as em,
           t.id as tid, t.name as tname, t.role as trole, t.active as tactive,
           l.uid, l.display_name as lname, coalesce(l.sroles, '{}'::text[]) as sroles,
           coalesce(l.is_client, false) as is_client
      from team t
      full join logins l on l.k = t.k
     where t.id is not null or cardinality(l.sroles) > 0
  ),
  scored as (
    select pp.*,
           m.verdanote_role::text as mrole,
           coalesce(m.needs_owner_decision, false) as mflag,
           (select si.id from public.staff_invites si
             where si.status = 'prepared' and lower(btrim(si.email)) = pp.k limit 1) as inv,
           case
             when pp.tid is not null and pp.uid is null then (
               select string_agg(coalesce(l2.display_name, '') || ' <' || l2.login_email || '>', '; ' order by l2.login_email)
                 from logins l2
                where l2.k <> pp.k
                  and l2.display_name is not null
                  and lower(btrim(l2.display_name)) = lower(btrim(pp.tname)))
             when pp.tid is null and pp.uid is not null and pp.lname is not null then (
               select string_agg(t2.name || ' <' || t2.email || '>', '; ' order by t2.email)
                 from team t2
                where t2.k <> pp.k
                  and lower(btrim(t2.name)) = lower(btrim(pp.lname)))
           end as pmatch
      from people pp
      left join public.staff_role_mappings m on m.dashboard_role = pp.trole
  )
  select s.em, s.tid, s.tname, s.trole, s.tactive, s.uid, s.lname, s.sroles, s.is_client,
         s.mrole, s.mflag, s.inv, s.pmatch,
         array_remove(array[
           case when s.tid is not null and s.tactive and s.uid is null then 'no_login' end,
           case when s.tid is not null and s.uid is not null and s.is_client then 'client_login' end,
           case when s.tid is not null and s.tactive and s.uid is not null and not s.is_client
                     and cardinality(s.sroles) = 0 then 'no_staff_role' end,
           case when s.tid is not null and s.tactive and cardinality(s.sroles) > 0 and s.mrole is not null
                     and s.sroles <> array[s.mrole] then 'role_differs' end,
           case when s.tid is not null and s.tactive and s.mflag then 'mapping_needs_owner' end,
           case when s.tid is not null and not s.tactive and cardinality(s.sroles) > 0 then 'inactive_with_staff_role' end,
           case when s.tid is null and cardinality(s.sroles) > 0 then 'not_on_team_list' end,
           case when s.pmatch is not null then 'possible_name_match' end
         ]::text[], null::text) as issues
    from scored s
   order by s.k;
end;
$$;

-- ------------------------------------------------------------------ checked functions

create or replace function public.set_staff_role_mapping(
  p_dashboard_role text,
  p_verdanote_role text,
  p_needs_owner_decision boolean,
  p_note text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_before public.staff_role_mappings%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can change the role mapping' using errcode = '42501';
  end if;
  select * into v_before from public.staff_role_mappings where dashboard_role = p_dashboard_role for update;
  if not found then
    raise exception 'no mapping for dashboard role %', p_dashboard_role using errcode = 'P0002';
  end if;
  if p_verdanote_role is null or p_verdanote_role not in ('builder', 'employee') then
    raise exception 'a dashboard role maps to builder or employee' using errcode = '22023';
  end if;
  if p_needs_owner_decision is null then
    raise exception 'say whether the mapping still needs the owner' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'the note is longer than 500 characters' using errcode = '22023';
  end if;

  update public.staff_role_mappings
     set verdanote_role = p_verdanote_role::public.app_role,
         needs_owner_decision = p_needs_owner_decision,
         note = v_note,
         updated_by = auth.uid(),
         updated_at = now()
   where dashboard_role = p_dashboard_role;

  insert into public.staff_admin_events (kind, subject, detail, actor_id)
  values ('mapping_changed', p_dashboard_role,
          jsonb_build_object('before', jsonb_build_object('role', v_before.verdanote_role, 'needs_owner_decision', v_before.needs_owner_decision),
                             'after', jsonb_build_object('role', p_verdanote_role, 'needs_owner_decision', p_needs_owner_decision)),
          auth.uid());
end;
$$;

create or replace function public.prepare_staff_invite(p_team_member_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_member public.app_users%rowtype;
  v_map public.staff_role_mappings%rowtype;
  v_id uuid;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can prepare invites' using errcode = '42501';
  end if;
  select * into v_member from public.app_users where id = p_team_member_id;
  if not found then
    raise exception 'no such team member' using errcode = 'P0002';
  end if;
  if not v_member.active then
    raise exception 'a deactivated team member is not invited' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users u where lower(btrim(u.email)) = lower(btrim(v_member.email))) then
    raise exception 'this person already has a Verdanote login' using errcode = '22023';
  end if;
  select * into v_map from public.staff_role_mappings where dashboard_role = v_member.role;
  if not found then
    raise exception 'no mapping for dashboard role %', v_member.role using errcode = '22023';
  end if;

  select id into v_id from public.staff_invites
   where status = 'prepared' and lower(btrim(email)) = lower(btrim(v_member.email));
  if v_id is not null then
    return v_id;
  end if;

  insert into public.staff_invites (team_member_id, email, name, proposed_role, mapping_flagged, prepared_by)
  values (v_member.id, btrim(v_member.email), btrim(v_member.name), v_map.verdanote_role, v_map.needs_owner_decision, auth.uid())
  returning id into v_id;

  insert into public.staff_admin_events (kind, subject, detail, actor_id)
  values ('invite_prepared', btrim(v_member.email),
          jsonb_build_object('invite_id', v_id, 'proposed_role', v_map.verdanote_role, 'mapping_flagged', v_map.needs_owner_decision),
          auth.uid());
  return v_id;
end;
$$;

create or replace function public.cancel_staff_invite(p_invite_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_inv public.staff_invites%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can cancel invites' using errcode = '42501';
  end if;
  select * into v_inv from public.staff_invites where id = p_invite_id for update;
  if not found then
    raise exception 'no such invite' using errcode = 'P0002';
  end if;
  if v_inv.status <> 'prepared' then
    raise exception 'the invite is already cancelled' using errcode = '22023';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'give a reason of 3 to 500 characters' using errcode = '22023';
  end if;
  update public.staff_invites
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
   where id = p_invite_id;
  insert into public.staff_admin_events (kind, subject, detail, actor_id)
  values ('invite_cancelled', v_inv.email, jsonb_build_object('invite_id', p_invite_id, 'reason', v_reason), auth.uid());
end;
$$;

create or replace function public.add_login_to_team_list(p_user_id uuid, p_name text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text;
  v_display text;
  v_staff text;
  v_dash text;
  v_name text;
  v_id uuid;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can change the team list' using errcode = '42501';
  end if;
  select btrim(u.email), p.display_name into v_email, v_display
    from auth.users u left join public.profiles p on p.user_id = u.id
   where u.id = p_user_id;
  if v_email is null then
    raise exception 'no such login' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.user_roles where user_id = p_user_id and role = 'client') then
    raise exception 'a client login does not go on the team list' using errcode = '22023';
  end if;
  select case when bool_or(role = 'builder') then 'builder' when bool_or(role = 'employee') then 'employee' end
    into v_staff from public.user_roles where user_id = p_user_id;
  if v_staff is null then
    raise exception 'only a login with a staff role goes on the team list' using errcode = '22023';
  end if;
  if exists (select 1 from public.app_users where lower(btrim(email)) = lower(v_email)) then
    raise exception 'this email is already on the team list' using errcode = '23505';
  end if;
  -- The dashboard role recorded is the one the mapping turns into the login's role.
  select dashboard_role into v_dash from public.staff_role_mappings
   where verdanote_role::text = v_staff and not needs_owner_decision
   order by dashboard_role limit 1;
  if v_dash is null then
    raise exception 'no settled mapping gives the role %', v_staff using errcode = '22023';
  end if;
  v_name := btrim(coalesce(nullif(btrim(coalesce(p_name, '')), ''), nullif(btrim(coalesce(v_display, '')), ''), split_part(v_email, '@', 1)));
  if length(v_name) < 1 or length(v_name) > 120 then
    raise exception 'a name of 1 to 120 characters is needed' using errcode = '22023';
  end if;

  insert into public.app_users (name, email, role, active) values (v_name, v_email, v_dash, true)
  returning id into v_id;
  insert into public.staff_admin_events (kind, subject, detail, actor_id)
  values ('team_member_added', v_email, jsonb_build_object('team_member_id', v_id, 'dashboard_role', v_dash, 'user_id', p_user_id), auth.uid());
  return v_id;
end;
$$;

create or replace function public.update_team_member(
  p_team_member_id uuid,
  p_name text,
  p_dashboard_role text,
  p_active boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_before public.app_users%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_caller_email text;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can change the team list' using errcode = '42501';
  end if;
  select * into v_before from public.app_users where id = p_team_member_id for update;
  if not found then
    raise exception 'no such team member' using errcode = 'P0002';
  end if;
  if length(v_name) < 1 or length(v_name) > 120 then
    raise exception 'a name of 1 to 120 characters is needed' using errcode = '22023';
  end if;
  if p_dashboard_role is null or p_dashboard_role not in ('admin', 'producer', 'viewer') then
    raise exception 'the dashboard role is admin, producer or viewer' using errcode = '22023';
  end if;
  if p_active is null then
    raise exception 'say whether the team member is active' using errcode = '22023';
  end if;
  select btrim(email) into v_caller_email from auth.users where id = auth.uid();
  if not p_active and v_before.active and lower(btrim(v_before.email)) = lower(coalesce(v_caller_email, '')) then
    raise exception 'you cannot deactivate yourself' using errcode = '22023';
  end if;

  update public.app_users
     set name = v_name, role = p_dashboard_role, active = p_active
   where id = p_team_member_id;
  insert into public.staff_admin_events (kind, subject, detail, actor_id)
  values ('team_member_updated', v_before.email,
          jsonb_build_object('before', jsonb_build_object('name', v_before.name, 'role', v_before.role, 'active', v_before.active),
                             'after', jsonb_build_object('name', v_name, 'role', p_dashboard_role, 'active', p_active)),
          auth.uid());
end;
$$;

create or replace function public.set_staff_role(p_user_id uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text;
  v_before text[];
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can change staff roles' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('builder', 'employee') then
    raise exception 'a staff role is builder or employee' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'you cannot change your own role' using errcode = '42501';
  end if;
  select btrim(email) into v_email from auth.users where id = p_user_id;
  if v_email is null then
    raise exception 'no such login' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.user_roles where user_id = p_user_id and role = 'client') then
    raise exception 'this is a client login; change it by hand after checking who it is' using errcode = '22023';
  end if;
  select coalesce(array_agg(role::text order by role::text), '{}') into v_before
    from public.user_roles where user_id = p_user_id;

  delete from public.user_roles
   where user_id = p_user_id and role in ('builder', 'employee') and role::text <> p_role;
  insert into public.user_roles (user_id, role) values (p_user_id, p_role::public.app_role)
  on conflict (user_id, role) do nothing;

  insert into public.staff_admin_events (kind, subject, detail, actor_id)
  values ('staff_role_set', v_email, jsonb_build_object('user_id', p_user_id, 'before', v_before, 'after', p_role), auth.uid());
end;
$$;

revoke all on function public.staff_reconciliation() from public, anon, authenticated;
revoke all on function public.set_staff_role_mapping(text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.prepare_staff_invite(uuid) from public, anon, authenticated;
revoke all on function public.cancel_staff_invite(uuid, text) from public, anon, authenticated;
revoke all on function public.add_login_to_team_list(uuid, text) from public, anon, authenticated;
revoke all on function public.update_team_member(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.set_staff_role(uuid, text) from public, anon, authenticated;

grant execute on function public.staff_reconciliation() to authenticated, service_role;
grant execute on function public.set_staff_role_mapping(text, text, boolean, text) to authenticated, service_role;
grant execute on function public.prepare_staff_invite(uuid) to authenticated, service_role;
grant execute on function public.cancel_staff_invite(uuid, text) to authenticated, service_role;
grant execute on function public.add_login_to_team_list(uuid, text) to authenticated, service_role;
grant execute on function public.update_team_member(uuid, text, text, boolean) to authenticated, service_role;
grant execute on function public.set_staff_role(uuid, text) to authenticated, service_role;
