-- Roles: two kinds of people (owner decision 2, Matthew, 2026-11-11).
--
-- Anyone who works at Goodo Studios is an employee: the old dashboard's producer, editor and
-- any similar staff role become `employee`, and builders stay builders. Anyone who is a client
-- is the viewer, which in Verdanote is the `client` role. An old-dashboard `viewer` account
-- therefore maps to `client`. No new role value is created.
--
--   staff_role_mappings  viewer now maps to client and nothing waits on the owner any more: the
--                        "needs_owner_decision" flag (and staff_invites.mapping_flagged) is gone.
--   dashboard_role_to_verdanote_role
--                        admin -> builder, viewer -> client, every other staff role -> employee.
--   staff_reconciliation()
--                        no more "mapping waits on the owner". A viewer whose login is a client
--                        login is expected. A viewer client login with no linked client reports
--                        `no_client_linked` ("No client linked yet", fixed on the client Setup tab).
--   set_staff_role_mapping(role, role, note)
--                        the flag argument is gone. admin and producer map to builder or employee;
--                        viewer maps to client.
--   set_staff_role       also sets `client`, for a login that has no role yet (never on a login
--                        that holds a staff role).
--   prepare_staff_invite refuses a viewer: a client login is made from the client's Setup tab.
--   apply_app_user_role_mapping
--                        never gives a staff role to a client login, and never gives the client
--                        role to a staff login.
--
-- Everything else of migration 20261111040001 is unchanged. Still builder only, still checked
-- inside each function body, still nothing sent.

-- ------------------------------------------------------------------ the mapping as data

alter table public.staff_role_mappings drop constraint if exists staff_role_mappings_verdanote_role_check;
alter table public.staff_role_mappings
  add constraint staff_role_mappings_verdanote_role_check check (verdanote_role in ('builder', 'employee', 'client'));

alter table public.staff_role_mappings drop column needs_owner_decision;
alter table public.staff_invites drop column mapping_flagged;

update public.staff_role_mappings
   set verdanote_role = 'client',
       note = 'Owner decision 2026-11-11: a viewer is a client. Link the login to its client on the client Setup tab.',
       updated_at = now()
 where dashboard_role = 'viewer';
update public.staff_role_mappings
   set note = 'Owner decision 2026-11-11: everyone who works at Goodo Studios is an employee.',
       updated_at = now()
 where dashboard_role = 'producer';

alter table public.staff_role_mappings
  add constraint staff_role_mappings_viewer_is_client_check
  check ((dashboard_role = 'viewer') = (verdanote_role = 'client'));

comment on table public.staff_role_mappings is 'Dashboard role to Verdanote role mapping (step 5d, owner decision 2026-11-11): admin to builder, producer (and any other staff role) to employee, viewer to client. Staff read; builders change through set_staff_role_mapping.';

-- admin and viewer come from the table; any other staff role is an employee. The table is read
-- under the caller's row rules, so a known role that cannot be read (a client) gets null, never
-- the fallback.
create or replace function public.dashboard_role_to_verdanote_role(p_role text)
returns public.app_role
language sql
stable
set search_path = public
as $$
  select case
    when p_role in ('admin', 'producer', 'viewer') then
      (select m.verdanote_role from public.staff_role_mappings m where m.dashboard_role = p_role)
    when btrim(coalesce(p_role, '')) <> '' then 'employee'::public.app_role
  end;
$$;
revoke all on function public.dashboard_role_to_verdanote_role(text) from public, anon, authenticated;
grant execute on function public.dashboard_role_to_verdanote_role(text) to authenticated;

-- Adds the mapped role for every active team list member who already has a login and no role
-- that conflicts with it. Service role only. Never removes a role, never creates a login.
-- (Called a client login a conflict for a staff role, and now a staff login a conflict for the
-- client role.)
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
    and not exists (
      select 1 from public.user_roles c
       where c.user_id = u.id
         and ((public.dashboard_role_to_verdanote_role(au.role) = 'client'::public.app_role and c.role in ('builder', 'employee'))
              or (public.dashboard_role_to_verdanote_role(au.role) <> 'client'::public.app_role and c.role = 'client')))
  on conflict (user_id, role) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;
revoke all on function public.apply_app_user_role_mapping() from public, anon, authenticated;
grant execute on function public.apply_app_user_role_mapping() to service_role;

-- ------------------------------------------------------------------ reconciliation

-- Issues (empty when everything lines up):
--   no_login                  active on the team list, no Verdanote login with that email
--   client_login              on the team list as staff, but the login with that email is a client
--   no_staff_role             active on the team list, login has no role at all
--   role_differs              active on the team list, the login's staff roles are not exactly
--                             the mapped role (for a viewer: the login holds a staff role)
--   no_client_linked          a viewer whose login is a client login with no client linked yet
--   inactive_with_staff_role  deactivated on the team list, login still holds a staff role
--   not_on_team_list          staff login with no team list row
--   possible_name_match       same name as someone under a different email; never merged
drop function public.staff_reconciliation();
create function public.staff_reconciliation()
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
  client_linked boolean,
  mapped_role text,
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
           coalesce(bool_or(ur.role = 'client'), false) as is_client,
           (exists (select 1 from public.client_members cm where cm.user_id = u.id)
            or exists (select 1
                         from public.user_accounts ua
                         join public.client_ad_accounts ca on ca.account_id = ua.account_id
                        where ua.user_id = u.id)) as linked
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
           coalesce(l.is_client, false) as is_client,
           coalesce(l.linked, false) as linked
      from team t
      full join logins l on l.k = t.k
     where t.id is not null or cardinality(l.sroles) > 0
  ),
  scored as (
    select pp.*,
           public.dashboard_role_to_verdanote_role(pp.trole)::text as mrole,
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
  )
  select s.em, s.tid, s.tname, s.trole, s.tactive, s.uid, s.lname, s.sroles, s.is_client, s.linked,
         s.mrole, s.inv, s.pmatch,
         array_remove(array[
           case when s.tid is not null and s.tactive and s.uid is null then 'no_login' end,
           case when s.tid is not null and s.uid is not null and s.is_client and coalesce(s.mrole, '') <> 'client' then 'client_login' end,
           case when s.tid is not null and s.tactive and s.uid is not null and not s.is_client
                     and cardinality(s.sroles) = 0 then 'no_staff_role' end,
           case when s.tid is not null and s.tactive and s.mrole is not null and cardinality(s.sroles) > 0
                     and (s.mrole = 'client' or s.sroles <> array[s.mrole]) then 'role_differs' end,
           case when s.tid is not null and s.tactive and s.mrole = 'client' and s.uid is not null
                     and s.is_client and not s.linked then 'no_client_linked' end,
           case when s.tid is not null and not s.tactive and cardinality(s.sroles) > 0 then 'inactive_with_staff_role' end,
           case when s.tid is null and cardinality(s.sroles) > 0 then 'not_on_team_list' end,
           case when s.pmatch is not null then 'possible_name_match' end
         ]::text[], null::text) as issues
    from scored s
   order by s.k;
end;
$$;
revoke all on function public.staff_reconciliation() from public, anon, authenticated;
grant execute on function public.staff_reconciliation() to authenticated, service_role;

-- ------------------------------------------------------------------ checked functions

drop function public.set_staff_role_mapping(text, text, boolean, text);
create function public.set_staff_role_mapping(
  p_dashboard_role text,
  p_verdanote_role text,
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
  if p_verdanote_role is null or p_verdanote_role not in ('builder', 'employee', 'client') then
    raise exception 'a dashboard role maps to builder, employee or client' using errcode = '22023';
  end if;
  if (p_dashboard_role = 'viewer') <> (p_verdanote_role = 'client') then
    raise exception 'a viewer maps to client, and staff roles map to builder or employee' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'the note is longer than 500 characters' using errcode = '22023';
  end if;

  update public.staff_role_mappings
     set verdanote_role = p_verdanote_role::public.app_role,
         note = v_note,
         updated_by = auth.uid(),
         updated_at = now()
   where dashboard_role = p_dashboard_role;

  insert into public.staff_admin_events (kind, subject, detail, actor_id)
  values ('mapping_changed', p_dashboard_role,
          jsonb_build_object('before', jsonb_build_object('role', v_before.verdanote_role),
                             'after', jsonb_build_object('role', p_verdanote_role)),
          auth.uid());
end;
$$;
revoke all on function public.set_staff_role_mapping(text, text, text) from public, anon, authenticated;
grant execute on function public.set_staff_role_mapping(text, text, text) to authenticated, service_role;

create or replace function public.prepare_staff_invite(p_team_member_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_member public.app_users%rowtype;
  v_role public.app_role;
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
  v_role := public.dashboard_role_to_verdanote_role(v_member.role);
  if v_role is null then
    raise exception 'no mapping for dashboard role %', v_member.role using errcode = '22023';
  end if;
  if v_role = 'client' then
    raise exception 'a client login is made from the client Setup tab, not from the staff list' using errcode = '22023';
  end if;

  select id into v_id from public.staff_invites
   where status = 'prepared' and lower(btrim(email)) = lower(btrim(v_member.email));
  if v_id is not null then
    return v_id;
  end if;

  insert into public.staff_invites (team_member_id, email, name, proposed_role, prepared_by)
  values (v_member.id, btrim(v_member.email), btrim(v_member.name), v_role, auth.uid())
  returning id into v_id;

  insert into public.staff_admin_events (kind, subject, detail, actor_id)
  values ('invite_prepared', btrim(v_member.email),
          jsonb_build_object('invite_id', v_id, 'proposed_role', v_role),
          auth.uid());
  return v_id;
end;
$$;
revoke all on function public.prepare_staff_invite(uuid) from public, anon, authenticated;
grant execute on function public.prepare_staff_invite(uuid) to authenticated, service_role;

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
   where verdanote_role::text = v_staff
   order by dashboard_role limit 1;
  if v_dash is null then
    raise exception 'no mapping gives the role %', v_staff using errcode = '22023';
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
revoke all on function public.add_login_to_team_list(uuid, text) from public, anon, authenticated;
grant execute on function public.add_login_to_team_list(uuid, text) to authenticated, service_role;

-- builder, employee, or client. client is only for a login with no staff role; a staff login that
-- should become a client is changed by hand after checking who it is.
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
    raise exception 'only a builder can change roles' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('builder', 'employee', 'client') then
    raise exception 'a role is builder, employee or client' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'you cannot change your own role' using errcode = '42501';
  end if;
  select btrim(email) into v_email from auth.users where id = p_user_id;
  if v_email is null then
    raise exception 'no such login' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(role::text order by role::text), '{}') into v_before
    from public.user_roles where user_id = p_user_id;

  if p_role = 'client' then
    if exists (select 1 from public.user_roles where user_id = p_user_id and role in ('builder', 'employee')) then
      raise exception 'this login holds a staff role; change it by hand after checking who it is' using errcode = '22023';
    end if;
    insert into public.user_roles (user_id, role) values (p_user_id, 'client'::public.app_role)
    on conflict (user_id, role) do nothing;
  else
    if exists (select 1 from public.user_roles where user_id = p_user_id and role = 'client') then
      raise exception 'this is a client login; change it by hand after checking who it is' using errcode = '22023';
    end if;
    delete from public.user_roles
     where user_id = p_user_id and role in ('builder', 'employee') and role::text <> p_role;
    insert into public.user_roles (user_id, role) values (p_user_id, p_role::public.app_role)
    on conflict (user_id, role) do nothing;
  end if;

  insert into public.staff_admin_events (kind, subject, detail, actor_id)
  values ('staff_role_set', v_email, jsonb_build_object('user_id', p_user_id, 'before', v_before, 'after', p_role), auth.uid());
end;
$$;
revoke all on function public.set_staff_role(uuid, text) from public, anon, authenticated;
grant execute on function public.set_staff_role(uuid, text) to authenticated, service_role;
