-- OS-008 fix: a client login linked to its client through an ad account (not a client_members
-- row) could not be mentioned in the client thread. Found on staging: client-a reaches its
-- client only through client_ad_accounts. Mentions now use the same membership rule as
-- get_user_client_slugs(): ad accounts the user is linked to, plus client_members rows.

create or replace function public.os_user_client_slugs(p_user uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select ca.client_slug
    from public.client_ad_accounts ca
   where ca.account_id in (select public.get_user_account_ids(p_user))
  union
  select cm.client_slug
    from public.client_members cm
   where cm.user_id = p_user
$$;

-- Internal helper for post_task_comment only; not callable from the browser.
revoke all on function public.os_user_client_slugs(uuid) from public, anon, authenticated;
grant execute on function public.os_user_client_slugs(uuid) to service_role;

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
   where not public.os_is_staff(m)
     and not (
       p_thread = 'client'
       and v_task.client_slug is not null
       and public.has_role(m, 'client'::public.app_role)
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
