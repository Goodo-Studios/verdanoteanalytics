-- Add a "mismarked" bucket to media coverage: creatives flagged no-video that
-- actually ARE videos (video_avg_play_time > 0 — a metric only videos have). These
-- are discovery false-negatives to recover via force-video re-discovery.
DROP FUNCTION IF EXISTS public.rpc_media_coverage();
CREATE OR REPLACE FUNCTION public.rpc_media_coverage()
RETURNS TABLE (
  account_id text, total bigint, playable bigint, sentinel bigint, null_url bigint,
  cdn_only bigint, thumb_storage bigint, thumb_null bigint, thumb_sentinel bigint,
  thumb_cdn bigint, sample_thumbs text[], mismarked bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.account_id,
    count(*) FILTER (WHERE coalesce(c.spend,0)>0),
    count(*) FILTER (WHERE coalesce(c.spend,0)>0 AND c.video_url LIKE '%/storage/v1/object/public/%'),
    count(*) FILTER (WHERE coalesce(c.spend,0)>0 AND c.video_url='no-video'),
    count(*) FILTER (WHERE coalesce(c.spend,0)>0 AND c.video_url IS NULL),
    count(*) FILTER (WHERE coalesce(c.spend,0)>0 AND c.video_url IS NOT NULL AND c.video_url<>'no-video' AND c.video_url NOT LIKE '%/storage/v1/object/public/%'),
    count(*) FILTER (WHERE coalesce(c.spend,0)>0 AND c.thumbnail_url LIKE '%/storage/v1/object/public/%'),
    count(*) FILTER (WHERE coalesce(c.spend,0)>0 AND c.thumbnail_url IS NULL),
    count(*) FILTER (WHERE coalesce(c.spend,0)>0 AND c.thumbnail_url='no-thumbnail'),
    count(*) FILTER (WHERE coalesce(c.spend,0)>0 AND c.thumbnail_url IS NOT NULL AND c.thumbnail_url<>'no-thumbnail' AND c.thumbnail_url NOT LIKE '%/storage/v1/object/public/%'),
    (array_agg(c.thumbnail_url) FILTER (WHERE coalesce(c.spend,0)>0 AND c.thumbnail_url LIKE '%/storage/v1/object/public/%'))[1:3],
    count(*) FILTER (WHERE coalesce(c.spend,0)>0 AND c.video_url='no-video' AND coalesce(c.video_avg_play_time,0)>0)
  FROM creatives c GROUP BY c.account_id;
$$;
REVOKE ALL ON FUNCTION public.rpc_media_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_media_coverage() TO service_role;
