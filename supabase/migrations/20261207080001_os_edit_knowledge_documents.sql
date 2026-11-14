-- Edit knowledge documents directly (replaces the request-a-change flow in the app).
--
-- Staff (builder or employee) edit a Knowledge source or a Brain page in place. Two functions,
-- both SECURITY DEFINER and both refusing anyone who is not builder or employee in their own body:
--
--   edit_knowledge_source(source, body, expected_version)
--       Adds the next version of the source (new kind 'edit') and moves current_version to it.
--       The page shows the current version, so the edit shows at once. The older versions stay
--       in the table (history is append-only), but the app no longer lists them.
--
--   edit_brain_page(page, body_md, expected_updated_at)
--       Writes body_md on the page row and marks it edited in the app (edited_in_app, edited_at,
--       edited_by). content_hash is left as the hash of the last HQ publish, so it still says
--       what HQ last sent.
--
-- Publishing rule (Brain): brain_pages is filled from HQ files by scripts/publish-brain.mjs. A
-- page with edited_in_app = true is never overwritten or removed by that script; the app edit
-- wins. The script reports the pages it kept and only replaces them when it is run with
-- --overwrite-edited, which also clears the marker.
--
-- Both functions check the version or timestamp the editor opened, so two people saving at the
-- same time get a "changed since you opened it" answer (40001) instead of losing text.
--
-- Not changed: the knowledge_corrections / correction review tables and their functions, and the
-- brain_page_corrections tables and functions. They keep their rows and the app stops calling
-- them. Row rules are unchanged: staff read, nobody writes tables directly, clients get nothing.
-- Tests: supabase/tests/os_edit_knowledge_documents_test.sql.

-- ------------------------------------------------------------------ knowledge: 'edit' versions

do $drop$
declare
  c record;
begin
  -- Drop the column check on kind whatever its generated name is (the other checks on this
  -- table mention correction_id or rolled_back_to, never "kind in").
  for c in
    select conname from pg_constraint
     where conrelid = 'public.knowledge_source_versions'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%kind = ANY%'
  loop
    execute format('alter table public.knowledge_source_versions drop constraint %I', c.conname);
  end loop;
end;
$drop$;
alter table public.knowledge_source_versions
  add constraint knowledge_source_versions_kind_check check (kind in ('create', 'publish', 'rollback', 'edit'));

create or replace function public.edit_knowledge_source(
  p_source_id uuid,
  p_body text,
  p_expected_version integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_current integer;
  v_fingerprint text;
  v_next_fingerprint text;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can edit knowledge' using errcode = 'insufficient_privilege';
  end if;
  select current_version into v_current from public.knowledge_sources where id = p_source_id for update;
  if v_current is null then
    raise exception 'knowledge source not found' using errcode = 'P0002';
  end if;
  if v_current <> p_expected_version then
    raise exception 'the source changed since it was shown' using errcode = '40001';
  end if;
  select fingerprint into v_fingerprint from public.knowledge_source_versions where source_id = p_source_id and version = v_current;
  v_next_fingerprint := public.knowledge_body_fingerprint(coalesce(p_body, ''));
  if v_fingerprint = v_next_fingerprint then
    raise exception 'the text is the same as the current text' using errcode = '22023';
  end if;
  insert into public.knowledge_source_versions (source_id, version, body, fingerprint, kind, published_by)
  values (p_source_id, v_current + 1, p_body, v_next_fingerprint, 'edit', auth.uid());
  update public.knowledge_sources set current_version = v_current + 1 where id = p_source_id;
  return v_current + 1;
end;
$$;

-- ------------------------------------------------------------------ brain: edited in the app

alter table public.brain_pages
  add column edited_in_app boolean not null default false,
  add column edited_at timestamptz,
  add column edited_by uuid references auth.users(id) on delete set null;

comment on column public.brain_pages.edited_in_app is
  'True once staff edited the page in the app. scripts/publish-brain.mjs then keeps the page as it is (unless --overwrite-edited).';

create or replace function public.edit_brain_page(
  p_page_id uuid,
  p_body_md text,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_page public.brain_pages;
  v_updated timestamptz;
begin
  if not (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role)) then
    raise exception 'only staff can edit a Brain page' using errcode = 'insufficient_privilege';
  end if;
  if length(btrim(coalesce(p_body_md, ''))) = 0 or length(p_body_md) > 200000 then
    raise exception 'the page text must be between 1 and 200000 characters' using errcode = '23514';
  end if;
  select * into v_page from public.brain_pages where id = p_page_id for update;
  if v_page.id is null then
    raise exception 'Brain page not found' using errcode = 'P0002';
  end if;
  if v_page.updated_at is distinct from p_expected_updated_at then
    raise exception 'the page changed since it was shown' using errcode = '40001';
  end if;
  if v_page.body_md = p_body_md then
    raise exception 'the text is the same as the page' using errcode = '22023';
  end if;
  update public.brain_pages
     set body_md = p_body_md, edited_in_app = true, edited_at = now(), edited_by = auth.uid()
   where id = p_page_id
  returning updated_at into v_updated;
  return v_updated;
end;
$$;

revoke all on function public.edit_knowledge_source(uuid, text, integer),
  public.edit_brain_page(uuid, text, timestamptz) from public, anon;
grant execute on function public.edit_knowledge_source(uuid, text, integer),
  public.edit_brain_page(uuid, text, timestamptz) to authenticated, service_role;
