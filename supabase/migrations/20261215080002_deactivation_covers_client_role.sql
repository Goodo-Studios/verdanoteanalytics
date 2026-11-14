-- Deactivating a viewer on the team list now also removes the client role.
--
-- Migration 20261208100001 removed the builder and employee roles when a team list member was
-- deactivated and left the client role alone. A team list member whose dashboard role is viewer
-- maps to the client role (20261116070001), so deactivating that person left their login with
-- client access. Same trigger, same rules, now also:
--
--   deactivation of a viewer row: delete the client role of the login with the same email (unless
--       another active row has that email). Their client links (client_members, user_accounts) stay,
--       so reactivating restores the same access.
--   reactivation of a viewer row: give the client role back to a login with a confirmed email that
--       holds no builder or employee role. Existing roles are never changed.
--
-- Staff rows (admin, producer and other staff roles) behave exactly as before and never lose a client
-- role here. Test: supabase/tests/staff_deactivation_and_confirmed_email_test.sql.

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
       and (ur.role in ('builder', 'employee') or (new.role = 'viewer' and ur.role = 'client'));
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
    elsif v_role = 'client' then
      insert into public.user_roles (user_id, role)
      select u.id, v_role
        from auth.users u
       where lower(btrim(u.email)) = v_key
         and u.email_confirmed_at is not null
         and not exists (select 1 from public.user_roles s where s.user_id = u.id and s.role in ('builder', 'employee'))
      on conflict (user_id, role) do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_staff_roles_on_team_active_change() from public, anon, authenticated;

comment on function public.sync_staff_roles_on_team_active_change() is
  'Deactivating a team list member removes the builder and employee roles of the login with the same email, and the client role for a viewer; reactivating gives back the mapped role (confirmed email, no conflicting role). Fires on UPDATE of app_users.active only.';
