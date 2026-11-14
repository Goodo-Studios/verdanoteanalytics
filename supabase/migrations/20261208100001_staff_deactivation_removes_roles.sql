-- Deactivating a team member now removes their staff access.
--
-- Until now app_users.active only decided who appears in owner dropdowns and who the
-- application reviewer is. Every staff function and row rule checks has_role(auth.uid(),
-- 'builder' or 'employee'), which reads user_roles, so clearing app_users.active on the Team
-- page left the login fully able to read and write.
--
-- Why a trigger on app_users and not a check inside has_role: has_role is used by well over a
-- hundred policies and functions, and it only knows a user id. Finding the team list row means
-- matching on the login email, and a person can change the email on their own login, which
-- would silently step out of an email-based deny. Removing the role row is not bypassable that
-- way, it takes effect on the next request for every caller (row rules, SECURITY DEFINER
-- functions and edge functions all go through user_roles), and it uses the table the existing
-- reconciliation already reasons about ("inactive_with_staff_role").
--
-- Deactivation (active true to false): delete the builder and employee roles of the login whose
-- email matches the team list row (trimmed, case ignored, the rule the rest of the staff code
-- uses), unless another active team list row has the same email. The client role is never
-- touched here.
--
-- Reactivation (active false to true): give back the mapped staff role through the same mapping
-- as apply_app_user_role_mapping() (staff_role_mappings via dashboard_role_to_verdanote_role),
-- only to a login with a confirmed email and no client role. A viewer maps to client and so
-- gets nothing back here. Existing roles are never changed.
--
-- Only UPDATEs of active fire it. Inserting a row that is already inactive changes nothing, so
-- the reconciliation still reports a login that holds a staff role with no active team entry.

create or replace function public.sync_staff_roles_on_team_active_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_key text := lower(btrim(new.email));
  v_role public.app_role;
begin
  if new.active is not distinct from old.active then
    return new;
  end if;

  if not new.active then
    if exists (
      select 1 from public.app_users o
       where o.id <> new.id and o.active and lower(btrim(o.email)) = v_key
    ) then
      return new;
    end if;
    delete from public.user_roles ur
     using auth.users u
     where ur.user_id = u.id
       and lower(btrim(u.email)) = v_key
       and ur.role in ('builder', 'employee');
  else
    v_role := public.dashboard_role_to_verdanote_role(new.role);
    if v_role in ('builder', 'employee') then
      insert into public.user_roles (user_id, role)
      select u.id, v_role
        from auth.users u
       where lower(btrim(u.email)) = v_key
         and u.email_confirmed_at is not null
         and not exists (select 1 from public.user_roles c where c.user_id = u.id and c.role = 'client')
      on conflict (user_id, role) do nothing;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_staff_roles_on_team_active_change() from public, anon, authenticated;

drop trigger if exists app_users_sync_staff_roles on public.app_users;
create trigger app_users_sync_staff_roles
  after update of active on public.app_users
  for each row
  execute function public.sync_staff_roles_on_team_active_change();

comment on function public.sync_staff_roles_on_team_active_change() is
  'Deactivating a team list member removes the builder and employee roles of the login with the same email; reactivating gives back the mapped staff role (confirmed email, no client role). Fires on UPDATE of app_users.active only.';
