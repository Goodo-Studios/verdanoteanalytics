-- US-008: Event-driven media cache queue (cache on new ads only).
--
-- Workstream 2, story 1. Introduces a queue that holds ONLY newly-discovered
-- ads pending media discovery/caching, so the media pipeline stops blindly
-- re-scanning every account every few minutes. Sync (Phase 1) enqueues exactly
-- the ad_ids it newly INSERTED into public.creatives this run (never the whole
-- account); the queue-drain path (existing enrich-thumbnails, and later the
-- dedicated worker in US-010/US-011) processes those ads, and already-cached
-- media is never re-downloaded (enrich-thumbnails short-circuits on
-- storage-hosted urls via its isStorageUrl guard).
--
-- Additive + backwards-compatible: nothing reads this table yet is forced to,
-- and the existing blind-fanout crons keep working until the WS2 cutover
-- (US-011) retires them. Idempotent (IF NOT EXISTS, DROP POLICY IF EXISTS,
-- CREATE OR REPLACE) so `supabase db push` re-runs are safe no-ops and the
-- ledger reconciles cleanly (per
-- verdanote-supabase-ledger-drift-reconcile-with-db-push).
--
-- No new edge function is introduced in this story, so
-- scripts/deploy-functions.sh and supabase/config.toml are intentionally
-- untouched (per verdanote-supabase-add-function policy — only a function
-- add/remove touches those files).

-- ── Table ────────────────────────────────────────────────────────────────────
-- One row per ad awaiting media caching. Keyed by ad_id so an ad is enqueued at
-- most once regardless of how many syncs touch it; ON CONFLICT DO NOTHING on the
-- enqueue side makes re-enqueue a cheap no-op. Rows are removed (or marked done)
-- by the drain path — an ad that is fully cached is never re-enqueued because it
-- is no longer newly-inserted on subsequent syncs.
CREATE TABLE IF NOT EXISTS public.media_cache_queue (
  ad_id        TEXT PRIMARY KEY REFERENCES public.creatives(ad_id) ON DELETE CASCADE,
  account_id   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | processing | done | failed
  attempts     INTEGER NOT NULL DEFAULT 0,
  enqueued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error   TEXT DEFAULT NULL
);

COMMENT ON TABLE public.media_cache_queue IS
  'US-008: Event-driven media caching queue. Holds ONLY ads newly inserted into public.creatives by a sync run (not whole-account fanout). The queue-drain path caches these ads once; already-cached media is never re-enqueued or re-downloaded. Retires the every-2-3-minute blind fanout scans (fully at WS2 cutover, US-011).';
COMMENT ON COLUMN public.media_cache_queue.ad_id IS
  'The newly-discovered ad awaiting media caching. PRIMARY KEY so an ad is enqueued at most once; enqueue uses ON CONFLICT DO NOTHING.';
COMMENT ON COLUMN public.media_cache_queue.status IS
  'pending = awaiting caching; processing = a drain worker claimed it; done = cached; failed = gave up after attempts. New ads enter as pending.';

-- Drain-order + per-account claim index. A worker pulls the oldest pending rows,
-- optionally scoped to one account.
CREATE INDEX IF NOT EXISTS idx_media_cache_queue_status_enqueued
  ON public.media_cache_queue (status, enqueued_at);
CREATE INDEX IF NOT EXISTS idx_media_cache_queue_account_status
  ON public.media_cache_queue (account_id, status);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Tenant isolation (HQ category-1): builders/employees manage; clients may only
-- read rows for accounts they are linked to. The service-role key used by sync
-- and the drain worker bypasses RLS entirely, so this policy set only guards any
-- future client-side read. No storage bucket is created here, so the
-- storage-bucket-RLS policy does not apply — this is a plain table.
ALTER TABLE public.media_cache_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builder/employee can manage media_cache_queue" ON public.media_cache_queue;
CREATE POLICY "Builder/employee can manage media_cache_queue"
  ON public.media_cache_queue FOR ALL
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

DROP POLICY IF EXISTS "Client can view linked media_cache_queue" ON public.media_cache_queue;
CREATE POLICY "Client can view linked media_cache_queue"
  ON public.media_cache_queue FOR SELECT
  USING (has_role(auth.uid(), 'client'::app_role) AND account_id IN (SELECT get_user_account_ids(auth.uid())));

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running this migration, confirm with:
--   SELECT status, count(*) FROM public.media_cache_queue GROUP BY status;
--   SELECT policyname FROM pg_policies WHERE tablename = 'media_cache_queue';
