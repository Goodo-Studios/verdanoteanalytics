-- Client view, phase 5b: approve and request changes, by the client, inside Verdanote.
--
-- Owner decision 2026-11-10: approvals and change requests happen in Verdanote, made by the client.
--
-- Why a new table and not engagement_deliverable_decisions (migration 20261110120002): that model
-- hangs decisions on an engagement deliverable revision and is staff only ("clients read nothing").
-- The cards a client sees come from ClickUp (pipeline_tasks, pipeline_delivered) and are not linked to
-- an engagement deliverable, so there is no revision to attach a decision to. This table keeps the
-- same meaning (decision is approved or changes_requested, history is never rewritten) on the ClickUp
-- task instead.
--
--   client_task_decisions   one row per decision. The current decision of a task is the row with
--                           superseded_at null (one at most, enforced by a unique index). A client
--                           who changes their mind while the card is still in Client Review adds a
--                           new row and the old one gets superseded_at; nothing is deleted or edited
--                           otherwise. Written only by record_client_decision (service role, called
--                           by the client-decision edge function).
--
-- Who reads what: staff read every row; a client reads the rows of its own clients (get_user_client_slugs),
-- with every column except decided_by (the login id, kept for staff and the service role). A client
-- sees who decided as a plain label ("Alex"), set by the function.
--
-- Write-back to ClickUp is NOT built here. Each decision also enqueues a durable job of kind
-- clickup.decision_writeback (migration 20261109000005). Nothing claims that kind: no worker exists
-- and the outbound switch 'clickup_writeback' has no row, so it is off (migration 20261109000006:
-- off when the row is missing). A later change can post a ClickUp comment and move the task status
-- from those jobs, behind that switch. A superseded decision cancels its queued job.
--
-- Tests: supabase/tests/client_task_decisions_test.sql.

create table public.client_task_decisions (
  id uuid primary key default gen_random_uuid(),
  clickup_task_id text not null check (length(clickup_task_id) between 1 and 64),
  client_slug text not null references public.clients(slug) on delete cascade,
  task_name text,
  decision text not null check (decision in ('approved', 'changes_requested')),
  note text check (note is null or length(btrim(note)) between 1 and 1000),
  decided_by uuid not null,
  decided_by_label text not null check (length(btrim(decided_by_label)) between 1 and 120),
  decided_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint client_task_decisions_note_matches_decision
    check ((decision = 'changes_requested') = (note is not null))
);

create unique index client_task_decisions_current_idx
  on public.client_task_decisions (clickup_task_id) where superseded_at is null;
create index client_task_decisions_client_idx on public.client_task_decisions (client_slug, decided_at desc);
create index client_task_decisions_rate_idx on public.client_task_decisions (decided_by, clickup_task_id, decided_at);

comment on table public.client_task_decisions is
  'Client approvals and change requests on ClickUp cards. Append-only history; the current one has superseded_at null. Written by record_client_decision only. Staff read all; a client reads its own clients, without decided_by.';

-- History rule: rows are never deleted, and the only change allowed is setting superseded_at once.
create or replace function public.guard_client_task_decisions()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.superseded_at is null and new.superseded_at is not null
     and (new.id, new.clickup_task_id, new.client_slug, new.task_name, new.decision, new.note,
          new.decided_by, new.decided_by_label, new.decided_at)
         is not distinct from
         (old.id, old.clickup_task_id, old.client_slug, old.task_name, old.decision, old.note,
          old.decided_by, old.decided_by_label, old.decided_at) then
    return new;
  end if;
  raise exception 'client decision history is append-only' using errcode = '23514';
end;
$$;
revoke all on function public.guard_client_task_decisions() from public, anon, authenticated;

create trigger client_task_decisions_guard before update or delete on public.client_task_decisions
  for each row execute function public.guard_client_task_decisions();
create trigger client_task_decisions_no_truncate before truncate on public.client_task_decisions
  for each statement execute function public.guard_client_task_decisions();

-- ------------------------------------------------------------------ grants and row rules

alter table public.client_task_decisions enable row level security;
revoke all on table public.client_task_decisions from public, anon, authenticated;
grant select (id, clickup_task_id, client_slug, task_name, decision, note, decided_by_label, decided_at, superseded_at)
  on public.client_task_decisions to authenticated;
grant all on table public.client_task_decisions to service_role;

create policy "Builder/employee can read client_task_decisions" on public.client_task_decisions
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Client can view own client_task_decisions" on public.client_task_decisions
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'client'::public.app_role)
    and client_slug in (select public.get_user_client_slugs())
  );

-- ------------------------------------------------------------------ record a decision

-- Called by the client-decision edge function with the service role, after it has checked who the
-- caller is. p_allowed_slugs is the caller's own clients (get_user_client_slugs, read with the
-- caller's token); a task of any other client answers "not found", the same as a task that does not
-- exist. Returns {status, id, decision, decided_at}; status is 'recorded' or 'unchanged'.
--
-- Rules:
--   a card in Client Review accepts either decision, and a client may change an earlier decision
--     while the card is still there;
--   delivered work (Ready to Launch) with no decision yet accepts "approved" once, and is then closed;
--   a card in any other stage accepts nothing;
--   the same decision with the same note as the current one changes nothing (idempotent);
--   more than 5 decisions by one person on one card in 10 minutes is refused (rate limit).
-- Errors: P0002 not found, P0409 not open for a decision, P0429 too many, 22023 bad input.
create or replace function public.record_client_decision(
  p_user_id uuid,
  p_label text,
  p_allowed_slugs text[],
  p_task_id text,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_name text;
  v_stage text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_cur public.client_task_decisions;
  v_new public.client_task_decisions;
  v_recent integer;
begin
  if p_user_id is null or p_label is null or length(btrim(p_label)) not between 1 and 120 then
    raise exception 'a decision needs a person and a label' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('approved', 'changes_requested') then
    raise exception 'decision must be approved or changes_requested' using errcode = '22023';
  end if;
  if p_task_id is null or length(p_task_id) not between 1 and 64 then
    raise exception 'task id must be 1 to 64 characters' using errcode = '22023';
  end if;
  if p_decision = 'changes_requested' and (v_note is null or length(v_note) > 1000) then
    raise exception 'a change request needs a note of 1 to 1000 characters' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    v_note := null;
  end if;

  select t.client_slug, t.task_name, t.stage into v_slug, v_name, v_stage
    from public.pipeline_tasks t where t.clickup_task_id = p_task_id;
  if v_slug is null then
    select d.client_slug, d.task_name, 'Ready to Launch' into v_slug, v_name, v_stage
      from public.pipeline_delivered d where d.clickup_task_id = p_task_id;
  end if;
  if v_slug is null or not (v_slug = any (coalesce(p_allowed_slugs, '{}'::text[]))) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtext('client_task_decision:' || p_task_id));

  select * into v_cur from public.client_task_decisions
   where clickup_task_id = p_task_id and superseded_at is null;

  if v_cur.id is not null and v_cur.decision = p_decision and v_cur.note is not distinct from v_note then
    return jsonb_build_object('status', 'unchanged', 'id', v_cur.id, 'decision', v_cur.decision, 'decided_at', v_cur.decided_at);
  end if;

  if v_stage = 'Client Review' then
    null;
  elsif v_stage = 'Ready to Launch' and v_cur.id is null and p_decision = 'approved' then
    null;
  else
    raise exception 'this asset is not open for a decision' using errcode = 'P0409';
  end if;

  select count(*) into v_recent from public.client_task_decisions
   where decided_by = p_user_id and clickup_task_id = p_task_id and decided_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'too many decisions on this asset, try again in a few minutes' using errcode = 'P0429';
  end if;

  if v_cur.id is not null then
    update public.client_task_decisions set superseded_at = now() where id = v_cur.id;
    perform public.cancel_job(j.id, 'superseded by a newer client decision')
       from public.durable_jobs j
      where j.dedupe_key = 'clickup-decision:' || v_cur.id::text and j.state = 'queued';
  end if;

  insert into public.client_task_decisions (clickup_task_id, client_slug, task_name, decision, note, decided_by, decided_by_label)
  values (p_task_id, v_slug, v_name, p_decision, v_note, p_user_id, btrim(p_label))
  returning * into v_new;

  -- Durable, unsent. No worker claims this kind and the outbound switch 'clickup_writeback' has no row.
  perform public.enqueue_job(
    'clickup.decision_writeback',
    'clickup-decision:' || v_new.id::text,
    jsonb_build_object('decision_id', v_new.id, 'clickup_task_id', p_task_id, 'decision', p_decision, 'note', v_note),
    v_slug, null, now(), 3);

  return jsonb_build_object('status', 'recorded', 'id', v_new.id, 'decision', v_new.decision, 'decided_at', v_new.decided_at);
end;
$$;

revoke all on function public.record_client_decision(uuid, text, text[], text, text, text) from public, anon, authenticated;
grant execute on function public.record_client_decision(uuid, text, text[], text, text, text) to service_role;
