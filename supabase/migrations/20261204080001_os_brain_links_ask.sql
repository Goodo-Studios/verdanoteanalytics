-- Goodo OS story OS-026: link the Brain to tasks, and ask the Brain a question.
--
-- 1. brain_playbook_links maps a task content type (os_tasks.content_type, the ClickUp "Content
--    type" dropdown) to a Brain page and, optionally, a heading on it. Builders keep the map;
--    every staff member reads it. The page is named by section and slug (not id) because the
--    publish script may delete and re-insert a page; the link comes back when the page does.
--
-- 2. brain_playbook_for_content_type(content_type) returns the page and heading for the task side
--    panel. A row in the map wins. Without one, it falls back to a Playbooks page with a markdown
--    heading (or a title) equal to the content type, ignoring case and spaces. No match returns
--    no row. Security invoker: brain_pages and the map already give clients nothing, and the
--    function also refuses any caller who is not builder or employee (42501).
--
-- 3. brain_answer_passages(question, limit) returns the Brain paragraphs that best match a
--    question, with their page. Only the brain-ask edge function calls it, as the service role,
--    after checking the caller is staff. anon, authenticated and clients cannot execute it.
--    A paragraph counts when it holds at least two of the question's words (or the only one, for
--    a one-word question), so a lone common word does not pass for an answer.
--
-- No security definer function is added, so the definer allow-list is unchanged.
-- Tests: supabase/tests/os_brain_links_ask_test.sql.

-- ------------------------------------------------------------------ 1. the content type map

create table public.brain_playbook_links (
  content_type text primary key check (content_type = lower(btrim(content_type)) and length(content_type) > 0),
  section text not null default 'Playbooks' check (section in ('Handbook', 'Playbooks', 'Clients', 'Insights')),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- A heading anchor on the page (the heading text lower-cased, runs of other characters as '-').
  anchor text check (anchor is null or anchor ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger update_brain_playbook_links_updated_at before update on public.brain_playbook_links
  for each row execute function public.update_updated_at_column();

comment on table public.brain_playbook_links is
  'Task content type to Brain playbook section (OS-026). Staff read; builders write.';

alter table public.brain_playbook_links enable row level security;

revoke all on table public.brain_playbook_links from public, anon, authenticated;
grant select, insert, update, delete on table public.brain_playbook_links to authenticated;
grant all on table public.brain_playbook_links to service_role;

create policy "Builder/employee can read brain_playbook_links" on public.brain_playbook_links
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));

create policy "Builder can write brain_playbook_links" on public.brain_playbook_links
  for all to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role))
  with check (public.has_role(auth.uid(), 'builder'::public.app_role));

-- ------------------------------------------------------------------ helpers

-- Heading text to anchor: lower case, runs of anything but letters and digits become '-'.
-- Matches brainAnchor() in src/features/brain/model.ts.
create or replace function public.brain_anchor(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-'), '')
$$;

revoke all on function public.brain_anchor(text) from public, anon;
grant execute on function public.brain_anchor(text) to authenticated, service_role;

create or replace function public.brain_is_staff()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role), false)
$$;

revoke all on function public.brain_is_staff() from public, anon;
grant execute on function public.brain_is_staff() to authenticated, service_role;

-- ------------------------------------------------------------------ 2. playbook for a content type

create or replace function public.brain_playbook_for_content_type(p_content_type text)
returns table (section text, slug text, title text, anchor text, heading text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_type text := lower(btrim(regexp_replace(coalesce(p_content_type, ''), '\s+', ' ', 'g')));
begin
  if current_user <> 'service_role' and not public.brain_is_staff() then
    raise exception 'The Brain is for the Goodo team' using errcode = '42501';
  end if;
  if v_type = '' then
    return;
  end if;

  -- The map wins.
  return query
  select b.section, b.slug, b.title, l.anchor,
         (select btrim(regexp_replace(m.line, '^\s*#{1,6}\s+', ''))
            from regexp_split_to_table(b.body_md, E'\n') as m(line)
           where m.line ~ '^\s*#{1,6}\s+' and public.brain_anchor(regexp_replace(m.line, '^\s*#{1,6}\s+', '')) = l.anchor
           limit 1)
    from public.brain_playbook_links l
    join public.brain_pages b on b.section = l.section and b.slug = l.slug
   where l.content_type = v_type;
  if found then
    return;
  end if;

  -- Fallback: a Playbooks heading equal to the content type, then a Playbooks page titled so.
  return query
  select b.section, b.slug, b.title, public.brain_anchor(h.text), h.text
    from public.brain_pages b
    cross join lateral (
      select btrim(regexp_replace(m.line, '^\s*#{1,6}\s+', '')) as text, m.n
        from regexp_split_to_table(b.body_md, E'\n') with ordinality as m(line, n)
       where m.line ~ '^\s*#{1,6}\s+'
    ) h
   where b.section = 'Playbooks'
     and lower(regexp_replace(h.text, '\s+', ' ', 'g')) = v_type
   order by b.title, h.n
   limit 1;
  if found then
    return;
  end if;

  return query
  select b.section, b.slug, b.title, null::text, null::text
    from public.brain_pages b
   where b.section = 'Playbooks' and lower(btrim(regexp_replace(b.title, '\s+', ' ', 'g'))) = v_type
   order by b.title
   limit 1;
end;
$$;

revoke all on function public.brain_playbook_for_content_type(text) from public, anon;
grant execute on function public.brain_playbook_for_content_type(text) to authenticated, service_role;

-- ------------------------------------------------------------------ 3. passages for a question

create or replace function public.brain_answer_passages(p_question text, p_limit int default 6)
returns table (page_id uuid, section text, slug text, title text, passage text, rank real)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_text text := left(btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g')), 500);
  v_limit int := least(greatest(coalesce(p_limit, 6), 1), 12);
  v_lexemes text[];
  v_need int;
  v_q tsquery;
begin
  if current_user <> 'service_role' and not public.brain_is_staff() then
    raise exception 'The Brain is for the Goodo team' using errcode = '42501';
  end if;

  -- The question's words, stemmed, without stop words.
  select coalesce(array_agg(distinct t.lexeme), '{}') into v_lexemes
    from unnest(to_tsvector('english', v_text)) as t;
  if cardinality(v_lexemes) = 0 then
    return;
  end if;
  v_need := least(2, cardinality(v_lexemes));
  v_q := array_to_string(array(select quote_literal(l) from unnest(v_lexemes) l), ' | ')::tsquery;

  return query
  with paras as (
    select b.id, b.section, b.slug, b.title, btrim(p.para) as para, to_tsvector('english', b.title || ' ' || p.para) as tsv
      from public.brain_pages b
      cross join lateral regexp_split_to_table(b.body_md, E'\n[ \t]*\n') as p(para)
     where b.search_tsv @@ v_q
       and length(btrim(p.para)) > 0
  )
  select p.id, p.section, p.slug, p.title, left(p.para, 1200), ts_rank(p.tsv, v_q)::real
    from paras p
   where p.tsv @@ v_q
     and (select count(*) from unnest(v_lexemes) l where p.tsv @@ quote_literal(l)::tsquery) >= v_need
   order by 6 desc, p.title
   limit v_limit;
end;
$$;

revoke all on function public.brain_answer_passages(text, int) from public, anon, authenticated;
grant execute on function public.brain_answer_passages(text, int) to service_role;
