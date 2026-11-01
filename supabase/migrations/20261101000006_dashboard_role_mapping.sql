-- Dashboard data foundation 6/6: dashboard roles to Verdanote roles
--
-- The old dashboard keeps roles in app_users.role. Verdanote keeps them in
-- user_roles. The mapping is:
--
--   admin    -> builder
--   producer -> employee
--   viewer   -> no Verdanote role (Verdanote has no read-only staff role; the
--               consolidation plan recommends giving viewers access another way)
--
-- Logins are separate pools, so people are matched by email. Nothing here runs
-- on its own: apply_app_user_role_mapping() has to be called, and only the
-- service role can call it. It adds roles for active, mapped people who already
-- have a Verdanote login. It never removes a role and never creates a login.

create or replace function public.dashboard_role_to_verdanote_role(p_role text)
returns public.app_role
language sql
immutable
set search_path = public
as $$
  select case p_role
    when 'admin' then 'builder'::public.app_role
    when 'producer' then 'employee'::public.app_role
    else null
  end;
$$;

-- What the mapping would do for each copied dashboard team member.
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
  left join auth.users u on lower(u.email) = lower(au.email)
  order by au.email;
end;
$$;

-- Adds the mapped role for every active dashboard user who already has a
-- Verdanote login. Returns the number of roles added.
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
  join auth.users u on lower(u.email) = lower(au.email)
  where au.active
    and public.dashboard_role_to_verdanote_role(au.role) is not null
  on conflict (user_id, role) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

revoke all on function public.dashboard_role_to_verdanote_role(text) from public, anon, authenticated;
grant execute on function public.dashboard_role_to_verdanote_role(text) to authenticated;

revoke all on function public.app_user_role_mapping() from public, anon, authenticated;
grant execute on function public.app_user_role_mapping() to authenticated;

revoke all on function public.apply_app_user_role_mapping() from public, anon, authenticated;
grant execute on function public.apply_app_user_role_mapping() to service_role;
