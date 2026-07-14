-- US-009: Creative-level media dedupe WITHIN an account.
--
-- Workstream 2, story 2. A single creative (video/image) is frequently reused
-- across many ads in the same account. Before this story every ad owned its own
-- per-ad file (ad-thumbnails/<account>/<adId>.jpg, ad-videos/<account>/<adId>.mp4),
-- so the identical bytes were downloaded from Meta and stored once PER AD. This
-- introduces a per-account asset registry so the same creative is stored exactly
-- once within an account and every ad using it references the shared copy.
--
-- Tenant boundary (HQ category-1): dedupe is WITHIN-ACCOUNT ONLY. The registry is
-- keyed by (account_id, asset_key) and the storage path embeds account_id, so the
-- same creative appearing in two different accounts stores its own copy per
-- account — never a cross-account shared file. This deliberately differs from the
-- creative *vault* library, which is global (per
-- verdanote-creative-vault-library-is-global-not-user-scoped): the vault is a
-- product-level shared library, whereas this cache is per-tenant storage and must
-- respect the account boundary.
--
-- asset_key is the SHA-256 content hash of the downloaded bytes (stable across ads
-- that reuse the identical creative, and format-agnostic — it dedupes image and
-- video alike without needing a Meta creative/video id on the creatives row, which
-- we do not currently store). Content-hash keying also survives Meta re-issuing a
-- new CDN URL for the same underlying asset.
--
-- Additive + backwards-compatible: creatives keep their existing thumbnail_url /
-- full_res_url / video_url columns (still the render source of truth); the new
-- *_asset_id FKs are nullable back-references populated by the cache path. Nothing
-- is forced to read media_assets. Idempotent (IF NOT EXISTS, DROP POLICY IF
-- EXISTS) so `supabase db push` re-runs are safe no-ops and the ledger reconciles
-- cleanly (per verdanote-supabase-ledger-drift-reconcile-with-db-push).
--
-- No new edge function is introduced in this story (cache-creative-image already
-- exists), so scripts/deploy-functions.sh and supabase/config.toml are
-- intentionally untouched (per verdanote-supabase-add-function policy — only a
-- function add/remove touches those files).

-- ── Table ────────────────────────────────────────────────────────────────────
-- One row per unique stored asset within an account. UNIQUE(account_id, asset_key)
-- is the dedupe key: a second ad whose media hashes to an already-registered
-- asset_key reuses the existing row (and its storage_path) instead of downloading
-- and storing the bytes again.
CREATE TABLE IF NOT EXISTS public.media_assets (
  id            UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  asset_key     TEXT NOT NULL,                       -- SHA-256 content hash of the stored bytes
  media_type    TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  bucket        TEXT NOT NULL,                       -- ad-thumbnails | ad-videos
  storage_path  TEXT NOT NULL,                       -- <account_id>/assets/<asset_key>.<ext>
  public_url    TEXT NOT NULL,                       -- fully-qualified public storage URL
  byte_size     BIGINT,
  content_type  TEXT,
  ref_count     INTEGER NOT NULL DEFAULT 0,          -- how many creatives reference this asset
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Within-account dedupe key. Same bytes in a different account => different row
  -- (account_id differs) => its own stored copy. No cross-tenant sharing.
  CONSTRAINT media_assets_account_key_unique UNIQUE (account_id, asset_key)
);

COMMENT ON TABLE public.media_assets IS
  'US-009: Per-account media asset registry for within-account creative dedupe. One row per unique stored copy, keyed by (account_id, asset_key=SHA-256 content hash). Creatives that reuse the same media reference the shared asset via creatives.video_asset_id / thumb_asset_id instead of each owning a per-ad file. Dedupe is WITHIN-ACCOUNT ONLY (storage_path embeds account_id) to preserve tenant isolation — the same creative in two accounts stores one copy per account.';
COMMENT ON COLUMN public.media_assets.asset_key IS
  'SHA-256 hex content hash of the stored bytes. Stable across ads reusing the identical creative and across Meta CDN URL re-issues; format-agnostic (dedupes image and video without a Meta creative/video id).';
COMMENT ON COLUMN public.media_assets.storage_path IS
  'Object path within the bucket, keyed by asset within the account: <account_id>/assets/<asset_key>.<ext>. Embedding account_id guarantees no cross-account path collision.';
COMMENT ON COLUMN public.media_assets.ref_count IS
  'Number of creatives referencing this asset. Incremented when a creative links the asset; lets a later GC drop unreferenced assets.';

CREATE INDEX IF NOT EXISTS idx_media_assets_account
  ON public.media_assets (account_id);

-- ── Creatives back-references ────────────────────────────────────────────────
-- Each creative points at the shared asset it uses (nullable — legacy per-ad
-- files predate this and are backfilled lazily as ads are re-cached). ON DELETE
-- SET NULL so dropping an asset row never cascades into losing the creative.
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS thumb_asset_id UUID
    REFERENCES public.media_assets(id) ON DELETE SET NULL;
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS video_asset_id UUID
    REFERENCES public.media_assets(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.creatives.thumb_asset_id IS
  'US-009: FK to the shared per-account image/thumbnail asset in media_assets. NULL for creatives not yet re-cached under the dedupe path.';
COMMENT ON COLUMN public.creatives.video_asset_id IS
  'US-009: FK to the shared per-account video asset in media_assets. NULL for image-only creatives or those not yet re-cached under the dedupe path.';

CREATE INDEX IF NOT EXISTS idx_creatives_thumb_asset ON public.creatives (thumb_asset_id);
CREATE INDEX IF NOT EXISTS idx_creatives_video_asset ON public.creatives (video_asset_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Tenant isolation (HQ category-1): builders/employees manage; clients may only
-- read asset rows for accounts they are linked to. The service-role key used by
-- cache-creative-image bypasses RLS entirely, so this policy set only guards a
-- future client-side read. No NEW storage bucket is created here (assets reuse the
-- existing ad-thumbnails / ad-videos buckets, which are already public-read and
-- written only via service-role edge functions), so the
-- storage-bucket-needs-RLS-for-client-uploads policy does not add a new bucket
-- requirement here — this migration guards a plain table.
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builder/employee can manage media_assets" ON public.media_assets;
CREATE POLICY "Builder/employee can manage media_assets"
  ON public.media_assets FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

DROP POLICY IF EXISTS "Client can view linked media_assets" ON public.media_assets;
CREATE POLICY "Client can view linked media_assets"
  ON public.media_assets FOR SELECT
  USING (has_role(auth.uid(), 'client'::app_role) AND account_id IN (SELECT get_user_account_ids(auth.uid())));

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running this migration, confirm with:
--   SELECT account_id, count(*) FROM public.media_assets GROUP BY account_id;
--   SELECT policyname FROM pg_policies WHERE tablename = 'media_assets';
--   \d public.creatives  -- thumb_asset_id / video_asset_id present
