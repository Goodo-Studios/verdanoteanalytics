-- =============================================================================
-- US-013: Deprecate ad_library_* tables
-- =============================================================================
-- All UI surfaces and queries now read from the vault schema (inspiration_items,
-- boards, board_items, inspiration_tags, inspiration_transcripts) created in
-- 20260527000001_vault_schema.sql and populated by 20260527000002_vault_data_migration.sql.
--
-- This migration:
--   1. Adds a DEPRECATED comment to each ad_library_* table marking them as
--      safe-to-drop after 2026-08-01 (~60-day sunset window from merge).
--   2. Does NOT drop, rename, or otherwise alter any data — the old tables
--      remain as a safety backup for the deprecation window.
--
-- A future cleanup migration (post-2026-08-01) will drop these tables once we
-- have evidence they are no longer referenced by any application code, RLS
-- policy, edge function, or third-party integration.
--
-- See verification report: workspace/reports/vault-migration-verification.md
-- =============================================================================

do $$
declare
  v_deprecated_comment constant text :=
    'DEPRECATED — data migrated to vault schema via US-001 (20260527000002_vault_data_migration.sql). Safe to drop after 2026-08-01.';
  v_table_name text;
  v_tables constant text[] := array[
    'ad_library_saved_ads',
    'ad_library_boards',
    'ad_library_board_ads',
    'ad_library_folders',
    'ad_library_tags',
    'ad_library_ad_tags',
    'ad_library_collections',
    'ad_library_collection_items'
  ];
begin
  foreach v_table_name in array v_tables loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = v_table_name
    ) then
      execute format(
        'comment on table public.%I is %L',
        v_table_name,
        v_deprecated_comment
      );
      raise notice 'deprecation comment applied to public.%', v_table_name;
    else
      raise notice 'skipped public.% (table not present)', v_table_name;
    end if;
  end loop;
end$$;

-- =============================================================================
-- End of ad_library deprecation migration.
-- =============================================================================
