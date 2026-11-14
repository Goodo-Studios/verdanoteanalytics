-- Phase 4, PR 1: set a client up without a developer.
--
-- Linking a client to ad accounts (client_ad_accounts) and to a ClickUp folder
-- (source_mappings) already works through the staff row rules of migration
-- 20261109000004; the new Setup tab writes those two tables directly. Client logins
-- (client_members) need the login's email, which lives in auth.users and is not readable
-- from the browser, so the three functions below do that part. A fourth gives the Setup
-- checklist for every client in one call.
--
--   client_setup_status()               staff: per client, how many ad accounts, ClickUp
--                                       folders and client logins are linked, and when the
--                                       board last synced
--   list_client_members(slug)           builder: the logins linked to one client
--   add_client_member(slug, email)      builder: link an existing client login
--   remove_client_member(slug, user)    builder: unlink a login
--
-- Each function tests the caller's role in its own body before it looks at any argument.
-- A client holds no grant on anything new: no table is added. Tests:
-- supabase/tests/client_setup_test.sql.

create or replace function public.client_setup_status()
returns table (
  client_slug text,
  ad_account_count integer,
  clickup_folder_count integer,
  member_count integer,
  last_clickup_sync timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role)
          or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can read the client setup status' using errcode = '42501';
  end if;

  return query
  select c.slug,
         (select count(*)::integer from public.client_ad_accounts a where a.client_slug = c.slug),
         (select count(*)::integer from public.source_mappings m
           where m.client_slug = c.slug and m.provider = 'clickup' and m.kind = 'folder' and m.active),
         (select count(*)::integer from public.client_members cm where cm.client_slug = c.slug),
         (select max(t.synced_at) from public.pipeline_tasks t where t.client_slug = c.slug)
    from public.clients c
   order by c.slug;
end;
$$;

create or replace function public.list_client_members(p_slug text)
returns table (
  user_id uuid,
  email text,
  display_name text,
  added_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can see a client''s logins' using errcode = '42501';
  end if;

  return query
  select cm.user_id, u.email::text, p.display_name, cm.created_at
    from public.client_members cm
    join auth.users u on u.id = cm.user_id
    left join public.profiles p on p.user_id = cm.user_id
   where cm.client_slug = p_slug
   order by lower(u.email::text);
end;
$$;

create or replace function public.add_client_member(p_slug text, p_email text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid;
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can link a client login' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients where slug = p_slug) then
    raise exception 'We could not find that client.' using errcode = 'P0002';
  end if;
  if length(v_email) < 3 or length(v_email) > 320 or position('@' in v_email) < 2 then
    raise exception 'Enter the email the client logs in with.' using errcode = '22023';
  end if;

  select u.id into v_user from auth.users u where lower(btrim(u.email)) = v_email limit 1;
  if v_user is null then
    raise exception 'There is no login with that email yet. Create the login first, then link it here.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.user_roles ur where ur.user_id = v_user and ur.role in ('builder', 'employee')) then
    raise exception 'That is a staff login. Staff see every client already, so there is nothing to link.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.user_roles ur where ur.user_id = v_user and ur.role = 'client') then
    raise exception 'That login is not a client login yet. Give it the client role first.' using errcode = '22023';
  end if;
  if exists (select 1 from public.client_members cm where cm.user_id = v_user and cm.client_slug = p_slug) then
    raise exception 'That login is already linked to this client.' using errcode = '23505';
  end if;

  insert into public.client_members (user_id, client_slug) values (v_user, p_slug);
  return v_user;
end;
$$;

create or replace function public.remove_client_member(p_slug text, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'builder'::public.app_role) then
    raise exception 'only a builder can unlink a client login' using errcode = '42501';
  end if;
  delete from public.client_members where client_slug = p_slug and user_id = p_user_id;
  if not found then
    raise exception 'That login is not linked to this client.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.client_setup_status() from public, anon, authenticated;
revoke all on function public.list_client_members(text) from public, anon, authenticated;
revoke all on function public.add_client_member(text, text) from public, anon, authenticated;
revoke all on function public.remove_client_member(text, uuid) from public, anon, authenticated;
grant execute on function public.client_setup_status() to authenticated, service_role;
grant execute on function public.list_client_members(text) to authenticated, service_role;
grant execute on function public.add_client_member(text, text) to authenticated, service_role;
grant execute on function public.remove_client_member(text, uuid) to authenticated, service_role;
