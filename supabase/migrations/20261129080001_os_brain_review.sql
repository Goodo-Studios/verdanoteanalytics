-- Goodo OS story OS-016: keep the Brain current.
--
-- 1. Owners as logins. brain_pages.owner is free text from HQ frontmatter (a name, an email or
--    "Unassigned"). owner_user_id is the staff login it matches, filled on every insert or
--    update by a trigger, so the publish script needs no change to fill it. A match is a staff
--    login (builder or employee) whose email equals the owner (when the owner has an @), or whose
--    profile display name, full_name or name equals it, case-insensitive and trimmed. No match,
--    or more than one, leaves it null. rematch_brain_page_owners() redoes every page after a
--    name changes and returns the owners that still match nobody; the publish script calls it
--    and prints them.
--
-- 2. Needs review. A page needs review when it has no review date or it was last reviewed more
--    than 90 days ago (91 days or more). my_brain_pages_to_review() returns the caller's own
--    pages that need review. It runs as the caller, so row rules apply and a client gets nothing.
--
-- 3. Suggested fixes. This follows the knowledge corrections flow (migration 20261110000003) with
--    its own two tables, because knowledge_corrections is tied to knowledge_sources versions:
--      brain_page_corrections         a staff member's suggested fix to a Brain page, locked to
--                                     the page's content hash at the time. Immutable.
--      brain_page_correction_reviews  one decision per fix (accepted or rejected). Append-only.
--    HQ is the source of every Brain page, so accepting a fix does not change brain_pages (the
--    next publish would overwrite it). An accepted fix is a record for the owner to apply in HQ.
--    Once the page is published with a different content hash the fix counts as applied; the
--    publish script lists accepted fixes whose page has not changed yet.
--
-- Access:
--   any builder or employee  reads every fix and review; suggests a fix.
--   page owner or a builder  accepts or rejects a fix, never their own.
--   client, anon             nothing.
-- The two write functions are SECURITY DEFINER and refuse non-staff in their own body; they are
-- on the staff_area allow-list in supabase/tests/security_definer_grants_test.sql. The owner
-- matching functions are service_role only.
-- Tests: supabase/tests/os_brain_review_test.sql.

-- ------------------------------------------------------------------ 1. owner logins

alter table public.brain_pages
  add column owner_user_id uuid references auth.users(id) on delete set null;
create index brain_pages_owner_user_idx on public.brain_pages (owner_user_id, last_reviewed);

-- The one staff login an owner text names, or null.
create or replace function public.brain_owner_user_id(p_owner text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with wanted as (select lower(btrim(coalesce(p_owner, ''))) as v),
  staff as (
    select distinct u.id
      from auth.users u
      join public.user_roles r on r.user_id = u.id and r.role in ('builder', 'employee')
      left join public.profiles p on p.user_id = u.id
      cross join wanted w
     where w.v <> '' and w.v <> 'unassigned'
       and (
         (w.v like '%@%' and lower(btrim(u.email)) = w.v)
         or (w.v not like '%@%' and (
               lower(btrim(p.display_name)) = w.v
               or lower(btrim(u.raw_user_meta_data ->> 'full_name')) = w.v
               or lower(btrim(u.raw_user_meta_data ->> 'name')) = w.v))
       )
  )
  select case when (select count(*) from staff) = 1 then (select id from staff) end;
$$;

create or replace function public.brain_pages_set_owner_user_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.owner_user_id := public.brain_owner_user_id(new.owner);
  return new;
end;
$$;

create trigger brain_pages_owner_user before insert or update of owner on public.brain_pages
  for each row execute function public.brain_pages_set_owner_user_id();

-- Service role: match every page again and return the owners that match no staff login.
create or replace function public.rematch_brain_page_owners()
returns table (owner text, pages integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update public.brain_pages b set owner_user_id = public.brain_owner_user_id(b.owner)
   where b.owner_user_id is distinct from public.brain_owner_user_id(b.owner);
  return query
    select b.owner, count(*)::integer
      from public.brain_pages b
     where b.owner_user_id is null and lower(btrim(b.owner)) <> 'unassigned'
     group by b.owner
     order by b.owner;
end;
$$;

revoke all on function public.brain_owner_user_id(text), public.rematch_brain_page_owners(),
  public.brain_pages_set_owner_user_id() from public, anon, authenticated;
grant execute on function public.brain_owner_user_id(text), public.rematch_brain_page_owners() to service_role;

-- Fill the column for pages already published.
update public.brain_pages set owner_user_id = public.brain_owner_user_id(owner);

-- ------------------------------------------------------------------ 2. needs review

-- More than 90 days since the last review, or never reviewed. Matches NEEDS_REVIEW_DAYS in
-- src/features/brain/model.ts.
create or replace function public.brain_page_needs_review(p_last_reviewed date, p_today date default current_date)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_last_reviewed is null or p_today - p_last_reviewed > 90;
$$;

-- The caller's own pages that need review, oldest review first. Runs as the caller.
create or replace function public.my_brain_pages_to_review()
returns table (id uuid, section text, slug text, title text, last_reviewed date)
language sql
stable
security invoker
set search_path = public
as $$
  select b.id, b.section, b.slug, b.title, b.last_reviewed
    from public.brain_pages b
   where auth.uid() is not null
     and b.owner_user_id = auth.uid()
     and public.brain_page_needs_review(b.last_reviewed)
   order by b.last_reviewed asc nulls first, b.title;
$$;

revoke all on function public.brain_page_needs_review(date, date), public.my_brain_pages_to_review() from public, anon;
grant execute on function public.brain_page_needs_review(date, date), public.my_brain_pages_to_review() to authenticated, service_role;

-- ------------------------------------------------------------------ 3. suggested fixes

-- brain_page_id has no foreign key on purpose: the publish script deletes a page when its HQ file
-- goes away, and a fix stays as a record. source_path and page_title say which file it was.
create table public.brain_page_corrections (
  id uuid primary key default gen_random_uuid(),
  brain_page_id uuid not null,
  source_path text not null,
  page_title text not null,
  page_content_hash text not null,
  proposed_body text not null check (length(btrim(proposed_body)) between 1 and 50000),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  classification text not null check (classification in ('content', 'procedure', 'permission', 'factual')),
  submitted_by uuid not null,
  created_at timestamptz not null default now()
);
create index brain_page_corrections_page_idx on public.brain_page_corrections (brain_page_id, created_at desc);

create table public.brain_page_correction_reviews (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null unique references public.brain_page_corrections(id) on delete restrict,
  decision text not null check (decision in ('accepted', 'rejected')),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  reviewer_id uuid not null,
  created_at timestamptz not null default now()
);

comment on table public.brain_page_corrections is
  'Suggested fixes to Brain pages (OS-016). Immutable. Accepted fixes are applied in HQ, not here.';
comment on table public.brain_page_correction_reviews is 'One accept or reject decision per Brain page fix. Append-only.';

create trigger brain_page_corrections_immutable before update or delete on public.brain_page_corrections
  for each row execute function public.prevent_knowledge_history_rewrite();
create trigger brain_page_correction_reviews_immutable before update or delete on public.brain_page_correction_reviews
  for each row execute function public.prevent_knowledge_history_rewrite();
create trigger brain_page_corrections_no_truncate before truncate on public.brain_page_corrections
  for each statement execute function public.prevent_knowledge_history_rewrite();
create trigger brain_page_correction_reviews_no_truncate before truncate on public.brain_page_correction_reviews
  for each statement execute function public.prevent_knowledge_history_rewrite();

alter table public.brain_page_corrections enable row level security;
alter table public.brain_page_correction_reviews enable row level security;

revoke all on table public.brain_page_corrections, public.brain_page_correction_reviews from public, anon, authenticated;
grant select on table public.brain_page_corrections, public.brain_page_correction_reviews to authenticated;
grant all on table public.brain_page_corrections, public.brain_page_correction_reviews to service_role;

create policy "Builder/employee can read brain_page_corrections" on public.brain_page_corrections
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
create policy "Builder/employee can read brain_page_correction_reviews" on public.brain_page_correction_reviews
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

-- Builder or employee: suggest a fix to the page as it was shown (its content hash).
create or replace function public.submit_brain_page_correction(
  p_page_id uuid,
  p_content_hash text,
  p_proposed_body text,
  p_reason text,
  p_classification text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_page public.brain_pages;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can suggest a fix' using errcode = 'insufficient_privilege';
  end if;
  select * into v_page from public.brain_pages where id = p_page_id;
  if v_page.id is null then
    raise exception 'Brain page not found' using errcode = 'P0002';
  end if;
  if v_page.content_hash is distinct from p_content_hash then
    raise exception 'the page was published again since it was shown' using errcode = '40001';
  end if;
  if btrim(coalesce(p_proposed_body, '')) = btrim(v_page.body_md) then
    raise exception 'the suggested text is the same as the page' using errcode = '22023';
  end if;
  insert into public.brain_page_corrections
    (brain_page_id, source_path, page_title, page_content_hash, proposed_body, reason, classification, submitted_by)
  values (v_page.id, v_page.source_path, v_page.title, v_page.content_hash, p_proposed_body, btrim(p_reason), p_classification, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- The page owner or a builder: accept or reject a fix. Not by its author.
create or replace function public.review_brain_page_correction(
  p_correction_id uuid,
  p_decision text,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_correction public.brain_page_corrections;
  v_owner uuid;
  v_id uuid;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can review a fix' using errcode = 'insufficient_privilege';
  end if;
  select * into v_correction from public.brain_page_corrections where id = p_correction_id;
  if v_correction.id is null then
    raise exception 'fix not found' using errcode = 'P0002';
  end if;
  if v_correction.submitted_by = auth.uid() then
    raise exception 'a fix is reviewed by someone other than its author' using errcode = 'insufficient_privilege';
  end if;
  select owner_user_id into v_owner from public.brain_pages where id = v_correction.brain_page_id;
  -- coalesce: a page with no matched owner (or a removed page) is reviewed by a builder only.
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or coalesce(v_owner = auth.uid(), false)) then
    raise exception 'only the page owner or a builder reviews a fix' using errcode = 'insufficient_privilege';
  end if;
  insert into public.brain_page_correction_reviews (correction_id, decision, reason, reviewer_id)
  values (p_correction_id, p_decision, btrim(p_reason), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_brain_page_correction(uuid, text, text, text, text),
  public.review_brain_page_correction(uuid, text, text) from public, anon;
grant execute on function public.submit_brain_page_correction(uuid, text, text, text, text),
  public.review_brain_page_correction(uuid, text, text) to authenticated, service_role;
