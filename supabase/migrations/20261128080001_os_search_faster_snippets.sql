-- OS-015 follow-up: faster Cmd+K search.
--
-- The first version built the Brain page snippet by splitting the whole body into lines and running
-- to_tsvector on each line. One staging page is 1.9 MB, so a phrase that matched it took about
-- 430 ms. This version finds where the longest typed word first appears with strpos (fast on any
-- size) and highlights the text around it, and it ranks and cuts to the top rows before building
-- any snippet. Results, roles and output shape are unchanged.
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
  v_long text;
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
  select coalesce((select w from unnest(v_words) w order by length(w) desc, w limit 1), '') into v_long;
  v_like := '%' || replace(replace(replace(v_text, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Brain pages: staff only. Rank and cut to the top rows first, then build snippets for those.
  if v_staff then
    return query
    with top as materialized (
      select b.id, b.title, b.section, b.slug, b.body_md,
             (ts_rank(b.search_tsv, v_q) + case when b.title ilike v_like then 1 else 0 end)::real as r
        from public.brain_pages b
       where b.search_tsv @@ v_q or b.title ilike v_like
       order by 6 desc, b.title
       limit v_limit
    )
    , pos as (
      -- Where the longest typed word first appears (a plain, fast text search), or 0.
      select top.*, case when v_long = '' then 0 else strpos(lower(top.body_md), v_long) end as p
        from top
    )
    select 'page'::text, pos.id::text, pos.title, pos.section,
           left(ts_headline('english', public.os_search_plain(
             case when pos.p > 0
                  then substr(pos.body_md, greatest(pos.p - 300, 1), 900)
                  else left(pos.body_md, 4000) end), v_q, v_hl), 200),
           '/knowledge/brain?section=' || pos.section || '&page=' || pos.slug,
           pos.r
      from pos
     order by pos.r desc, pos.title;
  end if;

  -- Tasks.
  return query
  with top as materialized (
    select t.id, t.title, t.client_slug, t.status, s.stage, c.name as client_name,
           (ts_rank(t.search_tsv, v_q) + case when t.title ilike v_like then 1 else 0 end)::real as r
      from public.os_tasks t
      join public.os_task_statuses s on s.status = t.status
      left join public.clients c on c.slug = t.client_slug
     where not t.read_only
       and (t.search_tsv @@ v_q or t.title ilike v_like)
       and (v_staff
            or (t.client_slug in (select public.get_user_client_slugs())
                and (t.clickup_list_id is null or t.is_asset)))
     order by 7 desc, t.title
     limit v_limit
  )
  select 'task'::text, top.id::text, top.title,
         coalesce(top.client_name, top.client_slug) || ' · ' || case when v_staff then top.status else top.stage end,
         left(ts_headline('english', public.os_search_plain(top.title), v_q, v_hl), 200),
         '/clients/' || top.client_slug || '/work',
         top.r
    from top
   order by top.r desc, top.title;

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
  'Cmd+K search (OS-015): Brain pages (staff), tasks and clients, checked by role inside. Ranks first, then builds snippets for the top rows only. Snippet highlights use the plain markers U+27E6 and U+27E7.';
