-- Fast per-account media (video) coverage in a SINGLE grouped query.
--
-- Why: system-health-check previously computed video coverage with ~4 PostgREST
-- count() round-trips PER account (×16 accounts = 60+ calls), several using a
-- leading-wildcard LIKE on video_url (seq scans). Under any DB load that blew past
-- the request timeout, making the health check — and any convergence probe built
-- on it — unusable. This RPC replaces all of that with one GROUP BY over creatives
-- using FILTER aggregates: a single seq scan, milliseconds, one round-trip.
--
-- Buckets (all restricted to spend > 0, matching the dashboard's Data Health):
--   playable  — video_url is a Supabase storage URL (plays in-app)
--   sentinel  — video_url = 'no-video' (discovery found none)
--   null_url  — video_url IS NULL (video discovery never attempted)
--   cdn_only  — video_url set but a raw (non-storage) CDN url — discovered, not yet
--               cached; expires → unplayable. This is the bucket the drain targets.

CREATE OR REPLACE FUNCTION public.rpc_media_coverage()
RETURNS TABLE (
  account_id text,
  total      bigint,
  playable   bigint,
  sentinel   bigint,
  null_url   bigint,
  cdn_only   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.account_id,
    count(*) FILTER (WHERE coalesce(c.spend, 0) > 0) AS total,
    count(*) FILTER (WHERE coalesce(c.spend, 0) > 0
      AND c.video_url LIKE '%/storage/v1/object/public/%') AS playable,
    count(*) FILTER (WHERE coalesce(c.spend, 0) > 0
      AND c.video_url = 'no-video') AS sentinel,
    count(*) FILTER (WHERE coalesce(c.spend, 0) > 0
      AND c.video_url IS NULL) AS null_url,
    count(*) FILTER (WHERE coalesce(c.spend, 0) > 0
      AND c.video_url IS NOT NULL
      AND c.video_url <> 'no-video'
      AND c.video_url NOT LIKE '%/storage/v1/object/public/%') AS cdn_only
  FROM creatives c
  GROUP BY c.account_id;
$$;

-- Only the service role (system-health-check edge fn) calls this. Not exposed to
-- anon/authenticated — those go through the existing edge function surface.
REVOKE ALL ON FUNCTION public.rpc_media_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_media_coverage() TO service_role;
