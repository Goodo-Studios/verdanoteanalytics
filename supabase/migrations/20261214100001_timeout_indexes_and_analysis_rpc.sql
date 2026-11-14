-- Statement timeouts seen on production after the 2026-11-14 release (see
-- docs/proposals/production-query-timeouts.md for the plans and numbers).
--
-- 1. creative_daily_metrics had no index on date alone. The app's all-accounts trend query
--    (date >= 14 days ago, order by date, 1000 rows a page) read the whole (account_id, date)
--    index and fetched about 28,000 pages, 9.7 s against the 8 s limit of the authenticated role.
-- 2. next_creative_analysis_account() checked every creative of every enabled account for pending
--    work (4,229 rows removed per account, 8.9 s). A partial index holds only the rows that can
--    count as work, and the function now names that condition so the planner can use the index.
--
-- Plain CREATE INDEX (not CONCURRENTLY) because a migration runs in a transaction. It blocks
-- writes to the two tables while it builds, which takes seconds at this size (721k and 52k rows).
-- Everything is safe to run again. The function returns the same rows as before: the added
-- analysis_status IN (...) condition is implied by the original OR.

CREATE INDEX IF NOT EXISTS idx_daily_metrics_date
  ON public.creative_daily_metrics (date);

CREATE INDEX IF NOT EXISTS creatives_analysis_work_idx
  ON public.creatives (account_id)
  WHERE analysis_status IN ('pending', 'analyzing');

CREATE OR REPLACE FUNCTION public.next_creative_analysis_account()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT a.id
  FROM public.ad_accounts a
  WHERE a.creative_analysis_enabled
    -- has un-analyzed work: fresh pending OR a stale 'analyzing' orphan to heal.
    AND EXISTS (
      SELECT 1 FROM public.creatives c
      WHERE c.account_id = a.id
        AND c.analysis_status IN ('pending', 'analyzing')
        AND (c.analysis_status = 'pending' OR c.updated_at < now() - interval '4 minutes')
    )
    -- not already at/over its budget cap
    AND NOT EXISTS (
      SELECT 1 FROM public.creative_analysis_spend s
      WHERE s.account_id = a.id AND s.spent_usd >= s.cap_usd
    )
  ORDER BY a.id
  LIMIT 1;
$function$;

-- CREATE OR REPLACE keeps the existing grants on the function.
