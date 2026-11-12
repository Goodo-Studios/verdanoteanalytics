-- Goodo OS story OS-014: the company Brain, published from HQ knowledge.
--
-- brain_pages holds one row per published HQ knowledge page. HQ is the source: the publish
-- script (scripts/publish-brain.mjs) walks the HQ knowledge folder, maps folders to the four
-- sections below and upserts rows by source_path as the service role. Pages are not edited
-- in the app.
--
--   company    -> Handbook
--   processes  -> Playbooks
--   clients    -> Clients
--   insights   -> Insights
--
-- Raw Slack capture and every other folder are never published (the script refuses any path
-- with a "slack" segment, and this table refuses one too).
--
-- Access:
--   builder, employee  read every row.
--   client, anon       nothing (a client-facing Brain is not in scope).
--   service_role       writes; the publish script runs as it.
-- No definer functions are added, so the security definer allow-list is unchanged.

create table public.brain_pages (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('Handbook', 'Playbooks', 'Clients', 'Insights')),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(btrim(title)) > 0),
  body_md text not null default '',
  owner text not null default 'Unassigned' check (length(btrim(owner)) > 0),
  last_reviewed date,
  -- Where last_reviewed came from: a frontmatter key name, or 'file' for the file's change time.
  last_reviewed_source text,
  source_path text not null unique
    check (source_path !~ '(^|/)slack(/|$)' and source_path !~ '^/' and source_path !~ '(^|/)\.\.(/|$)'),
  content_hash text not null,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (section, slug)
);

create index brain_pages_section_title_idx on public.brain_pages (section, title);

create trigger update_brain_pages_updated_at before update on public.brain_pages
  for each row execute function public.update_updated_at_column();

comment on table public.brain_pages is
  'Company Brain pages published from HQ knowledge (OS-014). Staff read; only the service role writes.';

alter table public.brain_pages enable row level security;

revoke all on table public.brain_pages from public, anon, authenticated;
grant select on table public.brain_pages to authenticated;
grant all on table public.brain_pages to service_role;

create policy "Builder/employee can read brain_pages" on public.brain_pages
  for select to authenticated
  using (public.has_role(auth.uid(), 'builder'::public.app_role) or public.has_role(auth.uid(), 'employee'::public.app_role));
