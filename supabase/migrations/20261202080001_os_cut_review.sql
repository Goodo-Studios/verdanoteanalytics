-- Goodo OS story OS-020: cut review inside the task.
--
-- A task gets numbered versions (cuts). Each version is a link to the cut (https only). Staff add a
-- version; adding one is the "new cut" event. Comments can be bound to a version and carry a
-- timecode in milliseconds. The internal / client thread split from OS-008 is unchanged.
--
--   os_task_versions               id, task_id, version_no (1, 2, 3 per task), video_url, label,
--                                  created_by, created_at. Staff read it directly. Clients read no
--                                  row directly; they use os_client_task_versions().
--   os_task_comments.version_id    the version a comment is about (null: a general task comment).
--   os_task_comments.timecode_ms   the moment in the cut, in milliseconds (null: the whole cut).
--
--   os_add_task_version(task, url, label)
--       staff only. Numbers the version after the last one on the task. Refuses read-only tasks.
--   os_client_task_versions(task)
--       a client's own client's visible task, only in the Client Review or Ready to Launch stage.
--       Returns id, version_no, label, video_url, created_at, newest first. Anyone else: nothing.
--   post_task_version_comment(version, thread, body, timecode_ms)
--       the same rules as post_task_comment (it calls it), plus: a client only on a version they
--       can see through os_client_task_versions. The comment is then bound to the version.
--   list_task_version_comments(version)
--       staff: both threads. A client: only the client thread, only on a version they can see.
--       Sorted by timecode (the whole-cut comments last), then by time posted.
--   list_task_comments(task)
--       now returns only general comments (no version), so cut comments are not listed twice.
--       Same signature and rules as before.
--
-- Why inside Verdanote and not the goodo-video-review app: that app runs on one Mac, listens on
-- loopback only, keeps its data in SQLite and has its own logins. It has no hosted copy and no
-- sign-in Verdanote could hand over, so a client cannot reach it. Its ideas (comments bound to one
-- exact cut, General versus timed notes, clicking a note seeks the player) are reused here.
--
-- Tests: supabase/tests/os_cut_review_test.sql.

-- ------------------------------------------------------------------ versions

create table public.os_task_versions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.os_tasks(id) on delete cascade,
  version_no integer not null check (version_no >= 1),
  video_url text not null check (video_url ~* '^https://[^[:space:]]+$' and length(video_url) <= 2000),
  label text check (label is null or length(btrim(label)) between 1 and 120),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint os_task_versions_task_no_key unique (task_id, version_no)
);

comment on table public.os_task_versions is
  'Cuts of an os_tasks row (OS-020). Written by os_add_task_version. Staff read; clients use os_client_task_versions().';

alter table public.os_task_versions enable row level security;
revoke all on table public.os_task_versions from public, anon, authenticated;
grant select on table public.os_task_versions to authenticated;
grant all on table public.os_task_versions to service_role;

create policy "Staff can read os_task_versions" on public.os_task_versions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- ------------------------------------------------------------------ comment columns

alter table public.os_task_comments
  add column version_id uuid references public.os_task_versions(id) on delete cascade,
  add column timecode_ms integer check (timecode_ms is null or timecode_ms >= 0);

alter table public.os_task_comments
  add constraint os_task_comments_timecode_needs_version check (timecode_ms is null or version_id is not null);

create index os_task_comments_version_idx on public.os_task_comments (version_id, timecode_ms) where version_id is not null;

-- ------------------------------------------------------------------ helper (internal)

-- Whether the caller is a client who may see this task's cuts: their own client's visible task in
-- Client Review or Ready to Launch. Not callable from the browser.
create or replace function public.os_client_can_see_cuts(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.os_tasks t
      join public.os_task_statuses s on s.status = t.status
     where t.id = p_task_id
       and public.has_role(auth.uid(), 'client'::public.app_role)
       and t.client_slug is not null
       and t.client_slug in (select public.get_user_client_slugs())
       and (t.clickup_list_id is null or t.is_asset)
       and s.stage in ('Client Review', 'Ready to Launch')
  );
$$;

revoke all on function public.os_client_can_see_cuts(uuid) from public, anon, authenticated;
grant execute on function public.os_client_can_see_cuts(uuid) to service_role;

-- ------------------------------------------------------------------ add a version

create or replace function public.os_add_task_version(p_task_id uuid, p_video_url text, p_label text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_url text := btrim(coalesce(p_video_url, ''));
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_task public.os_tasks%rowtype;
  v_row public.os_task_versions%rowtype;
begin
  if v_uid is null
     or not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can add a version' using errcode = '42501';
  end if;
  if v_url !~* '^https://[^[:space:]]+$' or length(v_url) > 2000 then
    raise exception 'the link must start with https://' using errcode = '22023';
  end if;
  if v_label is not null and length(v_label) > 120 then
    raise exception 'the label is longer than 120 characters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('os_add_task_version:' || coalesce(p_task_id::text, '')));

  select * into v_task from public.os_tasks where id = p_task_id;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_task.read_only then
    raise exception 'this task is read-only history from ClickUp' using errcode = '42501';
  end if;

  insert into public.os_task_versions (task_id, version_no, video_url, label, created_by)
  values (
    p_task_id,
    coalesce((select max(version_no) from public.os_task_versions where task_id = p_task_id), 0) + 1,
    v_url, v_label, v_uid
  )
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'task_id', v_row.task_id, 'version_no', v_row.version_no,
                            'video_url', v_row.video_url, 'label', v_row.label, 'created_at', v_row.created_at);
end;
$$;

revoke all on function public.os_add_task_version(uuid, text, text) from public, anon;
grant execute on function public.os_add_task_version(uuid, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------ client read of versions

create or replace function public.os_client_task_versions(p_task_id uuid)
returns table (id uuid, version_no integer, label text, video_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.version_no, v.label, v.video_url, v.created_at
    from public.os_task_versions v
   where v.task_id = p_task_id
     and public.os_client_can_see_cuts(p_task_id)
   order by v.version_no desc;
$$;

revoke all on function public.os_client_task_versions(uuid) from public, anon;
grant execute on function public.os_client_task_versions(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ post a cut comment

create or replace function public.post_task_version_comment(
  p_version_id uuid,
  p_thread text,
  p_body text,
  p_timecode_ms integer default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_task_id uuid;
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'sign in to comment' using errcode = '42501';
  end if;
  if p_timecode_ms is not null and (p_timecode_ms < 0 or p_timecode_ms > 86400000) then
    raise exception 'the timecode is out of range' using errcode = '22023';
  end if;

  select task_id into v_task_id from public.os_task_versions where id = p_version_id;
  if v_task_id is null then
    raise exception 'version not found' using errcode = '42501';
  end if;

  if not public.os_is_staff(v_uid) and not public.os_client_can_see_cuts(v_task_id) then
    raise exception 'you cannot comment here' using errcode = '42501';
  end if;

  -- The thread, body, client and read-only rules are post_task_comment's.
  v_id := public.post_task_comment(v_task_id, p_thread, p_body, '{}'::uuid[]);

  update public.os_task_comments
     set version_id = p_version_id, timecode_ms = p_timecode_ms
   where id = v_id;

  return v_id;
end;
$$;

revoke all on function public.post_task_version_comment(uuid, text, text, integer) from public, anon;
grant execute on function public.post_task_version_comment(uuid, text, text, integer) to authenticated, service_role;

-- ------------------------------------------------------------------ list cut comments

create or replace function public.list_task_version_comments(p_version_id uuid)
returns table (
  id bigint,
  version_id uuid,
  thread text,
  body text,
  author_user_id uuid,
  author jsonb,
  timecode_ms integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.version_id, c.thread, c.body, c.author_user_id, c.author, c.timecode_ms, c.created_at
    from public.os_task_comments c
    join public.os_task_versions v on v.id = c.version_id
   where c.version_id = p_version_id
     and (
       public.os_is_staff(auth.uid())
       or (c.thread = 'client' and public.os_client_can_see_cuts(v.task_id))
     )
   order by c.timecode_ms nulls last, c.created_at, c.id;
$$;

revoke all on function public.list_task_version_comments(uuid) from public, anon;
grant execute on function public.list_task_version_comments(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ general comments only

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
     and c.version_id is null
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
