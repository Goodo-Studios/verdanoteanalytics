-- Goodo OS wave A: meeting recaps (consolidation step 4a). Port of Goodo OS
-- migration 053_meeting_recaps.sql, US-086.
--
-- A staff member names one Fireflies transcript and a client. The meeting-recaps
-- edge function reads the transcript (clean excerpts only: personnel, legal and
-- financial excerpts are withheld and never sent to the model), asks the model for
-- decisions, open questions and action items, keeps only candidates whose every
-- citation is an exact span of a supplied excerpt (supabase/functions/_shared/
-- meeting-recaps.ts), and records the outcome here in one call to
-- record_meeting_recap (service role only).
--
--   meeting_recaps         one row per prepare request, written once with its
--                          outcome: prepared, unavailable (transcript missing, no
--                          access, still processing), quarantined (every excerpt
--                          withheld) or failed (the model call failed).
--   meeting_recap_items    the accepted candidates, with the cited quotes.
--   meeting_recap_reviews  one human decision per item (confirmed or rejected),
--                          against the item's exact hash. Questions are not
--                          reviewed; they stay open.
--
-- All three are append-only history and staff only (builder or employee). Clients
-- read nothing. Not ported from Goodo OS: transcript authorization records, the
-- AI evaluation gate, the durable agent job and the ClickUp sync of a confirmed
-- action (Verdanote has no ClickUp task-action path; a confirmed action keeps its
-- proposed action as a record only). Tests: supabase/tests/meeting_recaps_test.sql.

create table public.meeting_recaps (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on delete restrict,
  engagement_id uuid references public.engagements(id) on delete restrict,
  transcript_id text not null check (transcript_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  source_version text,
  meeting_started_at timestamptz,
  status text not null check (status in ('prepared', 'unavailable', 'quarantined', 'failed')),
  evidence_status text check (evidence_status in ('completed', 'processing', 'not_found', 'access_denied')),
  model text check (model is null or length(btrim(model)) between 1 and 200),
  limitation text check (limitation is null or length(limitation) between 1 and 2000),
  clean_excerpts integer not null default 0 check (clean_excerpts >= 0),
  withheld_excerpts integer not null default 0 check (withheld_excerpts >= 0),
  rejected_candidates integer not null default 0 check (rejected_candidates >= 0),
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  check (status <> 'prepared' or (source_version is not null and evidence_status = 'completed' and model is not null))
);
create index meeting_recaps_client_idx on public.meeting_recaps (client_slug, created_at desc);

create table public.meeting_recap_items (
  id uuid primary key default gen_random_uuid(),
  recap_id uuid not null references public.meeting_recaps(id) on delete restrict,
  position integer not null check (position >= 0),
  kind text not null check (kind in ('decision', 'question', 'action')),
  summary text not null check (length(btrim(summary)) between 1 and 500),
  citations jsonb not null check (jsonb_typeof(citations) = 'array' and jsonb_array_length(citations) between 1 and 5),
  date_status text not null check (date_status in ('stated', 'uncertain', 'missing', 'not_applicable')),
  date_text text check (date_text is null or length(date_text) between 1 and 200),
  date_value date,
  missing_information jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_information) = 'array'),
  proposed_action text check (proposed_action in ('add_internal_note', 'set_due_date')),
  item_hash text not null check (item_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (recap_id, position),
  check ((date_status = 'stated') = (date_value is not null)),
  check (proposed_action is distinct from 'set_due_date' or date_status = 'stated'),
  check (kind = 'action' or proposed_action is null)
);

create table public.meeting_recap_reviews (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.meeting_recap_items(id) on delete restrict,
  reviewer_id uuid not null default auth.uid(),
  decision text not null check (decision in ('confirmed', 'rejected')),
  confirmed_item_hash text not null check (confirmed_item_hash ~ '^[0-9a-f]{64}$'),
  note text not null check (length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now()
);

comment on table public.meeting_recaps is 'Meeting recap outcomes (port of Goodo OS meeting_recaps). Staff read; written by the meeting-recaps function only.';
comment on table public.meeting_recap_items is 'Decisions, questions and actions of a prepared recap, each citing exact transcript quotes. Staff read.';
comment on table public.meeting_recap_reviews is 'One staff decision per recap item, against its exact hash. Staff insert their own; append-only.';

-- ------------------------------------------------------------------ append-only history

create or replace function public.prevent_meeting_recap_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'meeting recap history is immutable' using errcode = '23514';
end;
$$;

create trigger meeting_recaps_immutable before update or delete on public.meeting_recaps
  for each row execute function public.prevent_meeting_recap_rewrite();
create trigger meeting_recap_items_immutable before update or delete on public.meeting_recap_items
  for each row execute function public.prevent_meeting_recap_rewrite();
create trigger meeting_recap_reviews_immutable before update or delete on public.meeting_recap_reviews
  for each row execute function public.prevent_meeting_recap_rewrite();
create trigger meeting_recaps_no_truncate before truncate on public.meeting_recaps
  for each statement execute function public.prevent_meeting_recap_rewrite();
create trigger meeting_recap_items_no_truncate before truncate on public.meeting_recap_items
  for each statement execute function public.prevent_meeting_recap_rewrite();
create trigger meeting_recap_reviews_no_truncate before truncate on public.meeting_recap_reviews
  for each statement execute function public.prevent_meeting_recap_rewrite();

-- A review records the reviewer as the caller, must match the item's current hash,
-- and is refused for a question (questions stay open).
create or replace function public.check_meeting_recap_review()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_kind text;
  v_hash text;
begin
  if auth.uid() is not null then
    new.reviewer_id := auth.uid();
  end if;
  select kind, item_hash into v_kind, v_hash from public.meeting_recap_items where id = new.item_id;
  if v_kind is null then
    raise exception 'recap item not found' using errcode = '23503';
  end if;
  if v_kind = 'question' then
    raise exception 'questions stay open and are not reviewed' using errcode = '23514';
  end if;
  if v_hash <> new.confirmed_item_hash then
    raise exception 'the recap item changed since it was shown' using errcode = '40001';
  end if;
  return new;
end;
$$;

create trigger meeting_recap_reviews_check before insert on public.meeting_recap_reviews
  for each row execute function public.check_meeting_recap_review();

-- ------------------------------------------------------------------ grants and row rules

alter table public.meeting_recaps enable row level security;
alter table public.meeting_recap_items enable row level security;
alter table public.meeting_recap_reviews enable row level security;

revoke all on table public.meeting_recaps, public.meeting_recap_items, public.meeting_recap_reviews
  from public, anon, authenticated;
grant select on table public.meeting_recaps, public.meeting_recap_items to authenticated;
grant select, insert on table public.meeting_recap_reviews to authenticated;
grant all on table public.meeting_recaps, public.meeting_recap_items, public.meeting_recap_reviews to service_role;

create policy "Builder/employee can read meeting_recaps" on public.meeting_recaps
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder/employee can read meeting_recap_items" on public.meeting_recap_items
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder/employee can read meeting_recap_reviews" on public.meeting_recap_reviews
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder/employee can add their own meeting_recap_reviews" on public.meeting_recap_reviews
  for insert to authenticated
  with check (
    (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role))
    and reviewer_id = auth.uid()
  );

-- ------------------------------------------------------------------ recording (service role)

-- Writes one recap and its items in one transaction. p_items is a JSON array of
-- objects with the meeting_recap_items columns (position, kind, summary, citations,
-- date_status, date_text, date_value, missing_information, proposed_action,
-- item_hash). Returns the recap id.
create or replace function public.record_meeting_recap(p_recap jsonb, p_items jsonb default '[]'::jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array' using errcode = '22023';
  end if;
  if (p_recap->>'status') <> 'prepared' and jsonb_array_length(p_items) > 0 then
    raise exception 'only a prepared recap has items' using errcode = '22023';
  end if;
  insert into public.meeting_recaps (
    client_slug, engagement_id, transcript_id, source_version, meeting_started_at, status, evidence_status,
    model, limitation, clean_excerpts, withheld_excerpts, rejected_candidates, requested_by)
  values (
    p_recap->>'client_slug', nullif(p_recap->>'engagement_id', '')::uuid, p_recap->>'transcript_id',
    p_recap->>'source_version', nullif(p_recap->>'meeting_started_at', '')::timestamptz, p_recap->>'status',
    p_recap->>'evidence_status', p_recap->>'model', p_recap->>'limitation',
    coalesce((p_recap->>'clean_excerpts')::integer, 0), coalesce((p_recap->>'withheld_excerpts')::integer, 0),
    coalesce((p_recap->>'rejected_candidates')::integer, 0), (p_recap->>'requested_by')::uuid)
  returning id into v_id;

  if p_recap->>'engagement_id' is not null and not exists (
    select 1 from public.engagements e where e.id = (p_recap->>'engagement_id')::uuid and e.client_slug = p_recap->>'client_slug'
  ) then
    raise exception 'the engagement belongs to another client' using errcode = '22023';
  end if;

  insert into public.meeting_recap_items (
    recap_id, position, kind, summary, citations, date_status, date_text, date_value,
    missing_information, proposed_action, item_hash)
  select v_id, (i->>'position')::integer, i->>'kind', i->>'summary', i->'citations', i->>'date_status',
         i->>'date_text', nullif(i->>'date_value', '')::date, coalesce(i->'missing_information', '[]'::jsonb),
         i->>'proposed_action', i->>'item_hash'
    from jsonb_array_elements(p_items) as i;
  return v_id;
end;
$$;

revoke all on function public.record_meeting_recap(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_meeting_recap(jsonb, jsonb) to service_role;
revoke all on function public.check_meeting_recap_review() from public, anon;
revoke all on function public.prevent_meeting_recap_rewrite() from public, anon;
