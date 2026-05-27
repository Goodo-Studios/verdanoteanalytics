-- =============================================================================
-- US-001: Data migration ad_library_* → vault tables
-- =============================================================================
-- Copies all existing ad_library data into the new vault tables created in
-- 20260527000001_vault_schema.sql. Wrapped in a single transaction so partial
-- failures roll back cleanly. Each step is idempotent via on conflict.
--
-- Mapping summary (per PRD US-001 + resolved open questions):
--   ad_library_saved_ads   → inspiration_items                  (id preserved)
--   ad_library_saved_ads   → inspiration_transcripts            (if transcript present)
--   ad_library_boards      → boards                             (id preserved)
--   ad_library_board_ads   → board_items                        (board_id+ad_id)
--   ad_library_tags(+ad_tags) → inspiration_tags                (item_id+tag name)
--   ad_library_folders     → boards   (one new board per folder; ads from
--                                       any child board attached as items)
--
-- ad_library_* tables are NOT dropped here — they are deprecated and scheduled
-- for sunset on 2026-08-01 (US-013).
-- =============================================================================

do $$
declare
  v_saved_count        bigint;
  v_items_count        bigint;
  v_boards_in_count    bigint;
  v_boards_out_count   bigint;
  v_folders_count      bigint;
  v_folder_boards_made bigint;
begin

  -- Guard: skip the whole migration if ad_library_saved_ads doesn't exist
  -- (fresh installs that never had Verdanote's Ad Library tables).
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ad_library_saved_ads'
  ) then
    raise notice 'ad_library_saved_ads not present — skipping data migration.';
    return;
  end if;

  -- ─── 1. ad_library_saved_ads → inspiration_items ────────────────────────
  -- Preserves the original id so existing references (e.g. ad_library_board_ads.ad_id)
  -- continue to resolve into inspiration_items.
  insert into public.inspiration_items (
    id,
    user_id,
    source_url,
    platform,
    creator_handle,
    title,
    thumbnail_url,
    video_url,
    status,
    ad_archive_id,
    ad_body_text,
    brand_name,
    ad_format,
    created_at
  )
  select
    s.id,
    s.user_id,
    coalesce(s.source_url, ''),
    coalesce(s.platform, 'facebook'),
    s.advertiser_name,                           -- creator_handle
    coalesce(s.headline, s.advertiser_name),     -- title
    s.thumbnail_url,
    -- video_url: first element of media_urls if any
    case
      when s.media_urls is not null and array_length(s.media_urls, 1) > 0
        then s.media_urls[1]
      else null
    end,
    case when s.transcript is not null then 'ready' else 'pending' end,
    s.ad_id,
    s.body_text,
    s.advertiser_name,
    s.ad_format,
    s.created_at
  from public.ad_library_saved_ads s
  on conflict (id) do nothing;

  -- Per-row transcripts (only when the legacy column was populated).
  insert into public.inspiration_transcripts (item_id, raw_transcript, created_at)
  select s.id, s.transcript, s.created_at
  from public.ad_library_saved_ads s
  where s.transcript is not null and s.transcript <> ''
  on conflict do nothing;

  -- ─── 2. ad_library_boards → boards ──────────────────────────────────────
  -- Preserves id so ad_library_board_ads.board_id maps directly.
  insert into public.boards (id, user_id, name, description, created_at)
  select b.id, b.user_id, b.name, b.description, b.created_at
  from public.ad_library_boards b
  on conflict (id) do nothing;

  -- ─── 3. ad_library_board_ads → board_items ──────────────────────────────
  -- ba.ad_id references ad_library_saved_ads.id, which we just copied into
  -- inspiration_items (id preserved). FK is satisfied.
  -- The unique(board_id, item_id) constraint dedupes.
  insert into public.board_items (board_id, item_id, added_at)
  select ba.board_id, ba.ad_id, ba.added_at
  from public.ad_library_board_ads ba
  -- Only include rows whose board and item actually exist post-migration.
  where exists (select 1 from public.boards         where id = ba.board_id)
    and exists (select 1 from public.inspiration_items where id = ba.ad_id)
  on conflict (board_id, item_id) do nothing;

  -- ─── 4. ad_library_tags + ad_library_ad_tags → inspiration_tags ─────────
  -- Resolves tag id → tag name via ad_library_tags.
  insert into public.inspiration_tags (item_id, tag)
  select at.ad_id, t.name
  from public.ad_library_ad_tags at
  join public.ad_library_tags t on t.id = at.tag_id
  where exists (select 1 from public.inspiration_items where id = at.ad_id)
  on conflict (item_id, tag) do nothing;

  -- ─── 5. ad_library_folders → boards (folder-as-board) ───────────────────
  -- Each folder becomes a new board OWNED BY THE FOLDER OWNER. The board id
  -- is freshly generated (folder id ≠ board id) so no collision with already-
  -- migrated ad_library_boards. We use the folder.id literal as a stable seed
  -- by inserting with a deterministic id derived from it — uuid_generate_v5
  -- isn't available without uuid-ossp, so we use gen_random_uuid() and rely
  -- on the on conflict do nothing guard via name+user_id uniqueness check.
  --
  -- To keep this idempotent, we skip folders that already have a board with
  -- a matching name for the same user (assumed previously-migrated).
  insert into public.boards (id, user_id, name, description, created_at)
  select
    gen_random_uuid(),
    f.user_id,
    f.name,
    coalesce(f.description, 'Migrated from Ad Library folder'),
    f.created_at
  from public.ad_library_folders f
  where not exists (
    -- Skip if any board already exists for this user with same name (idempotency).
    select 1 from public.boards b
    where b.user_id = f.user_id and b.name = f.name
  );

  -- Attach saved ads to each folder-board. An ad belongs to a folder iff it
  -- belongs to at least one board whose folder_id matches the folder. We
  -- look up the folder-board by (user_id, name) since we generated random ids.
  insert into public.board_items (board_id, item_id, added_at)
  select distinct
    fb.id           as board_id,
    ba.ad_id        as item_id,
    now()           as added_at
  from public.ad_library_folders f
  join public.ad_library_boards ab on ab.folder_id = f.id
  join public.ad_library_board_ads ba on ba.board_id = ab.id
  join public.boards fb on fb.user_id = f.user_id and fb.name = f.name
  where exists (select 1 from public.inspiration_items where id = ba.ad_id)
  on conflict (board_id, item_id) do nothing;

  -- ─── 6. Verification counts ─────────────────────────────────────────────
  select count(*) into v_saved_count        from public.ad_library_saved_ads;
  select count(*) into v_items_count        from public.inspiration_items;
  select count(*) into v_boards_in_count    from public.ad_library_boards;
  select count(*) into v_boards_out_count   from public.boards;
  select count(*) into v_folders_count      from public.ad_library_folders;

  raise notice 'vault data migration complete:';
  raise notice '  ad_library_saved_ads → inspiration_items : %  →  %', v_saved_count, v_items_count;
  raise notice '  ad_library_boards    → boards (incl. folder-boards): %  →  %', v_boards_in_count, v_boards_out_count;
  raise notice '  ad_library_folders   → folder-boards: %', v_folders_count;

  -- Acceptance criteria: row count in inspiration_items >= ad_library_saved_ads.
  if v_items_count < v_saved_count then
    raise exception
      'vault migration row-count check failed: inspiration_items (%) < ad_library_saved_ads (%)',
      v_items_count, v_saved_count;
  end if;
end$$;

-- =============================================================================
-- End of vault data migration.
-- =============================================================================
