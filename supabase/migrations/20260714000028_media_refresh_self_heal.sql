-- US-005 (meta-media-completeness): CDN-expiry auto-refresh — self-healing media.
--
-- Goal: media should re-cache itself before/after Meta CDN links expire, so older
-- ads never rot to a dead image/video URL. The hard constraint (prd nonGoals +
-- US-005 notes): DO NOT re-introduce the blind-fanout refresh crons retired in
-- US-011. Refresh MUST be a BOUNDED, PRIORITIZED, queue-style poller — never a scan
-- over every account every few minutes.
--
-- ── Architecture (reuse the US-008/US-010/US-011 queue, don't rebuild it) ─────
-- The event-driven media pipeline already has the right machinery:
--   • public.media_cache_queue (US-008) — one row per ad awaiting media caching.
--   • public.claim_media_cache_queue (US-010) — atomic FOR UPDATE SKIP LOCKED batch
--     claim with a stale-claim self-heal.
--   • the drain-media-queue edge fn (US-010) — bounded (BATCH_SIZE=5), self-chaining,
--     streaming, content-hash-deduped worker that actually downloads + caches. A
--     re-cache of an item whose bytes are already stored is a NO-OP (US-009 dedupe).
--   • the drain-media-queue-2min pg_cron (US-010) — keeps the queue draining.
--
-- So US-005 does NOT add a second downloader. It adds the missing SELF-HEALING
-- FEEDER: a bounded, prioritized poller that periodically RE-ENQUEUES the ads whose
-- media has rotted (or was never cached), oldest-unverified first, into the SAME
-- queue. The existing drain then re-caches them; dedupe makes still-valid items a
-- no-op. This is the queue-style poller the story asks for, not a blind fanout.
--
-- This migration is the DB half:
--   1. public.creatives.media_last_refresh_at — the "last verified/refreshed" clock
--      that gives the poller a stable OLDEST-FIRST ordering (NULLs = never verified,
--      picked first). Additive column; the poller stamps it on every ad it enqueues
--      so the same rows are not re-picked on the very next poll.
--   2. public.enqueue_media_refresh_candidates(p_limit, p_max_attempts) — the BOUNDED,
--      PRIORITIZED re-enqueue RPC. Selects eligible-but-not-covered ads from the
--      existing public.media_coverage view whose failure_reason is RE-CACHEABLE rot
--      (video_uncached = live CDN url never cached; image_low_res / image_missing;
--      video_unresolved = still re-attemptable), EXCLUDING the terminal residual
--      (video_permission / video_deleted — genuinely unresolvable, never churned).
--      Honors the existing exponential backoff gate (thumb_retry_after /
--      video_retry_after) so sentineled/failed items are retried on the 1h→7d
--      schedule, never abandoned and never hammered. Inserts into media_cache_queue
--      (ON CONFLICT re-arms a done/failed row whose backoff elapsed) and stamps
--      media_last_refresh_at. Returns a count so the edge fn can decide to self-chain.
--   3. public.media_coverage_snapshots + public.snapshot_media_coverage() — an
--      observable coverage time-series (AC#4): each snapshot records the current
--      get_media_coverage(NULL) aggregate + per-account rows. A drop in covered% is
--      then detectable by comparing the two latest aggregate snapshots (the edge fn
--      does this and fires the Slack alert).
--   4. public.latest_coverage_regression() — helper the edge fn calls to get the
--      delta between the two most recent aggregate snapshots (so the alert logic is
--      single-sourced in SQL, not duplicated in TS).
--   5. pg_cron: refresh-media-queue-15min (pokes the new refresh-media-queue edge fn,
--      a conservative background cadence — this is a self-healer, not a hot path) and
--      media-coverage-snapshot-hourly (records the coverage time-series). The refresh
--      edge fn itself is added by backend-dev (config.toml + deploy-functions.sh),
--      so this migration does NOT touch those files (per verdanote-supabase-add-
--      function — only a function add/remove touches them).
--
-- Additive + idempotent: ADD COLUMN / CREATE ... IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, unschedule-before-schedule. Re-running `supabase db push` is a safe
-- no-op that reconciles the ledger cleanly (per
-- verdanote-supabase-ledger-drift-reconcile-with-db-push).
--
-- Numbering: 20260714000028 follows the latest applied migration
-- (…000027_creative_frames), whose media_coverage view + creative_frames table this
-- migration reads, so ordering is preserved (per
-- verdanote-supabase-migration-numbering-order-before-references).

-- ── Extensions (defensive; already present) ──────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── 1. Oldest-unverified ordering clock ───────────────────────────────────────
-- The poller needs a stable "least-recently-verified" signal to page through the
-- rotted set oldest-first without re-picking the same rows each poll. No existing
-- column captures "when did we last (re)confirm this ad's media?" — last_media_sync
-- is account-scoped (set by the retired refresh-thumbnails round-robin), not per-ad.
-- media_last_refresh_at is per-ad: NULL = never verified by this self-healer (picked
-- FIRST), else the timestamp the poller last enqueued it. The poller stamps it on
-- enqueue and orders by it ASC NULLS FIRST, so the oldest-unverified ads drain first
-- and the poller advances through the backlog deterministically.
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS media_last_refresh_at timestamptz;

COMMENT ON COLUMN public.creatives.media_last_refresh_at IS
  'US-005 (meta-media-completeness): per-ad "last media (re)verification" clock for the self-healing refresh poller. NULL = never checked by the poller (highest priority, picked first). Stamped by enqueue_media_refresh_candidates on every ad it re-enqueues, so the poller pages through the rotted set OLDEST-FIRST (ORDER BY media_last_refresh_at ASC NULLS FIRST) without re-picking the same rows every poll.';

-- Partial index over the re-cacheable candidate space, ordered oldest-first. The
-- poller only ever scans not-yet-cached / rotted ads, so index exactly the ordering
-- key (keeps the index small and the poller's ORDER BY ... LIMIT cheap).
CREATE INDEX IF NOT EXISTS idx_creatives_media_last_refresh
  ON public.creatives (media_last_refresh_at ASC NULLS FIRST);

-- ── 2. Bounded, prioritized re-enqueue RPC ────────────────────────────────────
-- The self-healing FEEDER. Picks up to p_limit eligible-but-not-covered ads whose
-- media has rotted / was never cached, OLDEST-UNVERIFIED FIRST, honoring the
-- existing exponential backoff, and (re-)enqueues them into media_cache_queue for
-- the existing drain worker to re-cache. Bounded work per call (p_limit); the edge
-- fn self-chains while candidates remain (like drain-media-queue). Re-caching a
-- still-valid item is a no-op downstream via content-hash dedupe (US-009).
--
-- Re-cacheable failure_reason set (from public.media_coverage, US-001/003/004):
--   • 'video_uncached'  — a live Meta CDN url that was never cached (the core
--                         CDN-expiry rot: the url works now but will 404 when the
--                         time-limited fbcdn link expires). PRIMARY US-005 target.
--   • 'image_low_res' / 'image_missing' — image never cached at full-res / missing.
--   • 'video_unresolved' — generic 'no-video' sentinel, still re-attemptable.
-- EXCLUDED (terminal residual, AC#4 — never churned):
--   • 'video_permission' / 'video_deleted' — genuinely unresolvable under our access.
--   • 'frames_incomplete' — a carousel-frame gap owned by the US-004 sync path, not a
--                           CDN-expiry re-cache; re-enqueuing it here would not help.
--
-- Backoff gate: a sentineled/failed ad carries a thumb_retry_after / video_retry_after
-- in the future while inside its exponential-backoff window (1h→4h→12h→1d→3d→7d). We
-- SKIP such rows so they are retried on schedule (AC#3) rather than hammered, but
-- never abandoned — once the window elapses they become eligible again.
--
-- Enqueue semantics: INSERT ... ON CONFLICT (ad_id). A brand-new candidate inserts as
-- 'pending'. A candidate whose prior queue row is 'done'/'failed' AND whose backoff
-- has elapsed is RE-ARMED to 'pending' (attempts reset) so failed items are retried
-- (AC#3). A row already 'pending'/'processing' is left untouched (do-nothing) so we
-- never disturb an in-flight claim.
--
-- SECURITY DEFINER + pinned search_path + service_role-only grant, mirroring
-- claim_media_cache_queue.
CREATE OR REPLACE FUNCTION public.enqueue_media_refresh_candidates(
  p_limit         integer DEFAULT 100,
  p_max_attempts  integer DEFAULT 5
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now       timestamptz := now();
  v_enqueued  integer := 0;
BEGIN
  WITH candidates AS (
    SELECT c.ad_id, c.account_id
    FROM public.media_coverage mc
    JOIN public.creatives c ON c.ad_id = mc.ad_id
    WHERE NOT mc.covered
      -- Only RE-CACHEABLE rot; never the terminal residual or a frames gap.
      AND mc.failure_reason IN (
        'video_uncached', 'image_low_res', 'image_missing', 'video_unresolved'
      )
      -- Respect the existing exponential backoff (AC#3): skip an ad still inside its
      -- image OR video backoff window. NULL retry_after = due now (never/last cleared).
      AND (c.thumb_retry_after IS NULL OR c.thumb_retry_after <= v_now)
      AND (c.video_retry_after IS NULL OR c.video_retry_after <= v_now)
    -- OLDEST-UNVERIFIED FIRST (AC#1): never-checked (NULL) ahead of least-recently
    -- checked. Deterministic tiebreak on ad_id so paging is stable across polls.
    ORDER BY c.media_last_refresh_at ASC NULLS FIRST, c.ad_id ASC
    LIMIT GREATEST(p_limit, 0)
  ),
  enqueue AS (
    INSERT INTO public.media_cache_queue (ad_id, account_id, status, attempts, enqueued_at, updated_at)
    SELECT cand.ad_id, cand.account_id, 'pending', 0, v_now, v_now
    FROM candidates cand
    ON CONFLICT (ad_id) DO UPDATE
      SET status      = 'pending',
          attempts    = 0,
          enqueued_at  = v_now,
          updated_at   = v_now,
          last_error   = NULL
      -- Re-arm ONLY a settled row (done/failed) — never disturb an in-flight
      -- pending/processing claim. This is what makes failed items retried (AC#3)
      -- without double-processing an ad the drain worker already holds.
      WHERE public.media_cache_queue.status IN ('done', 'failed')
    RETURNING ad_id
  ),
  stamp AS (
    -- Stamp the verification clock on EVERY candidate we considered enqueuing (even
    -- one whose queue row was left in-flight), so the poller advances past them and
    -- pages to the next oldest batch on the following poll rather than re-picking.
    UPDATE public.creatives c
    SET media_last_refresh_at = v_now
    FROM candidates cand
    WHERE c.ad_id = cand.ad_id
    RETURNING c.ad_id
  )
  SELECT COUNT(*) INTO v_enqueued FROM stamp;

  RETURN COALESCE(v_enqueued, 0);
END;
$$;

COMMENT ON FUNCTION public.enqueue_media_refresh_candidates(integer, integer) IS
  'US-005 (meta-media-completeness): bounded, prioritized self-healing feeder for the media_cache_queue. Picks up to p_limit eligible-but-not-covered ads with a RE-CACHEABLE failure_reason (video_uncached / image_low_res / image_missing / video_unresolved — NOT the terminal video_permission/video_deleted nor frames_incomplete), OLDEST-UNVERIFIED FIRST (creatives.media_last_refresh_at ASC NULLS FIRST), honoring the existing exponential backoff (thumb_retry_after/video_retry_after), and (re-)enqueues them into media_cache_queue for the existing drain-media-queue worker. Re-arms only settled (done/failed) queue rows; never disturbs an in-flight claim. Stamps media_last_refresh_at so paging advances. Returns the number stamped/considered. NOT a blind fanout — the queue-style bounded poller that replaces the retired US-011 fanout crons.';

-- Only the service role (the refresh-media-queue worker) may run the feeder.
REVOKE ALL ON FUNCTION public.enqueue_media_refresh_candidates(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_media_refresh_candidates(integer, integer) TO service_role;

-- ── 3. Coverage-regression observability (AC#4) ───────────────────────────────
-- A lightweight time-series of the US-001 coverage metric. Each snapshot row records
-- one get_media_coverage(NULL) result row (the aggregate row has account_id NULL,
-- plus one row per account). A drop in the aggregate covered% between consecutive
-- snapshots is a coverage regression — detectable by latest_coverage_regression()
-- and alerted by the edge fn.
CREATE TABLE IF NOT EXISTS public.media_coverage_snapshots (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id       TEXT,                              -- NULL = aggregate (all accounts)
  total            BIGINT   NOT NULL,
  covered          BIGINT   NOT NULL,
  coverage_pct     NUMERIC  NOT NULL,
  failure_reasons  JSONB    NOT NULL DEFAULT '{}'::jsonb,
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.media_coverage_snapshots IS
  'US-005 (meta-media-completeness): observable coverage time-series (AC#4). One row per get_media_coverage(NULL) result at snapshot time (account_id NULL = aggregate, plus one row per account). Written by snapshot_media_coverage(); a drop in the aggregate coverage_pct between consecutive snapshots is a regression, surfaced by latest_coverage_regression() and alerted by the refresh-media-queue edge fn.';

-- Fetch-the-latest-per-scope index (aggregate lookup + per-account history).
CREATE INDEX IF NOT EXISTS idx_media_coverage_snapshots_scope_time
  ON public.media_coverage_snapshots (account_id, captured_at DESC);

-- RLS: builders/employees read; the service role writes (bypasses RLS). No client
-- read path is needed, so no client policy (keeps the surface minimal).
ALTER TABLE public.media_coverage_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builder/employee can read media_coverage_snapshots" ON public.media_coverage_snapshots;
CREATE POLICY "Builder/employee can read media_coverage_snapshots"
  ON public.media_coverage_snapshots FOR SELECT
  USING (has_role(auth.uid(), 'builder'::app_role) OR has_role(auth.uid(), 'employee'::app_role));

-- Record one snapshot (aggregate + per-account) from the current coverage metric.
CREATE OR REPLACE FUNCTION public.snapshot_media_coverage()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ts     timestamptz := now();
  v_rows   integer := 0;
BEGIN
  WITH inserted AS (
    INSERT INTO public.media_coverage_snapshots
      (account_id, total, covered, coverage_pct, failure_reasons, captured_at)
    SELECT g.account_id, g.total, g.covered, g.coverage_pct, g.failure_reasons, v_ts
    FROM public.get_media_coverage(NULL) g
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rows FROM inserted;
  RETURN COALESCE(v_rows, 0);
END;
$$;

COMMENT ON FUNCTION public.snapshot_media_coverage() IS
  'US-005 (meta-media-completeness): record one media-coverage snapshot (aggregate + per-account) into public.media_coverage_snapshots from get_media_coverage(NULL). Called by the media-coverage-snapshot-hourly cron. Returns the number of rows written.';

REVOKE ALL ON FUNCTION public.snapshot_media_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snapshot_media_coverage() TO service_role;

-- Regression helper: the delta between the two most recent AGGREGATE snapshots.
-- Returns one row; regressed = the newer coverage_pct dropped by more than
-- p_threshold_pct points vs the prior snapshot. Single-sources the regression
-- definition in SQL so the edge fn's alert logic stays thin.
CREATE OR REPLACE FUNCTION public.latest_coverage_regression(
  p_threshold_pct numeric DEFAULT 1.0
)
RETURNS TABLE (
  regressed         boolean,
  prev_pct          numeric,
  curr_pct          numeric,
  delta_pct         numeric,
  prev_captured_at  timestamptz,
  curr_captured_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH agg AS (
    SELECT coverage_pct, captured_at
    FROM public.media_coverage_snapshots
    WHERE account_id IS NULL            -- aggregate rows only
    ORDER BY captured_at DESC
    LIMIT 2
  ),
  ranked AS (
    SELECT coverage_pct, captured_at,
           ROW_NUMBER() OVER (ORDER BY captured_at DESC) AS rn
    FROM agg
  ),
  pair AS (
    SELECT
      (SELECT coverage_pct FROM ranked WHERE rn = 2) AS prev_pct,
      (SELECT captured_at  FROM ranked WHERE rn = 2) AS prev_captured_at,
      (SELECT coverage_pct FROM ranked WHERE rn = 1) AS curr_pct,
      (SELECT captured_at  FROM ranked WHERE rn = 1) AS curr_captured_at
  )
  SELECT
    -- regressed only when we have both snapshots AND the drop exceeds the threshold.
    (p.prev_pct IS NOT NULL
      AND p.curr_pct IS NOT NULL
      AND (p.prev_pct - p.curr_pct) > p_threshold_pct)          AS regressed,
    p.prev_pct,
    p.curr_pct,
    (p.curr_pct - p.prev_pct)                                    AS delta_pct,
    p.prev_captured_at,
    p.curr_captured_at
  FROM pair p;
$$;

COMMENT ON FUNCTION public.latest_coverage_regression(numeric) IS
  'US-005 (meta-media-completeness): compare the two most recent AGGREGATE media_coverage_snapshots. regressed = TRUE when both exist and the newer aggregate coverage_pct dropped by more than p_threshold_pct points vs the prior. Single-sources the coverage-regression definition (AC#4) so the refresh-media-queue edge fn''s Slack alert logic stays thin.';

REVOKE ALL ON FUNCTION public.latest_coverage_regression(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.latest_coverage_regression(numeric) TO service_role;

-- ── 4. Schedules ──────────────────────────────────────────────────────────────
-- refresh-media-queue-15min: pokes the new refresh-media-queue edge fn (bounded
-- feeder + self-chain). Conservative cadence — a background self-healer, not a hot
-- path; the drain-media-queue-2min cron (US-010) does the heavy caching. A poke that
-- finds nothing to refresh is a cheap no-op (feeder enqueues 0, edge fn chains none).
-- Unschedule-by-name first (idempotent replay), exactly like drain-media-queue-2min.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'refresh-media-queue-15min'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'refresh-media-queue-15min',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://gwyxaqoaldnaavkjqquv.supabase.co/functions/v1/refresh-media-queue',
      headers := json_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      )::jsonb,
      body    := '{}'::jsonb
    )
  $$
);

-- media-coverage-snapshot-hourly: record the coverage time-series so a regression is
-- observable (AC#4). Runs snapshot_media_coverage() directly in-DB (no edge fn) on
-- the hour. Unschedule-by-name first for idempotent replay.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'media-coverage-snapshot-hourly'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'media-coverage-snapshot-hourly',
  '7 * * * *',
  $$ SELECT public.snapshot_media_coverage() $$
);

-- ── Verify (run manually after push) ──────────────────────────────────────────
--   -- Column + index present:
--   \d public.creatives            -- media_last_refresh_at column exists
--   -- Feeder enqueues a bounded batch of oldest-unverified rotted ads:
--   SELECT public.enqueue_media_refresh_candidates(10);   -- returns count
--   SELECT status, count(*) FROM public.media_cache_queue GROUP BY status;
--   -- Snapshot + regression helper:
--   SELECT public.snapshot_media_coverage();              -- returns rows written
--   SELECT * FROM public.latest_coverage_regression(1.0); -- one row, regressed bool
--   -- Only ONE new media scheduler beyond the US-010 drain (no fanout resurrected):
--   SELECT jobname, schedule FROM cron.job
--   WHERE jobname IN ('refresh-media-queue-15min','media-coverage-snapshot-hourly');
