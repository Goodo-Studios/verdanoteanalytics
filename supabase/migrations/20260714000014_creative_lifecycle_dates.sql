-- F2 (Creative age / lifecycle dates) — additive, idempotent schema.
--
-- Materializes each ad's lifecycle timeline on public.creatives so downstream
-- reports (Creative Rotation, Fatigue Curve, Winners, Library sort, "new ads
-- added over time") compute creative age from explicit dates rather than from
-- spend alone. This is the SHARED F2 foundation consumed by multiple parallel
-- reports — keep it minimal and additive so parallel branches reconcile cleanly.
--
-- Columns (all nullable; population is best-effort/derivable):
--   * launch_date      — the day the ad was actually created on Meta. Derived
--                        from the EXISTING creatives.created_time column (Meta ad
--                        `created_time`, already synced). A backfill edge fn
--                        (backfill-launch-dates) repopulates created_time for any
--                        older ad that predates that field, and this column is
--                        re-derived from it.
--   * first_added_date — the first day OUR sync saw the ad. Approximated as the
--                        earliest of creative_daily_metrics.date and the ad's own
--                        created_at (our DB insert time). Derived via SQL.
--   * first_spend_date — the earliest creative_daily_metrics.date with spend > 0.
--                        Derived via SQL.
-- account tenure (days live) is NOT stored — it is a function of the live
-- account clock (now() - launch_date) and is computed on query in the RPC/report
-- so it never goes stale. Storing it would require a daily rewrite for no gain.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Re-applying is a no-op. Additive only —
-- no existing column is altered or dropped.

ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS launch_date      date,
  ADD COLUMN IF NOT EXISTS first_added_date date,
  ADD COLUMN IF NOT EXISTS first_spend_date date;

COMMENT ON COLUMN public.creatives.launch_date IS
  'F2: day the ad was created on Meta (date of creatives.created_time). Launch/age anchor.';
COMMENT ON COLUMN public.creatives.first_added_date IS
  'F2: first day our sync saw the ad (min of earliest creative_daily_metrics.date and created_at).';
COMMENT ON COLUMN public.creatives.first_spend_date IS
  'F2: earliest creative_daily_metrics.date with spend > 0 for the ad.';

-- Index for launch-cohort grouping and "new ads over time" timeline scans.
CREATE INDEX IF NOT EXISTS idx_creatives_account_launch_date
  ON public.creatives (account_id, launch_date);

-- ── Derivation RPC ──────────────────────────────────────────────────────────
-- Recomputes the three lifecycle-date columns for one account from the data we
-- already hold: launch_date from creatives.created_time, first_spend_date /
-- first_added_date from creative_daily_metrics. Idempotent (CREATE OR REPLACE);
-- safe to re-run after each sync or backfill. Returns the number of ad rows
-- touched. SECURITY DEFINER writer that trusts p_account_id — it only WRITES the
-- caller's account rows (no cross-account read exposure) and is invoked by
-- trusted server contexts (the backfill fn / cron), so EXECUTE is granted to
-- service_role only (see GRANTs below).
CREATE OR REPLACE FUNCTION public.derive_creative_lifecycle_dates(
  p_account_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  touched integer := 0;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'derive_creative_lifecycle_dates: p_account_id is required';
  END IF;

  WITH daily AS (
    SELECT
      m.ad_id                                                       AS ad_id,
      MIN(m.date)                                                   AS first_daily_date,
      MIN(m.date) FILTER (WHERE m.spend > 0)                        AS first_spend_date
    FROM public.creative_daily_metrics m
    WHERE m.account_id = p_account_id
    GROUP BY m.ad_id
  ),
  upd AS (
    UPDATE public.creatives c
    SET
      launch_date      = (c.created_time AT TIME ZONE 'UTC')::date,
      first_spend_date = d.first_spend_date,
      -- Earliest signal we have of the ad existing in our world: the earliest
      -- daily metric row, or our own insert time if no daily rows yet.
      first_added_date = LEAST(
        COALESCE(d.first_daily_date, (c.created_at AT TIME ZONE 'UTC')::date),
        (c.created_at AT TIME ZONE 'UTC')::date
      )
    FROM daily d
    WHERE c.account_id = p_account_id
      AND d.ad_id = c.ad_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO touched FROM upd;

  -- Ads with no daily rows yet (never delivered): still anchor launch_date /
  -- first_added_date from the columns we already hold, so the timeline is
  -- complete. first_spend_date stays NULL (correctly — no spend yet).
  UPDATE public.creatives c
  SET
    launch_date      = (c.created_time AT TIME ZONE 'UTC')::date,
    first_added_date = (c.created_at AT TIME ZONE 'UTC')::date
  WHERE c.account_id = p_account_id
    AND NOT EXISTS (
      SELECT 1 FROM public.creative_daily_metrics m
      WHERE m.account_id = p_account_id AND m.ad_id = c.ad_id
    );

  RETURN touched;
END;
$$;

COMMENT ON FUNCTION public.derive_creative_lifecycle_dates(text) IS
  'F2: recompute launch_date / first_added_date / first_spend_date on public.creatives for one account from creatives.created_time + creative_daily_metrics. Idempotent; run after sync/backfill.';

-- IDOR: this writer trusts p_account_id, so authenticated must NOT execute it.
REVOKE ALL ON FUNCTION public.derive_creative_lifecycle_dates(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.derive_creative_lifecycle_dates(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.derive_creative_lifecycle_dates(text) TO service_role;
