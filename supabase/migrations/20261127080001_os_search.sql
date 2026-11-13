-- Goodo OS story OS-015: search Brain pages, tasks and clients from Cmd+K.
--
-- Adds full-text search columns and indexes, and one function, os_search(query, limit), that the
-- Cmd/Ctrl+K palette calls. It returns up to p_limit rows of each kind ('page', 'task', 'client')
-- with a title, a small subtitle, the matching line (snippet) and a role-relative address.
--
-- Matching: websearch_to_tsquery('english', query), OR a prefix query built from the typed words
-- (so "sweep rev" already finds "sweeping reveals" while the person types), OR the title contains
-- the text (pg_trgm indexes keep that fast).
--
-- Snippet: the first line of the page body that matches, with markdown syntax removed, highlighted
-- with ts_headline and cut to 200 characters. Matched words are wrapped in the plain markers
-- U+27E6 and U+27E7 (the white square brackets). The browser turns them into <mark> elements; it
-- never renders the snippet as HTML. The markers are removed from the source text first, so a page
-- cannot fake a highlight.
--
-- Who sees what (checked inside the function, which runs as its owner):
--   builder, employee  Brain pages, every task that is not read-only ClickUp history, every client.
--   client             no Brain pages; tasks of their own clients only (get_user_client_slugs, which
--                      counts ad-account access as well as client_members), only the client-visible
--                      fields, only tasks a client may see (not read-only, and either made in the app
--                      or an asset task, the same rule as the client comment thread); their own
--                      clients only.
--   no role, anon      nothing. anon cannot call it at all.

create extension if not exists pg_trgm;

-- ------------------------------------------------------------------ search columns and indexes

alter table public.brain_pages
  add column search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body_md, '')), 'B')
  ) stored;

create index brain_pages_search_tsv_idx on public.brain_pages using gin (search_tsv);
create index brain_pages_title_trgm_idx on public.brain_pages using gin (title gin_trgm_ops);

alter table public.os_tasks
  add column search_tsv tsvector generated always as (to_tsvector('english', coalesce(title, ''))) stored;

create index os_tasks_search_tsv_idx on public.os_tasks using gin (search_tsv);
create index os_tasks_title_trgm_idx on public.os_tasks using gin (title gin_trgm_ops);
create index clients_name_trgm_idx on public.clients using gin (name gin_trgm_ops);

-- ------------------------------------------------------------------ helpers

-- Markdown to plain text, line by line: headings, list markers, quotes, emphasis, code ticks,
-- images and links (keeping the link text), and any highlight markers already in the text.
create or replace function public.os_search_plain(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(coalesce(p_text, ''),
      '[⟦⟧]', '', 'g'),
      '!?\[([^\]]*)\]\([^)]*\)', '\1', 'g'),
      '^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+', '', 'gn'),
      '[*_`~]+', '', 'g'),
      '<[^>]*>', '', 'g'),
      '\s+', ' ', 'g'))
$$;

revoke all on function public.os_search_plain(text) from public, anon, authenticated;
grant execute on function public.os_search_plain(text) to service_role;

-- ------------------------------------------------------------------ the search

create or replace function public.os_search(p_query text, p_limit int default 8)
returns table (
  kind text,
  id text,
  title text,
  subtitle text,
  snippet text,
  url_hint text,
  rank real
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_text text := btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'));
  v_limit int := least(greatest(coalesce(p_limit, 8), 1), 20);
  v_staff boolean;
  v_client boolean;
  v_words text[];
  v_q tsquery;
  v_like text;
  v_hl constant text := 'StartSel=⟦, StopSel=⟧, MaxWords=24, MinWords=8, ShortWord=2, HighlightAll=false, MaxFragments=1';
begin
  if v_uid is null or length(v_text) < 2 then
    return;
  end if;
  v_text := left(v_text, 200);
  v_staff := public.has_role(v_uid, 'builder'::public.app_role) or public.has_role(v_uid, 'employee'::public.app_role);
  v_client := not v_staff and public.has_role(v_uid, 'client'::public.app_role);
  if not v_staff and not v_client then
    return;
  end if;

  -- Typed words, letters and digits only, for the prefix query and nothing else.
  select coalesce(array_agg(w), '{}') into v_words
    from regexp_split_to_table(lower(v_text), '[^[:alnum:]]+') w
   where w <> '';

  v_q := websearch_to_tsquery('english', v_text);
  if array_length(v_words, 1) > 0 then
    v_q := v_q || to_tsquery('english', array_to_string(array(select quote_literal(w) || ':*' from unnest(v_words) w), ' & '));
  end if;
  v_like := '%' || replace(replace(replace(v_text, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Brain pages: staff only.
  if v_staff then
    return query
    select 'page'::text, b.id::text, b.title, b.section,
           coalesce(
             (select left(ts_headline('english', public.os_search_plain(l.line), v_q, v_hl), 200)
                from regexp_split_to_table(b.body_md, E'\n') with ordinality as l(line, n)
               where to_tsvector('english', l.line) @@ v_q
               order by l.n
               limit 1),
             left(ts_headline('english', public.os_search_plain(left(b.body_md, 4000)), v_q, v_hl), 200)),
           '/knowledge/brain?section=' || b.section || '&page=' || b.slug,
           (ts_rank(b.search_tsv, v_q) + case when b.title ilike v_like then 1 else 0 end)::real
      from public.brain_pages b
     where b.search_tsv @@ v_q or b.title ilike v_like
     order by 7 desc, b.title
     limit v_limit;
  end if;

  -- Tasks.
  return query
  select 'task'::text, t.id::text, t.title,
         coalesce(c.name, t.client_slug) || ' · ' || case when v_staff then t.status else s.stage end,
         left(ts_headline('english', public.os_search_plain(t.title), v_q, v_hl), 200),
         '/clients/' || t.client_slug || '/work',
         (ts_rank(t.search_tsv, v_q) + case when t.title ilike v_like then 1 else 0 end)::real
    from public.os_tasks t
    join public.os_task_statuses s on s.status = t.status
    left join public.clients c on c.slug = t.client_slug
   where not t.read_only
     and (t.search_tsv @@ v_q or t.title ilike v_like)
     and (v_staff
          or (t.client_slug in (select public.get_user_client_slugs())
              and (t.clickup_list_id is null or t.is_asset)))
   order by 7 desc, t.title
   limit v_limit;

  -- Clients.
  return query
  select 'client'::text, c.slug, c.name,
         case when c.active then 'Client' else 'Client (inactive)' end,
         left(ts_headline('english', c.name, v_q, v_hl), 200),
         '/clients/' || c.slug,
         (ts_rank(to_tsvector('english', c.name), v_q) + case when c.name ilike v_like then 1 else 0 end)::real
    from public.clients c
   where (to_tsvector('english', c.name) @@ v_q or c.name ilike v_like)
     and (v_staff or c.slug in (select public.get_user_client_slugs()))
   order by 7 desc, c.name
   limit v_limit;
end;
$$;

revoke all on function public.os_search(text, int) from public, anon;
grant execute on function public.os_search(text, int) to authenticated, service_role;

comment on function public.os_search(text, int) is
  'Cmd+K search (OS-015): Brain pages (staff), tasks and clients, checked by role inside. Snippet highlights use the plain markers U+27E6 and U+27E7.';
