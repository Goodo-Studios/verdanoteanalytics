-- =============================================================================
-- US-001: Creative Vault schema port (workspace_id stripped, user-scoped only)
-- =============================================================================
-- Ports Creative Vault's vault tables into Verdanote with these adaptations:
--   • NO workspaces / workspace_members / workspace_invites (Verdanote has its
--     own user-management system; vault is strictly user-scoped).
--   • All RLS uses auth.uid() = user_id directly.
--   • viral_feed_items is a GLOBAL feed (no user_id) — any authenticated user
--     can SELECT.
--   • boards / slack_connections / inspiration_items keyed on user_id.
-- =============================================================================

-- ─── Extensions ─────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";
create extension if not exists vector;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. inspiration_items — core saved ad / inspiration row
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.inspiration_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  source_url      text,
  platform        text,
  creator_handle  text,
  title           text,
  thumbnail_url   text,
  thumbnail_path  text,
  video_url       text,
  file_path       text,
  status          text not null default 'pending',
  error_message   text,
  -- Ad-specific (from migration 002)
  ad_archive_id   text,
  ad_body_text    text,
  -- Brand metadata (migration 011)
  brand_name      text,
  industry        text,
  ad_format       text,
  target_audience text,
  -- Featured flag (migration 012)
  is_featured     boolean not null default false,
  -- Per-hook saved flags (migration 017)
  hook_verbal_saved boolean not null default false,
  hook_text_saved   boolean not null default false,
  hook_visual_saved boolean not null default false,
  -- Per-item AI analysis (migration 014)
  script_analysis text,
  visual_analysis text,
  created_at      timestamptz not null default now()
);

create index if not exists inspiration_items_user_idx
  on public.inspiration_items(user_id);
create index if not exists inspiration_items_ad_archive_id_idx
  on public.inspiration_items(user_id, ad_archive_id)
  where ad_archive_id is not null;
create index if not exists idx_inspiration_items_is_featured
  on public.inspiration_items(is_featured) where is_featured = true;
create index if not exists idx_inspiration_items_hook_verbal_saved
  on public.inspiration_items(user_id) where hook_verbal_saved = true;
create index if not exists idx_inspiration_items_hook_text_saved
  on public.inspiration_items(user_id) where hook_text_saved = true;
create index if not exists idx_inspiration_items_hook_visual_saved
  on public.inspiration_items(user_id) where hook_visual_saved = true;

alter table public.inspiration_items enable row level security;

create policy "inspiration_items_select" on public.inspiration_items
  for select to authenticated
  using (user_id = auth.uid());

create policy "inspiration_items_insert" on public.inspiration_items
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "inspiration_items_update" on public.inspiration_items
  for update to authenticated
  using (user_id = auth.uid());

create policy "inspiration_items_delete" on public.inspiration_items
  for delete to authenticated
  using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. inspiration_transcripts — raw + cleaned transcript per item
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.inspiration_transcripts (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.inspiration_items(id) on delete cascade,
  raw_transcript   text,
  cleaned_script   text,
  duration_seconds int,
  word_count       int,
  created_at       timestamptz not null default now()
);

create index if not exists inspiration_transcripts_item_idx
  on public.inspiration_transcripts(item_id);

alter table public.inspiration_transcripts enable row level security;

-- Security-definer helper: items visible to the current user (user-scoped only)
create or replace function public.vault_visible_item_ids()
  returns setof uuid
  language sql
  security definer
  stable
  set search_path = public
as $$
  select id from public.inspiration_items where user_id = auth.uid()
$$;

create policy "inspiration_transcripts_all" on public.inspiration_transcripts
  for all to authenticated
  using (item_id in (select public.vault_visible_item_ids()))
  with check (item_id in (select public.vault_visible_item_ids()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. inspiration_frameworks — extracted content framework per item
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.inspiration_frameworks (
  id                    uuid primary key default gen_random_uuid(),
  item_id               uuid not null references public.inspiration_items(id) on delete cascade,
  hook_type             text,
  hook_formula          text,
  value_structure       text,
  cta_type              text,
  cta_formula           text,
  fill_in_blank_script  text,
  framework_json        jsonb,
  copywriting_framework text,  -- migration 003
  hook_verbal           text,  -- migration 013
  hook_text             text,  -- migration 013
  created_at            timestamptz not null default now()
);

create index if not exists inspiration_frameworks_item_idx
  on public.inspiration_frameworks(item_id);

alter table public.inspiration_frameworks enable row level security;

create policy "inspiration_frameworks_all" on public.inspiration_frameworks
  for all to authenticated
  using (item_id in (select public.vault_visible_item_ids()))
  with check (item_id in (select public.vault_visible_item_ids()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. inspiration_tags — composite-PK item→tag mapping
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.inspiration_tags (
  item_id uuid not null references public.inspiration_items(id) on delete cascade,
  tag     text not null,
  primary key (item_id, tag)
);

create index if not exists inspiration_tags_tag_idx on public.inspiration_tags(tag);

alter table public.inspiration_tags enable row level security;

create policy "inspiration_tags_all" on public.inspiration_tags
  for all to authenticated
  using (item_id in (select public.vault_visible_item_ids()))
  with check (item_id in (select public.vault_visible_item_ids()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. item_embeddings — pgvector embeddings per item
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.item_embeddings (
  item_id    uuid primary key references public.inspiration_items(id) on delete cascade,
  embedding  vector(512),  -- text-embedding-3-small w/ dimensions=512
  model      text not null default 'openai/text-embedding-3-small',
  created_at timestamptz not null default now()
);

create index if not exists item_embeddings_hnsw_idx
  on public.item_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

alter table public.item_embeddings enable row level security;

create policy "item_embeddings_select" on public.item_embeddings
  for select to authenticated
  using (item_id in (select public.vault_visible_item_ids()));

-- Service role bypasses RLS for inserts/updates from background embedding job.

-- Semantic similarity helper
create or replace function public.match_items(
  query_embedding vector(512),
  match_threshold float default 0.5,
  match_count     int   default 20
)
returns table(item_id uuid, similarity float)
language sql
stable
security definer
set search_path = public
as $$
  select
    ie.item_id,
    1 - (ie.embedding <=> query_embedding) as similarity
  from public.item_embeddings ie
  where
    ie.item_id in (select public.vault_visible_item_ids())
    and 1 - (ie.embedding <=> query_embedding) > match_threshold
  order by ie.embedding <=> query_embedding
  limit match_count;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. boards — user-scoped collections of inspiration_items
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

create index if not exists boards_user_idx on public.boards(user_id);

alter table public.boards enable row level security;

create policy "boards_select" on public.boards
  for select to authenticated
  using (user_id = auth.uid());

create policy "boards_insert" on public.boards
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "boards_update" on public.boards
  for update to authenticated
  using (user_id = auth.uid());

create policy "boards_delete" on public.boards
  for delete to authenticated
  using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. board_items — junction table linking items to boards
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.board_items (
  id        uuid primary key default gen_random_uuid(),
  board_id  uuid not null references public.boards(id) on delete cascade,
  item_id   uuid not null references public.inspiration_items(id) on delete cascade,
  note      text,
  added_at  timestamptz not null default now(),
  unique(board_id, item_id)
);

create index if not exists board_items_board_idx on public.board_items(board_id);
create index if not exists board_items_item_idx  on public.board_items(item_id);

alter table public.board_items enable row level security;

-- Security-definer helper: boards owned by current user
create or replace function public.vault_owns_board(_board_id uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from public.boards where id = _board_id and user_id = auth.uid()
  )
$$;

create policy "board_items_select" on public.board_items
  for select to authenticated
  using (public.vault_owns_board(board_id));

create policy "board_items_insert" on public.board_items
  for insert to authenticated
  with check (public.vault_owns_board(board_id));

create policy "board_items_update" on public.board_items
  for update to authenticated
  using (public.vault_owns_board(board_id));

create policy "board_items_delete" on public.board_items
  for delete to authenticated
  using (public.vault_owns_board(board_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. slack_connections — per-user Slack OAuth state
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.slack_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  team_id        text not null,
  team_name      text not null,
  bot_token      text not null,
  signing_secret text not null,
  created_at     timestamptz not null default now(),
  unique(user_id, team_id)
);

create index if not exists slack_connections_user_idx on public.slack_connections(user_id);
create index if not exists slack_connections_team_idx on public.slack_connections(team_id);

alter table public.slack_connections enable row level security;

create policy "slack_connections_select" on public.slack_connections
  for select to authenticated
  using (user_id = auth.uid());

create policy "slack_connections_insert" on public.slack_connections
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "slack_connections_update" on public.slack_connections
  for update to authenticated
  using (user_id = auth.uid());

create policy "slack_connections_delete" on public.slack_connections
  for delete to authenticated
  using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. viral_feed_items — GLOBAL trending feed (no user_id; everyone reads)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.viral_feed_items (
  id             uuid primary key default gen_random_uuid(),
  platform       text not null,
  source_url     text not null,
  title          text,
  description    text,
  thumbnail_url  text,
  creator_handle text,
  view_count     bigint,
  like_count     bigint,
  share_count    bigint,
  category       text,          -- migration 020
  search_query   text not null default '',  -- migration 016
  fetched_at     timestamptz not null default now(),
  first_seen_at  timestamptz not null default now(),  -- migration 019
  is_saved       boolean not null default false,
  saved_item_id  uuid references public.inspiration_items(id) on delete set null,
  unique(source_url, search_query)
);

create index if not exists viral_feed_items_platform_idx
  on public.viral_feed_items(platform, fetched_at desc);
create index if not exists viral_feed_items_category_idx
  on public.viral_feed_items(category) where category is not null;
create index if not exists viral_feed_items_first_seen_idx
  on public.viral_feed_items(first_seen_at desc);

alter table public.viral_feed_items enable row level security;

-- Global feed: any authenticated user can read.
create policy "viral_feed_items_select" on public.viral_feed_items
  for select to authenticated
  using (true);

-- Authenticated users can mark items saved (is_saved flag + saved_item_id).
create policy "viral_feed_items_update" on public.viral_feed_items
  for update to authenticated
  using (true);

-- Insert / delete are service-role-only (cron job populates the feed).
-- No INSERT/DELETE policies for authenticated role — service role bypasses RLS.

-- =============================================================================
-- End of US-001 vault schema migration.
-- Data migration (ad_library_* → vault tables) follows in
-- 20260527000002_vault_data_migration.sql
-- =============================================================================
