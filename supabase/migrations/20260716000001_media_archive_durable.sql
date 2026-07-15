-- F3 — Durable per-account media archive + full creative payload + bulk export.
--
-- PLACEHOLDER migration number 20260716000001 — the orchestrator renumbers this
-- to the next free slot and runs `supabase db push`. See MIGRATIONS.md.
--
-- WHAT THIS EXTENDS (explicit reconciliation with the just-completed retention
-- work — roadmap §6.3): the existing media_assets table (migration
-- 20260714000007) is a per-account CACHE for within-account dedupe. It has NO
-- durability SLA — the retention-trim cron (20260714000005) and media GC can
-- reclaim cached bytes. F3 layers a DURABILITY promise on top WITHOUT
-- duplicating the vault or re-storing bytes:
--
--   • media_archive: one row per (account_id, ad_id) that PROMISES the ad's
--     media is permanently kept. It REFERENCES the shared media_assets row(s)
--     (thumb_asset_id / video_asset_id) rather than re-storing bytes, and stamps
--     retention='keep' so any future trim/GC skips referenced assets. It also
--     captures the SAME rich payload the Creative Vault gets on save —
--     transcript/script, extracted framework/analysis, and the performance
--     snapshot — at ARCHIVE time, so "Save to Creative Vault" is a cheap
--     duplicate of data we already hold (no re-scrape, no re-analyze).
--
--   • media_archive_export_jobs: tracks one-click BULK ZIP export requests
--     (selected creatives -> a single downloadable zip built by the
--     creative-media-archive edge fn from the durably-archived storage copies).
--
-- Tenant boundary (HQ category-1): everything is keyed by account_id and the
-- storage paths it points at already embed account_id (media_assets contract) —
-- no cross-account sharing. RLS mirrors media_assets exactly.
--
-- Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS) + additive. Numbered before
-- 20260716000002 so get_creative_library (which LEFT JOINs media_archive) sees
-- this table.

-- ── media_archive ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.media_archive (
  id              UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  ad_id           TEXT NOT NULL REFERENCES public.creatives(ad_id) ON DELETE CASCADE,
  -- Reference the shared cached assets (no byte duplication). Nullable: an
  -- image-only creative has no video asset; a row may be created before both
  -- assets are cached and backfilled later.
  thumb_asset_id  UUID REFERENCES public.media_assets(id) ON DELETE SET NULL,
  video_asset_id  UUID REFERENCES public.media_assets(id) ON DELETE SET NULL,
  -- Durability promise. 'keep' = never trim/GC the referenced assets. A future
  -- policy could set 'expired' to release them; the retention-trim job reads this.
  retention       TEXT NOT NULL DEFAULT 'keep' CHECK (retention IN ('keep', 'expired')),
  -- Rich payload captured at archive time (mirrors what the vault gets on save),
  -- so Save-to-Vault reuses it instead of re-scraping/re-analyzing.
  transcript          TEXT,
  framework           JSONB,
  performance_snapshot JSONB,
  -- Denormalized media locations for fast bulk-export path building without a
  -- media_assets join (kept in sync when the archive row is written).
  thumb_storage_path  TEXT,
  video_storage_path  TEXT,
  thumb_bucket        TEXT,
  video_bucket        TEXT,
  byte_size           BIGINT,
  archived_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One durable archive row per creative within an account.
  CONSTRAINT media_archive_account_ad_unique UNIQUE (account_id, ad_id)
);

COMMENT ON TABLE public.media_archive IS
  'F3: durable per-account media archive. One row per (account_id, ad_id) that PROMISES the ad''s media is permanently kept, REFERENCING shared media_assets rows (no byte duplication) with retention=keep so trim/GC skips them. Captures transcript/framework/performance_snapshot at archive time so Save-to-Vault reuses the payload without re-scraping. Extends media_assets (cache) — does NOT duplicate the vault.';
COMMENT ON COLUMN public.media_archive.retention IS
  'keep = referenced media_assets bytes are protected from the retention-trim/GC job (durability SLA). expired = released.';
COMMENT ON COLUMN public.media_archive.framework IS
  'Extracted framework/analysis captured at archive time (same shape the vault frameworks hold), so Save-to-Vault duplicates rather than re-analyzes.';

CREATE INDEX IF NOT EXISTS idx_media_archive_account ON public.media_archive (account_id);
CREATE INDEX IF NOT EXISTS idx_media_archive_ad ON public.media_archive (ad_id);
CREATE INDEX IF NOT EXISTS idx_media_archive_retention ON public.media_archive (account_id, retention);

-- ── media_archive_export_jobs ────────────────────────────────────────────────
-- One-click bulk-zip export tracking. The creative-media-archive edge fn creates
-- a job, streams the selected creatives' durable media into a single zip, uploads
-- it, and marks the job ready with a signed download URL.
CREATE TABLE IF NOT EXISTS public.media_archive_export_jobs (
  id            UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  requested_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ad_ids        TEXT[] NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'building', 'ready', 'error')),
  zip_path      TEXT,        -- storage object path of the built zip
  zip_bucket    TEXT,        -- bucket the zip lives in
  file_count    INTEGER NOT NULL DEFAULT 0,
  byte_size     BIGINT,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

COMMENT ON TABLE public.media_archive_export_jobs IS
  'F3: one-click bulk-zip export of selected creatives'' durably-archived media. The creative-media-archive edge fn (service_role) builds the zip from media_archive storage paths and marks the job ready with a signed URL. Keyed by account_id (tenant boundary).';

CREATE INDEX IF NOT EXISTS idx_export_jobs_account ON public.media_archive_export_jobs (account_id, created_at DESC);

-- ── updated_at trigger (reuse existing helper if present) ────────────────────
-- Many tables in this schema use a shared set_updated_at()/update_updated_at
-- trigger. Guard defensively: only attach if the helper exists, so this
-- migration never fails on a DB that names the helper differently.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    DROP TRIGGER IF EXISTS trg_media_archive_updated_at ON public.media_archive;
    CREATE TRIGGER trg_media_archive_updated_at
      BEFORE UPDATE ON public.media_archive
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END$$;

-- ── RLS (mirrors media_assets 20260714000007) ───────────────────────────────
-- Service-role edge fns bypass RLS. These policies guard client-side reads only:
-- builders/employees manage; clients read rows for accounts they are linked to.
ALTER TABLE public.media_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builder/employee can manage media_archive" ON public.media_archive;
CREATE POLICY "Builder/employee can manage media_archive"
  ON public.media_archive FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

DROP POLICY IF EXISTS "Client can view linked media_archive" ON public.media_archive;
CREATE POLICY "Client can view linked media_archive"
  ON public.media_archive FOR SELECT
  USING (has_role(auth.uid(), 'client'::app_role) AND account_id IN (SELECT get_user_account_ids(auth.uid())));

ALTER TABLE public.media_archive_export_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builder/employee can manage export_jobs" ON public.media_archive_export_jobs;
CREATE POLICY "Builder/employee can manage export_jobs"
  ON public.media_archive_export_jobs FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

DROP POLICY IF EXISTS "Client can view linked export_jobs" ON public.media_archive_export_jobs;
CREATE POLICY "Client can view linked export_jobs"
  ON public.media_archive_export_jobs FOR SELECT
  USING (has_role(auth.uid(), 'client'::app_role) AND account_id IN (SELECT get_user_account_ids(auth.uid())));

-- ── creative-archive storage bucket (private, service-role write) ────────────
-- The bulk-export zips live in their own PRIVATE bucket, read only via signed
-- URLs (never public) and written only by the service-role edge fn — matching
-- the inspiration-media privacy model. Per the storage-bucket-needs-RLS policy,
-- a client-readable bucket needs RLS; here nothing is client-UPLOADED (writes are
-- service-role only, which bypasses RLS), and downloads use signed URLs, so we
-- add explicit SELECT/INSERT policies scoped to the bucket for defense in depth.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('creative-archive', 'creative-archive', false, 2147483648)  -- 2GB zip cap
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Service role manages creative-archive" ON storage.objects;
CREATE POLICY "Service role manages creative-archive"
  ON storage.objects FOR ALL
  USING (bucket_id = 'creative-archive' AND (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role)))
  WITH CHECK (bucket_id = 'creative-archive' AND (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role)));

-- ── Verify ────────────────────────────────────────────────────────────────
--   SELECT account_id, count(*) FROM public.media_archive GROUP BY account_id;
--   SELECT policyname FROM pg_policies WHERE tablename IN ('media_archive','media_archive_export_jobs');
--   SELECT id, public FROM storage.buckets WHERE id = 'creative-archive';
