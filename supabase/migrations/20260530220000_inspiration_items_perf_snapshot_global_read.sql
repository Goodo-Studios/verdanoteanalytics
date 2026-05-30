-- =============================================================================
-- save-ad-to-vault US-001: Performance snapshot + source tracking + global read
-- =============================================================================
-- Prepares inspiration_items to receive analytics creatives saved as swipe-file
-- inspiration:
--   1. performance_snapshot JSONB  — frozen analytics metrics captured at save
--      time (spend, roas, cpa, thumb_stop_rate, hold_rate, retention_pNN, ...).
--   2. source_ad_id / source_account_id — the analytics creatives identity, used
--      for dedupe against the GLOBAL library. (Distinct from ad_archive_id, which
--      is the Meta Ad Library archive id used by the URL/scrape ingestion path.)
--   3. saved_by — attribution of which user saved the item. Reads stay global,
--      but we preserve who saved each item.
--   4. RLS: SELECT becomes global (any authenticated user reads every item) per
--      verdanote-creative-vault-library-is-global-not-user-scoped. INSERT / UPDATE
--      / DELETE stay user-scoped (owner = user_id) so users can't tamper with
--      others' items.
--   5. Dedupe index on source_ad_id (global, partial — only saved analytics ads).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE INDEX
-- IF NOT EXISTS — safe to re-apply (no-op against existing objects).
-- Verdanote project_id = gwyxaqoaldnaavkjqquv.
-- =============================================================================

-- ─── 1. Performance snapshot JSONB ───────────────────────────────────────────
alter table public.inspiration_items
  add column if not exists performance_snapshot jsonb;

comment on column public.inspiration_items.performance_snapshot is
  'Analytics performance metrics frozen at save time (spend, roas, cpa, thumb_stop_rate, hold_rate, retention_p25/50/75/100, prior_roas, etc.). Null for non-analytics items.';

-- ─── 2. Source analytics identity (dedupe) ───────────────────────────────────
alter table public.inspiration_items
  add column if not exists source_ad_id text;
alter table public.inspiration_items
  add column if not exists source_account_id text;

comment on column public.inspiration_items.source_ad_id is
  'creatives.ad_id of the analytics ad this item was saved from. Used for dedupe-by-ad_id against the global library.';
comment on column public.inspiration_items.source_account_id is
  'creatives.account_id of the analytics ad this item was saved from.';

-- ─── 3. Attribution (reads are global; preserve who saved each item) ─────────
alter table public.inspiration_items
  add column if not exists saved_by uuid references auth.users(id) on delete set null;

comment on column public.inspiration_items.saved_by is
  'User who saved this item. Reads are global; this records attribution.';

-- ─── 4. Global-read RLS ──────────────────────────────────────────────────────
-- The Creative Vault library is GLOBAL: any authenticated user can read every
-- item. Writes remain owner-scoped (user_id = auth.uid()).
drop policy if exists "inspiration_items_select" on public.inspiration_items;
create policy "inspiration_items_select" on public.inspiration_items
  for select to authenticated
  using (true);

-- INSERT / UPDATE / DELETE stay owner-scoped. Re-assert idempotently so the
-- policy set is fully defined by this migration even on a fresh apply ordering.
drop policy if exists "inspiration_items_insert" on public.inspiration_items;
create policy "inspiration_items_insert" on public.inspiration_items
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "inspiration_items_update" on public.inspiration_items;
create policy "inspiration_items_update" on public.inspiration_items
  for update to authenticated
  using (user_id = auth.uid());

drop policy if exists "inspiration_items_delete" on public.inspiration_items;
create policy "inspiration_items_delete" on public.inspiration_items
  for delete to authenticated
  using (user_id = auth.uid());

-- ─── 5. Dedupe index on source_ad_id (GLOBAL, partial) ───────────────────────
-- Dedupe is against the whole library, not per-user, so this index is NOT
-- prefixed by user_id (unlike inspiration_items_ad_archive_id_idx).
create index if not exists inspiration_items_source_ad_id_idx
  on public.inspiration_items(source_ad_id)
  where source_ad_id is not null;

-- =============================================================================
-- End of save-ad-to-vault US-001 migration.
-- =============================================================================
