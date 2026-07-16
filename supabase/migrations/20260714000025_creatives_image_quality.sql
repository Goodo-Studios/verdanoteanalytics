-- US-002 (meta-media-completeness): Full-resolution static image guarantee —
-- let creatives rows track whether the cached image is full-res or a low-res
-- (~130px thumbnail_url) placeholder.
--
-- Backs US-002 acceptance criterion #2: "creatives rows track whether the cached
-- image is full-res vs low-res placeholder". This migration adds ONE column,
-- public.creatives.image_quality, an explicit enum-like text signal:
--   'full_res' — a real, full-resolution asset is cached for this creative.
--   'low_res'  — the only image on file is the ~130px creative.thumbnail_url
--                last-resort fallback (see discoverImageUrl Strategy 6).
--   NULL       — not yet classified / no image at all.
--
-- ── Why a text column and NOT a boolean ──────────────────────────────────────
-- An explicit enum-like text column is more expressive than a boolean: it
-- distinguishes "full_res" vs "low_res" vs "unknown/NULL" (a boolean can only say
-- yes/no and cannot represent "never classified"). This is a COMPLEMENTARY,
-- human-readable signal and a backfill / re-discovery target — it does NOT replace
-- full_res_url. The US-001 media_coverage view/RPC keep keying image_ok off
-- `full_res_url IS NOT NULL AND full_res_url <> 'no-thumbnail'` and are LEFT
-- UNCHANGED here; image_quality sits alongside them so a human (or the US-002
-- re-discovery job) can see, per row, which cached images are still placeholders.
--
-- Additive + idempotent + backwards-compatible: ADD COLUMN IF NOT EXISTS, a named
-- CHECK constraint added only when absent, IF NOT EXISTS index, and an UPDATE-only
-- backfill. Nothing is forced to read the column, and re-running `supabase db push`
-- is a safe no-op that reconciles the ledger cleanly (per
-- verdanote-supabase-ledger-drift-reconcile-with-db-push).
--
-- No edge function is added, so scripts/deploy-functions.sh and
-- supabase/config.toml are intentionally untouched (per
-- verdanote-supabase-add-function policy).
--
-- Numbering: 20260714000025 follows the latest applied migration
-- (…000024_media_coverage_view) so ordering is preserved (migration-numbering-order).

-- ── Column ───────────────────────────────────────────────────────────────────
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS image_quality text;

-- Named CHECK constraint restricting the domain to the enum-like values (NULL
-- allowed = not yet classified). Added guarded so re-running is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'creatives_image_quality_check'
      AND conrelid = 'public.creatives'::regclass
  ) THEN
    ALTER TABLE public.creatives
      ADD CONSTRAINT creatives_image_quality_check
      CHECK (image_quality IN ('full_res', 'low_res'));
  END IF;
END $$;

COMMENT ON COLUMN public.creatives.image_quality IS
  'US-002 (meta-media-completeness): quality of the cached static image for this creative. ''full_res'' = a real full-resolution asset is cached; ''low_res'' = only the ~130px thumbnail_url fallback is on file (a placeholder to be re-discovered); NULL = not yet classified / no image. Complementary, human-readable signal + re-discovery backfill target; does NOT replace full_res_url (the US-001 media_coverage view still keys image_ok off full_res_url).';

-- ── Backfill existing rows ───────────────────────────────────────────────────
-- Classify already-synced creatives using the same signals the US-001 view uses:
--   full_res  — a real (non-sentinel) full_res_url is cached.
--   low_res   — no real full_res_url, but a real (non-sentinel) thumbnail_url
--               exists (the ~130px placeholder is the only image on file).
-- Everything else (no image at all) is left NULL. WHERE image_quality IS NULL
-- keeps the backfill idempotent and non-destructive on re-run — it never
-- overwrites a value already set (e.g. by the US-002 backend classifier).
--
-- Lift the per-statement timeout for THIS migration's transaction only. The
-- one-time backfill scans the full creatives table, which exceeds the remote's
-- default statement_timeout on production-sized data. SET LOCAL is scoped to the
-- migration transaction and reverts automatically at COMMIT — it does not change
-- any session/role default. Idempotent: re-running only touches rows still NULL.
SET LOCAL statement_timeout = 0;

UPDATE public.creatives
SET image_quality = 'full_res'
WHERE image_quality IS NULL
  AND full_res_url IS NOT NULL
  AND full_res_url <> 'no-thumbnail';

UPDATE public.creatives
SET image_quality = 'low_res'
WHERE image_quality IS NULL
  AND (full_res_url IS NULL OR full_res_url = 'no-thumbnail')
  AND thumbnail_url IS NOT NULL
  AND thumbnail_url <> 'no-thumbnail';

-- ── Index ────────────────────────────────────────────────────────────────────
-- Partial index making the US-002 backfill / re-discovery query (find the
-- low-res placeholders that still need a full-res asset) cheap. Keyed on
-- account_id because re-discovery runs per account and the index only spans the
-- (typically small, shrinking) low_res working set.
CREATE INDEX IF NOT EXISTS idx_creatives_low_res
  ON public.creatives (account_id)
  WHERE image_quality = 'low_res';

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running this migration, confirm with:
--   SELECT image_quality, count(*) FROM public.creatives GROUP BY image_quality;
--   -- the low-res working set the US-002 re-discovery job targets:
--   SELECT account_id, count(*) FROM public.creatives
--     WHERE image_quality = 'low_res' GROUP BY account_id ORDER BY count(*) DESC;
--   -- CHECK constraint present + domain enforced:
--   SELECT conname FROM pg_constraint WHERE conname = 'creatives_image_quality_check';
--   -- Partial index present:
--   SELECT indexname FROM pg_indexes WHERE indexname = 'idx_creatives_low_res';
-- Invariant: image_quality is one of 'full_res' | 'low_res' | NULL, and every row
-- with a real cached full_res_url is 'full_res' (unless later reclassified).
