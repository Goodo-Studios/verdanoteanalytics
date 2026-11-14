-- Hardening: has_role, get_user_role and get_user_account_ids answer only for the caller.
--
-- All three take any user id and every signed-in user could execute them, so a client could read
-- another user's roles and account links by UUID. For a browser caller (the request's role claim is
-- authenticated or anon) they now answer for the caller's own id only: has_role false, get_user_role
-- null and get_user_account_ids empty for any other id. Nothing changes for the service role, for
-- direct database connections and cron (no role claim), or for anything that passes auth.uid(), which
-- covers every row rule and function that calls them in this repository except the mention checks
-- below. The request's role claim is signed, so a browser cannot present another one.
--
-- The mention checks look at OTHER people on purpose, inside SECURITY DEFINER functions that run for a
-- signed-in caller (the claims still say authenticated there). They move to internal copies that no
-- browser role can execute: _has_role_internal, _get_user_role_internal, _get_user_account_ids_internal
-- and os_is_staff_internal. post_task_comment and os_user_client_slugs now call those. os_is_staff keeps
-- its signature and now inherits the guard, so for another user it answers false to a browser caller.
--
-- Signatures, language, volatility, security and search_path of the three public functions are as
-- before (get_user_role keeps the deterministic order of 20261207090001); their grants are unchanged
-- because CREATE OR REPLACE keeps them. Tests: supabase/tests/role_helpers_own_data_test.sql and the
-- existing os_task_comment_threads_test.sql, which proves mentions still work.

-- ------------------------------------------------------------------ internal copies (no browser access)

create or replace function public._has_role_internal(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public._get_user_role_internal(_user_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_roles
  where user_id = _user_id
  order by
    case role::text when 'builder' then 0 when 'employee' then 1 else 2 end,
    role::text
  limit 1
$$;

create or replace function public._get_user_account_ids_internal(_user_id uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select account_id from public.user_accounts where user_id = _user_id
$$;

create or replace function public.os_is_staff_internal(p_user uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select public._has_role_internal(p_user, 'builder'::public.app_role) or public._has_role_internal(p_user, 'employee'::public.app_role);
$$;

revoke all on function public._has_role_internal(uuid, public.app_role) from public, anon, authenticated;
revoke all on function public._get_user_role_internal(uuid) from public, anon, authenticated;
revoke all on function public._get_user_account_ids_internal(uuid) from public, anon, authenticated;
revoke all on function public.os_is_staff_internal(uuid) from public, anon, authenticated;
grant execute on function public._has_role_internal(uuid, public.app_role) to service_role;
grant execute on function public._get_user_role_internal(uuid) to service_role;
grant execute on function public._get_user_account_ids_internal(uuid) to service_role;
grant execute on function public.os_is_staff_internal(uuid) to service_role;

-- ------------------------------------------------------------------ the mention checks use them

create or replace function public.os_user_client_slugs(p_user uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select ca.client_slug
    from public.client_ad_accounts ca
   where ca.account_id in (select public._get_user_account_ids_internal(p_user))
  union
  select cm.client_slug
    from public.client_members cm
   where cm.user_id = p_user
$$;

-- Same body as 20261121080002, except that the people being mentioned are checked through the
-- internal helpers.
create or replace function public.post_task_comment(
  p_task_id uuid,
  p_thread text,
  p_body text,
  p_mentions uuid[] default '{}'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_staff boolean;
  v_task public.os_tasks%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_mentions uuid[];
  v_bad uuid;
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'sign in to comment' using errcode = '42501';
  end if;
  v_staff := public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role);

  if p_thread is null or p_thread not in ('internal', 'client') then
    raise exception 'thread must be internal or client' using errcode = '22023';
  end if;
  if v_body = '' then
    raise exception 'comment is empty' using errcode = '22023';
  end if;
  if length(v_body) > 10000 then
    raise exception 'comment is longer than 10000 characters' using errcode = '22023';
  end if;

  select * into v_task from public.os_tasks where id = p_task_id;
  if not found then
    raise exception 'task not found' using errcode = '42501';
  end if;

  if not v_staff then
    if not public.has_role(auth.uid(), 'client'::public.app_role)
       or p_thread <> 'client'
       or v_task.client_slug is null
       or v_task.client_slug not in (select public.get_user_client_slugs())
       or not (v_task.clickup_list_id is null or v_task.is_asset) then
      raise exception 'you cannot comment here' using errcode = '42501';
    end if;
  end if;

  if v_task.read_only then
    raise exception 'this task is read-only history from ClickUp' using errcode = '42501';
  end if;

  -- Unique mentions, without the author.
  select coalesce(array_agg(distinct m), '{}') into v_mentions
    from unnest(coalesce(p_mentions, '{}')) m
   where m is not null and m <> v_uid;

  -- Staff may always be mentioned. People of the task's client (linked by ad account or by
  -- membership) may be mentioned in the client thread. Anyone else is refused.
  select m into v_bad
    from unnest(v_mentions) m
   where not public.os_is_staff_internal(m)
     and not (
       p_thread = 'client'
       and v_task.client_slug is not null
       and public._has_role_internal(m, 'client'::public.app_role)
       and v_task.client_slug in (select public.os_user_client_slugs(m))
     )
   limit 1;
  if v_bad is not null then
    raise exception 'that person cannot be mentioned here' using errcode = '22023';
  end if;

  insert into public.os_task_comments (task_id, thread, body, author_user_id, mentions, author, created_at)
  values (p_task_id, p_thread, v_body, v_uid, v_mentions, '{}'::jsonb, now())
  returning id into v_id;

  insert into public.notifications (user_id, title, body, type, task_id, comment_id)
  select m, 'You were mentioned on ' || v_task.title, left(v_body, 280), 'mention', p_task_id, v_id
    from unnest(v_mentions) m;

  return v_id;
end;
$$;

revoke all on function public.post_task_comment(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.post_task_comment(uuid, text, text, uuid[]) to authenticated, service_role;

-- ------------------------------------------------------------------ the guard on the public three

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.role() in ('authenticated', 'anon') and _user_id is distinct from auth.uid() then false
    else exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
  end
$$;

create or replace function public.get_user_role(_user_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.role() in ('authenticated', 'anon') and _user_id is distinct from auth.uid() then null::public.app_role
    else (
      select role from public.user_roles
      where user_id = _user_id
      order by
        case role::text when 'builder' then 0 when 'employee' then 1 else 2 end,
        role::text
      limit 1)
  end
$$;

create or replace function public.get_user_account_ids(_user_id uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select account_id from public.user_accounts
  where user_id = _user_id
    and (coalesce(auth.role(), '') not in ('authenticated', 'anon') or _user_id is not distinct from auth.uid())
$$;
