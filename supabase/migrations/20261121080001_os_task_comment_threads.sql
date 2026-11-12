-- Goodo OS story OS-008: comments with an internal thread and a client thread.
--
--   os_task_comments.thread           'internal' or 'client'. Default 'internal'. A ClickUp comment
--                                     (clickup_comment_id set) is always internal (check constraint),
--                                     so the sync keeps landing in the internal thread.
--   os_task_comments.author_user_id   the login that posted in the app (null for ClickUp rows).
--   os_task_comments.mentions         logins mentioned in the comment.
--   os_task_comments.clickup_comment_id  now nullable: app comments have none (still unique).
--   notifications.task_id/comment_id  the existing in-app notifications table gets a link to the
--                                     task and comment; a mention writes one row per mentioned
--                                     person (type 'mention'), never for the author.
--
--   post_task_comment(task, thread, body, mentions)
--       staff (builder, employee): any thread on any task.
--       client: only the client thread, only on their own client's task that they can see through
--       os_client_tasks (has a client, app task or ClickUp asset task).
--       Nobody posts on a read_only task (ending client history).
--       Body is trimmed, must not be empty, at most 10000 characters.
--       Mentions: a client may mention staff and members of the same client. Staff may mention
--       staff, and members of the task's client only in the client thread. Anyone else: refused.
--   list_task_comments(task)
--       staff: both threads. client: the client thread of a task they can see. Anyone else: nothing.
--
-- Row rules are unchanged: staff read the table directly, clients read no row directly, and no
-- signed-in user writes it directly (writes go through post_task_comment).

-- ------------------------------------------------------------------ columns

alter table public.os_task_comments alter column clickup_comment_id drop not null;

alter table public.os_task_comments
  add column thread text not null default 'internal' check (thread in ('internal', 'client')),
  add column author_user_id uuid references auth.users(id) on delete set null,
  add column mentions uuid[] not null default '{}';

alter table public.os_task_comments
  add constraint os_task_comments_clickup_is_internal check (clickup_comment_id is null or thread = 'internal');

alter table public.os_task_comments alter column created_at set default now();

create index os_task_comments_task_thread_idx on public.os_task_comments (task_id, thread, created_at);

comment on table public.os_task_comments is
  'Comments of os_tasks rows. ClickUp comments (OS-007) are internal; app comments (OS-008) use post_task_comment. Staff read; clients use list_task_comments.';

alter table public.notifications
  add column if not exists task_id uuid references public.os_tasks(id) on delete cascade,
  add column if not exists comment_id bigint references public.os_task_comments(id) on delete cascade;

-- Owner-only through the existing "Users see own notifications" policy. Make the grants explicit:
-- no anon, signed-in users read and mark their own rows read.
revoke all on table public.notifications from public, anon;
grant select, update on table public.notifications to authenticated;
grant all on table public.notifications to service_role;

-- ------------------------------------------------------------------ helpers (internal)

create or replace function public.os_is_staff(p_user uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.has_role(p_user, 'builder'::public.app_role) or public.has_role(p_user, 'employee'::public.app_role);
$$;

revoke all on function public.os_is_staff(uuid) from public, anon;
grant execute on function public.os_is_staff(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ post

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

  -- Staff may always be mentioned. Members of the task's client may be mentioned in the client
  -- thread (a client only posts there). Anyone else is refused.
  select m into v_bad
    from unnest(v_mentions) m
   where not public.os_is_staff(m)
     and not (
       p_thread = 'client'
       and v_task.client_slug is not null
       and public.has_role(m, 'client'::public.app_role)
       and exists (select 1 from public.client_members cm where cm.user_id = m and cm.client_slug = v_task.client_slug)
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

-- ------------------------------------------------------------------ list

create or replace function public.list_task_comments(p_task_id uuid)
returns table (
  id bigint,
  task_id uuid,
  thread text,
  body text,
  author_user_id uuid,
  author jsonb,
  mentions uuid[],
  created_at timestamptz,
  from_clickup boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.task_id, c.thread, c.body, c.author_user_id, c.author, c.mentions, c.created_at,
         c.clickup_comment_id is not null
    from public.os_task_comments c
    join public.os_tasks t on t.id = c.task_id
   where c.task_id = p_task_id
     and (
       public.has_role(auth.uid(), 'builder'::public.app_role)
       or public.has_role(auth.uid(), 'employee'::public.app_role)
       or (
         c.thread = 'client'
         and public.has_role(auth.uid(), 'client'::public.app_role)
         and t.client_slug is not null
         and t.client_slug in (select public.get_user_client_slugs())
         and (t.clickup_list_id is null or t.is_asset)
       )
     )
   order by c.created_at nulls first, c.id;
$$;

revoke all on function public.list_task_comments(uuid) from public, anon;
grant execute on function public.list_task_comments(uuid) to authenticated, service_role;
