-- =============================================================================
-- Atria saved-ads import: dedupe column
-- =============================================================================
-- One-off backfill (vault-import-atria edge fn) pulls every ad the workspace has
-- saved in Atria (GET /open/v1/ad-library/saved) into the Creative Vault. Atria's
-- own ad id (m*/t*-prefixed) is the reliable per-source dedupe key — distinct from
-- ad_archive_id (the Meta Ad Library archive id, which Atria also gives us for
-- Meta-platform ads as platform_native_id, and which we still populate/cross-check
-- so an Atria-sourced item isn't duplicated against one already scraped via the
-- Facebook Ad Library URL path).
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) —
-- safe to re-apply. Manual `supabase db push --linked` (CI does not run
-- migrations). Verdanote project_id = gwyxaqoaldnaavkjqquv.
-- =============================================================================

alter table public.inspiration_items
  add column if not exists source_atria_id text;

comment on column public.inspiration_items.source_atria_id is
  'Atria''s own ad id (m*/t*-prefixed) for items imported from GET /open/v1/ad-library/saved. Global dedupe key for the Atria import job — distinct from ad_archive_id and source_ad_id.';

-- Dedupe is against the whole library (not per-user), matching the
-- source_ad_id precedent from the save-ad-to-vault migration.
create index if not exists inspiration_items_source_atria_id_idx
  on public.inspiration_items(source_atria_id)
  where source_atria_id is not null;

-- =============================================================================
-- End of Atria import dedupe-column migration.
-- =============================================================================
