-- Extend rpc_media_coverage with THUMBNAIL coverage buckets + sample URLs.
--
-- Why: grid thumbnails render blank even though the old health check reported
-- ">60% thumbnail coverage". That check counted any non-null, non-sentinel
-- thumbnail_url as "covered" — but a set URL can still be a dead CDN link or a
-- dangling storage object (404), which renders blank. Same lesson as video. We
-- need the thumbnail_url state broken out the same way, plus a few sample storage
-- URLs to actually fetch-validate the objects behind them.

-- Return type changes, so REPLACE is not allowed — drop then recreate.
DROP FUNCTION IF EXISTS public.rpc_media_coverage();

CREATE OR REPLACE FUNCTION public.rpc_media_coverage()
RETURNS TABLE (
  account_id     text,
  total          bigint,
  playable       bigint,
  sentinel       bigint,
  null_url       bigint,
  cdn_only       bigint,
  thumb_storage  bigint,
  thumb_null     bigint,
  thumb_sentinel bigint,
  thumb_cdn      bigint,
  sample_thumbs  text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.account_id,
    count(*) FILTER (WHERE coalesce(c.spend,0) > 0) AS total,
    count(*) FILTER (WHERE coalesce(c.spend,0) > 0
      AND c.video_url LIKE '%/storage/v1/object/public/%') AS playable,
    count(*) FILTER (WHERE coalesce(c.spend,0) > 0 AND c.video_url = 'no-video') AS sentinel,
    count(*) FILTER (WHERE coalesce(c.spend,0) > 0 AND c.video_url IS NULL) AS null_url,
    count(*) FILTER (WHERE coalesce(c.spend,0) > 0
      AND c.video_url IS NOT NULL AND c.video_url <> 'no-video'
      AND c.video_url NOT LIKE '%/storage/v1/object/public/%') AS cdn_only,
    -- Thumbnail buckets (same spend>0 basis)
    count(*) FILTER (WHERE coalesce(c.spend,0) > 0
      AND c.thumbnail_url LIKE '%/storage/v1/object/public/%') AS thumb_storage,
    count(*) FILTER (WHERE coalesce(c.spend,0) > 0 AND c.thumbnail_url IS NULL) AS thumb_null,
    count(*) FILTER (WHERE coalesce(c.spend,0) > 0 AND c.thumbnail_url = 'no-thumbnail') AS thumb_sentinel,
    count(*) FILTER (WHERE coalesce(c.spend,0) > 0
      AND c.thumbnail_url IS NOT NULL AND c.thumbnail_url <> 'no-thumbnail'
      AND c.thumbnail_url NOT LIKE '%/storage/v1/object/public/%') AS thumb_cdn,
    -- Up to 3 storage thumbnail URLs to fetch-validate the objects behind them.
    (array_agg(c.thumbnail_url) FILTER (WHERE coalesce(c.spend,0) > 0
      AND c.thumbnail_url LIKE '%/storage/v1/object/public/%'))[1:3] AS sample_thumbs
  FROM creatives c
  GROUP BY c.account_id;
$$;

REVOKE ALL ON FUNCTION public.rpc_media_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_media_coverage() TO service_role;
