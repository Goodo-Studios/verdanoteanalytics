-- Audit 8.7: backfill-post-urls and backfill-launch-dates stop re-fetching rows Meta
-- cannot resolve.
--
-- Both functions select creatives still missing ad_post_url / created_time. An ad Meta
-- returns no story id or created_time for stays missing, so it was fetched again on every
-- run. These columns record when a row was last checked without a result; the functions
-- skip rows checked in the last 7 days (same release). NULL means never checked.
-- Additive only.

ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS post_url_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS launch_date_checked_at timestamptz;

COMMENT ON COLUMN public.creatives.post_url_checked_at IS
  'Audit 8.7: when backfill-post-urls last asked Meta for this ad and got no post URL. Rechecked after 7 days.';
COMMENT ON COLUMN public.creatives.launch_date_checked_at IS
  'Audit 8.7: when backfill-launch-dates last asked Meta for this ad and got no created_time. Rechecked after 7 days.';
