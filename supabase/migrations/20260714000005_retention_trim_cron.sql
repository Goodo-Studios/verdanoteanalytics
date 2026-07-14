-- US-006: Nightly retention trim with safety buffer.
--
-- Bounds storage under the 365-day retention promise by deleting
-- creative_daily_metrics rows whose `date` is older than TRIM_BUFFER_DAYS=400
-- days (mirrors _shared/retention-config.ts TRIM_BUFFER_DAYS). 400 = the
-- 365-day promised window + a 35-day safety buffer, so rows within the last 365
-- days are NEVER at risk — only history that is already well beyond the promise
-- is trimmed. This is the storage-bounding counterpart to the one-time backfill
-- (US-004), which fills history back to RETENTION_DAYS=365.
--
-- Deletion is done through a SECURITY DEFINER function so the deleted row count
-- can be logged (RAISE LOG) on every run for observability, per the story's
-- "deletion counts are logged" acceptance criterion. The delete predicate is
-- expressed as `date < CURRENT_DATE - TRIM_BUFFER_DAYS` — a fixed 400-day floor
-- that can never reach into the in-year window.
--
-- CADENCE: nightly at 03:30 UTC (a quiet hour, offset from the scheduled-sync
-- and backfill crons to avoid contention). Because past daily rows are
-- immutable once the attribution window closes, a single nightly pass is ample.
--
-- Scheduling lives in this migration (NOT an HQ-session cron, which evaporates
-- at session end), mirroring 20260714000003_backfill_daily_history_cron.sql.
--
-- No new edge function is introduced, so scripts/deploy-functions.sh and
-- supabase/config.toml are intentionally untouched (per
-- verdanote-supabase-add-function policy — only function add/remove touches
-- those files).
--
-- Idempotent: CREATE OR REPLACE FUNCTION + unschedule-before-schedule, so
-- `supabase db push` re-runs are safe no-ops (per
-- verdanote-supabase-ledger-drift-reconcile-with-db-push).

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- ── Trim function ────────────────────────────────────────────────────────────
-- Deletes creative_daily_metrics rows older than the TRIM_BUFFER_DAYS=400 floor
-- and logs how many rows were removed. Returns the deleted count so the caller
-- (or a manual invocation) can observe it too.
CREATE OR REPLACE FUNCTION public.trim_creative_daily_metrics()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- TRIM_BUFFER_DAYS=400 (365-day promise + 35-day buffer). Kept in sync with
  -- _shared/retention-config.ts; SQL cannot import the TS constant, so the value
  -- is duplicated here with an explicit cross-reference.
  v_buffer_days constant integer := 400;
  v_cutoff      date;
  v_deleted     bigint;
BEGIN
  v_cutoff := CURRENT_DATE - v_buffer_days;

  DELETE FROM public.creative_daily_metrics
  WHERE date < v_cutoff;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE LOG 'trim_creative_daily_metrics: deleted % row(s) older than % (cutoff = CURRENT_DATE - % days)',
    v_deleted, v_cutoff, v_buffer_days;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.trim_creative_daily_metrics() IS
  'US-006: Nightly retention trim. Deletes creative_daily_metrics rows with date older than TRIM_BUFFER_DAYS=400 days (365-day promise + 35-day buffer), so rows within the last 365 days are never deleted. Logs and returns the deleted row count. Scheduled by the retention-trim-nightly pg_cron job.';

-- Trim is an internal maintenance operation invoked only by pg_cron (superuser)
-- and manual admin runs. Revoke from client roles to keep it off the API surface.
REVOKE ALL ON FUNCTION public.trim_creative_daily_metrics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trim_creative_daily_metrics() FROM anon;
REVOKE ALL ON FUNCTION public.trim_creative_daily_metrics() FROM authenticated;

-- ── Unschedule any previous registration (idempotent) ───────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job WHERE jobname = 'retention-trim-nightly'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$$;

-- ── Nightly retention trim — 03:30 UTC ──────────────────────────────────────
SELECT cron.schedule(
  'retention-trim-nightly',
  '30 3 * * *',
  $$ SELECT public.trim_creative_daily_metrics() $$
);

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running this migration, confirm with:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'retention-trim-nightly';
-- Inspect deletion counts in the Postgres logs (RAISE LOG lines), or run the
-- trim on demand with:  SELECT public.trim_creative_daily_metrics();
