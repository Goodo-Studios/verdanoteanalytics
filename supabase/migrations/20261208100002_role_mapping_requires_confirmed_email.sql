-- Role mapping by email now needs a confirmed email.
--
-- The three role mapping functions below match a team list or Goodo OS row to a Verdanote login
-- by email alone. If sign-up does not require confirming the address, anyone can register
-- someone else's work address and receive that person's builder or employee role the next time
-- the mapping runs. Each join now also requires auth.users.email_confirmed_at to be set. An
-- unconfirmed login is treated as having no login yet (no_login in the Goodo OS plan, no
-- verdanote_user_id in the preview).
--
-- Signatures, language, volatility, security and search_path are the same as the definitions
-- they replace (20261101000006, 20261116070001, 20261109000004). CREATE OR REPLACE keeps the
-- existing grants, and they are restated below so the file does not depend on that.

-- Preview for staff (from 20261101000006).
create or replace function public.app_user_role_mapping()
returns table (
  app_user_id uuid,
  email text,
  dashboard_role text,
  active boolean,
  verdanote_role public.app_role,
  verdanote_user_id uuid,
  has_role_already boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_role(auth.uid(), 'builder'::public.app_role)
    or public.has_role(auth.uid(), 'employee'::public.app_role)
  ) then
    raise exception 'only staff can read the role mapping'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select au.id,
         au.email,
         au.role,
         au.active,
         public.dashboard_role_to_verdanote_role(au.role),
         u.id,
         exists (
           select 1 from public.user_roles ur
           where ur.user_id = u.id
             and ur.role = public.dashboard_role_to_verdanote_role(au.role)
         )
  from public.app_users au
  left join auth.users u
    on lower(u.email) = lower(au.email)
   and u.email_confirmed_at is not null
  order by au.email;
end;
$$;
revoke all on function public.app_user_role_mapping() from public, anon, authenticated;
grant execute on function public.app_user_role_mapping() to authenticated;

-- Apply step (from 20261116070001).
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
                   and u.email_confirmed_at is not null
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

-- Goodo OS plan (from 20261109000004). Internal: nobody holds execute, it is reached through the
-- two definer functions that wrap it.
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
                            and u.email_confirmed_at is not null
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
revoke all on function public.goodo_os_user_role_plan() from public, anon, authenticated, service_role;
