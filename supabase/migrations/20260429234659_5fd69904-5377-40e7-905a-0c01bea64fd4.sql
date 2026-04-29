CREATE OR REPLACE FUNCTION public.bulk_update_creative_metadata(payload jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_count integer := 0;
  item jsonb;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(payload)
  LOOP
    UPDATE public.creatives SET
      ad_name = COALESCE(item->>'ad_name', ad_name),
      ad_status = COALESCE(item->>'ad_status', ad_status),
      campaign_name = item->>'campaign_name',
      adset_name = item->>'adset_name',
      ad_post_url = COALESCE(item->>'ad_post_url', ad_post_url),
      created_time = COALESCE((item->>'created_time')::timestamptz, created_time)
    WHERE ad_id = item->>'ad_id';

    IF FOUND THEN updated_count := updated_count + 1; END IF;
  END LOOP;

  RETURN updated_count;
END;
$function$;