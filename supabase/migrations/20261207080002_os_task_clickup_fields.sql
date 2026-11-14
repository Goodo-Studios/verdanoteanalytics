-- Goodo OS: the task modal shows and edits everything ClickUp holds for a task.
--
-- Additive only. Nothing is dropped or rewritten except two CHECK constraints and one index on
-- os_clickup_outbox, each replaced by a wider version of itself (no row changes).
--
-- os_tasks gets the ClickUp data that was not stored yet:
--   description_markdown  ClickUp's markdown description (the brief text). description stays the
--                         plain text form. The modal edits the markdown and keeps both in step.
--   priority              urgent, high, normal or low.
--   start_date            ClickUp's start date.
--   clickup_tags          tag names (read only in the app).
--   clickup_created_at    when the task was created in ClickUp.
--   clickup_creator       who created it: {id, username, email}.
--   time_estimate_ms      ClickUp's time estimate in milliseconds.
--   clickup_fields        every custom field of the task as an array of
--                         {id, name, type, display, options?}. display is the canonical text of the
--                         value (drop-down option name, YYYY-MM-DD, "true"/"false", text, number).
--                         Written by the ClickUp sync and webhook (service role) and by
--                         os_set_task_field() for one field at a time.
-- Staff only: clients read no os_tasks row, and os_client_task_cards() keeps its own column list, so none
-- of these columns reaches a client.
--
-- os_set_task_field(task, field id, value): staff edit one ClickUp custom field. It checks the field
-- is on the task and of an editable type (text, url, email, phone, number, currency, date,
-- drop-down, checkbox), checks the value for that type, stores it in clickup_fields and in the column
-- that mirrors the field (content_type, asset_url, brief_type, hooks, the six workflow dates). It runs
-- as the caller, so the row rules of os_tasks and the read-only guard decide who may edit what.
--
-- Write-back (OS-017, still off by default): the outbox accepts four more kinds. A change made in the
-- app to description, priority, start_date or a custom field is queued like status and due date; a
-- write by the ClickUp sync is never queued. Fields: description, priority, start_date and
-- "cf:<ClickUp custom field id>". Nothing here turns write-back on.

-- ------------------------------------------------------------------ os_tasks columns

alter table public.os_tasks
  add column description_markdown text,
  add column priority text check (priority is null or priority in ('urgent', 'high', 'normal', 'low')),
  add column start_date date,
  add column clickup_tags jsonb not null default '[]'::jsonb check (jsonb_typeof(clickup_tags) = 'array'),
  add column clickup_created_at timestamptz,
  add column clickup_creator jsonb check (clickup_creator is null or jsonb_typeof(clickup_creator) = 'object'),
  add column time_estimate_ms bigint check (time_estimate_ms is null or time_estimate_ms > 0),
  add column clickup_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(clickup_fields) = 'array');

comment on column public.os_tasks.clickup_fields is
  'Every ClickUp custom field of the task: [{id, name, type, display, options?}]. Synced from ClickUp; edited with os_set_task_field().';

-- ------------------------------------------------------------------ outbox: more kinds

alter table public.os_clickup_outbox drop constraint os_clickup_outbox_kind_check;
alter table public.os_clickup_outbox add constraint os_clickup_outbox_kind_check
  check (kind in ('status', 'assignees', 'due_date', 'description', 'priority', 'start_date', 'custom_field', 'comment', 'decision'));

alter table public.os_clickup_outbox drop constraint os_clickup_outbox_field_fits_kind;
alter table public.os_clickup_outbox add constraint os_clickup_outbox_field_fits_kind check (
  (kind = 'assignees' and field in ('strategist', 'producer', 'editor'))
  or (kind = 'custom_field' and field ~ '^cf:.+')
  or (kind not in ('assignees', 'custom_field') and field = kind));

drop index public.os_clickup_outbox_one_queued_field_idx;
create unique index os_clickup_outbox_one_queued_field_idx on public.os_clickup_outbox (task_id, field)
  where state = 'queued'
    and kind in ('status', 'assignees', 'due_date', 'description', 'priority', 'start_date', 'custom_field');

-- ------------------------------------------------------------------ queue the new fields

create or replace function public.os_clickup_queue_task_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb;
  v_old jsonb;
begin
  if not public.os_clickup_is_app_change() or new.clickup_task_id is null or new.read_only or old.read_only then
    return null;
  end if;
  if new.status is distinct from old.status then
    perform public.os_clickup_queue_field(new, 'status', 'status', old.status, new.status);
  end if;
  if new.due_date is distinct from old.due_date then
    perform public.os_clickup_queue_field(new, 'due_date', 'due_date', old.due_date::text, new.due_date::text);
  end if;
  if new.strategist_id is distinct from old.strategist_id then
    perform public.os_clickup_queue_field(new, 'assignees', 'strategist', old.strategist_id::text, new.strategist_id::text);
  end if;
  if new.producer_id is distinct from old.producer_id then
    perform public.os_clickup_queue_field(new, 'assignees', 'producer', old.producer_id::text, new.producer_id::text);
  end if;
  if new.editor_id is distinct from old.editor_id then
    perform public.os_clickup_queue_field(new, 'assignees', 'editor', old.editor_id::text, new.editor_id::text);
  end if;
  if coalesce(new.description_markdown, new.description) is distinct from coalesce(old.description_markdown, old.description) then
    perform public.os_clickup_queue_field(new, 'description', 'description',
      coalesce(old.description_markdown, old.description), coalesce(new.description_markdown, new.description));
  end if;
  if new.priority is distinct from old.priority then
    perform public.os_clickup_queue_field(new, 'priority', 'priority', old.priority, new.priority);
  end if;
  if new.start_date is distinct from old.start_date then
    perform public.os_clickup_queue_field(new, 'start_date', 'start_date', old.start_date::text, new.start_date::text);
  end if;
  if new.clickup_fields is distinct from old.clickup_fields then
    for v_new in select e.value from jsonb_array_elements(new.clickup_fields) as e(value) loop
      select o.value into v_old from jsonb_array_elements(old.clickup_fields) as o(value)
       where o.value ->> 'id' = v_new ->> 'id' limit 1;
      if v_old is not null and (v_new ->> 'display') is distinct from (v_old ->> 'display') then
        perform public.os_clickup_queue_field(new, 'custom_field', 'cf:' || (v_new ->> 'id'), v_old ->> 'display', v_new ->> 'display');
      end if;
      v_old := null;
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function public.os_clickup_queue_task_change() from public, anon, authenticated;

drop trigger os_clickup_queue_task_change on public.os_tasks;
create trigger os_clickup_queue_task_change
  after update of status, due_date, strategist_id, producer_id, editor_id,
                  description, description_markdown, priority, start_date, clickup_fields
  on public.os_tasks
  for each row execute function public.os_clickup_queue_task_change();

-- ------------------------------------------------------------------ edit one custom field

create or replace function public.os_set_task_field(p_task_id uuid, p_field_id text, p_value text)
returns void
language plpgsql
set search_path = public
as $$
declare
  c_hook1 constant text := '0c49e3b4-6081-4294-9fc6-59f461a0da30';
  c_hook2 constant text := '6a1c6c8f-4565-4075-8f57-fbc34b503096';
  v_task public.os_tasks;
  v_entry jsonb;
  v_type text;
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
  v_display text;
  v_entries jsonb;
  v_hooks text[];
  v_date date;
begin
  select * into v_task from public.os_tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_task.read_only then
    raise exception 'this task is read-only history from ClickUp' using errcode = '42501';
  end if;

  select e.value into v_entry from jsonb_array_elements(v_task.clickup_fields) as e(value)
   where e.value ->> 'id' = p_field_id limit 1;
  if v_entry is null then
    raise exception 'this task has no such ClickUp field' using errcode = 'P0002';
  end if;
  v_type := v_entry ->> 'type';
  if v_type not in ('short_text', 'text', 'url', 'email', 'phone', 'number', 'currency', 'date', 'drop_down', 'checkbox') then
    raise exception 'a % field cannot be edited here', v_type using errcode = '22023';
  end if;

  if v_type = 'checkbox' then
    if v_value is not null and lower(v_value) not in ('true', 'false') then
      raise exception '% is not true or false', v_value using errcode = '22023';
    end if;
    v_display := coalesce(lower(v_value), 'false');
  elsif v_value is not null then
    if v_type = 'drop_down' then
      select o.value ->> 'name' into v_display
        from jsonb_array_elements(coalesce(v_entry -> 'options', '[]'::jsonb)) as o(value)
       where lower(o.value ->> 'name') = lower(v_value) limit 1;
      if v_display is null then
        raise exception '% is not a choice of this field', v_value using errcode = '22023';
      end if;
    elsif v_type = 'date' then
      if v_value !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception '% is not a date (use YYYY-MM-DD)', v_value using errcode = '22023';
      end if;
      begin
        v_display := (v_value::date)::text;
      exception when others then
        raise exception '% is not a date (use YYYY-MM-DD)', v_value using errcode = '22023';
      end;
    elsif v_type in ('number', 'currency') then
      begin
        v_display := trim_scale(v_value::numeric)::text;
      exception when others then
        raise exception '% is not a number', v_value using errcode = '22023';
      end;
    elsif v_type = 'url' then
      if v_value !~* '^https?://\S+$' then
        raise exception 'the link must start with http:// or https://' using errcode = '22023';
      end if;
      v_display := v_value;
    else
      v_display := v_value;
    end if;
  end if;

  -- The asset link column only holds http(s) links.
  if p_field_id = '43b89e72-8575-49e6-bf6a-fc90f373291c' and v_display is not null and v_display !~* '^https?://\S+$' then
    raise exception 'the link must start with http:// or https://' using errcode = '22023';
  end if;

  if v_type = 'date' and v_display is not null then
    v_date := v_display::date;
  end if;

  select coalesce(jsonb_agg(
           case when e.value ->> 'id' = p_field_id then e.value || jsonb_build_object('display', v_display) else e.value end
           order by e.ord), '[]'::jsonb)
    into v_entries
    from jsonb_array_elements(v_task.clickup_fields) with ordinality as e(value, ord);

  select coalesce(array_agg(e.value ->> 'display' order by (e.value ->> 'id' = c_hook2)), '{}'::text[])
    into v_hooks
    from jsonb_array_elements(v_entries) as e(value)
   where e.value ->> 'id' in (c_hook1, c_hook2) and nullif(e.value ->> 'display', '') is not null;

  update public.os_tasks set
    clickup_fields = v_entries,
    content_type = case when p_field_id = 'f58bc404-0076-4b16-8950-1fce77e04b2a' then v_display else content_type end,
    asset_url = case when p_field_id = '43b89e72-8575-49e6-bf6a-fc90f373291c' then v_display else asset_url end,
    brief_type = case when p_field_id = '3e648b5f-3a26-431a-b66d-af2045aea09f' then v_display else brief_type end,
    brief_due_date = case when p_field_id = '91bf5fcc-9265-4c23-86b2-ce160074f2aa' then v_date else brief_due_date end,
    cut_to_strategist_date = case when p_field_id = '7e861db2-ba22-404f-9cfa-9b5e46a97e57' then v_date else cut_to_strategist_date end,
    cut_to_client_date = case when p_field_id = '255abb81-9c9f-494a-aef1-6a12b548beb5' then v_date else cut_to_client_date end,
    edit_due_date = case when p_field_id = '004366be-af82-4c83-8ca6-cb40ba19d561' then v_date else edit_due_date end,
    production_date = case when p_field_id = '5ffd8b36-aef5-45eb-907b-cdac4413b771' then v_date else production_date end,
    brief_handed_off_date = case when p_field_id = 'f37e2dc8-8fd4-452d-ae8c-62efc69ed9f1' then v_date else brief_handed_off_date end,
    hooks = case when p_field_id in (c_hook1, c_hook2) then v_hooks else hooks end
   where id = p_task_id;
end;
$$;

revoke all on function public.os_set_task_field(uuid, text, text) from public, anon;
grant execute on function public.os_set_task_field(uuid, text, text) to authenticated, service_role;
