
-- Extend bulk_update_creative_metrics to persist play_curve + retention quartiles.
-- The RPC enumerates every column explicitly; without these the Phase-2 aggregate
-- sync would silently fail to persist frame-retention data.
CREATE OR REPLACE FUNCTION public.bulk_update_creative_metrics(payload jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  updated_count integer := 0;
  item jsonb;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(payload)
  LOOP
    UPDATE public.creatives SET
      spend = COALESCE((item->>'spend')::numeric, spend),
      roas = COALESCE((item->>'roas')::numeric, roas),
      cpa = COALESCE((item->>'cpa')::numeric, cpa),
      ctr = COALESCE((item->>'ctr')::numeric, ctr),
      clicks = COALESCE((item->>'clicks')::integer, clicks),
      impressions = COALESCE((item->>'impressions')::integer, impressions),
      cpm = COALESCE((item->>'cpm')::numeric, cpm),
      cpc = COALESCE((item->>'cpc')::numeric, cpc),
      frequency = COALESCE((item->>'frequency')::numeric, frequency),
      purchases = COALESCE((item->>'purchases')::integer, purchases),
      purchase_value = COALESCE((item->>'purchase_value')::numeric, purchase_value),
      thumb_stop_rate = COALESCE((item->>'thumb_stop_rate')::numeric, thumb_stop_rate),
      hold_rate = COALESCE((item->>'hold_rate')::numeric, hold_rate),
      video_avg_play_time = COALESCE((item->>'video_avg_play_time')::numeric, video_avg_play_time),
      adds_to_cart = COALESCE((item->>'adds_to_cart')::integer, adds_to_cart),
      cost_per_add_to_cart = COALESCE((item->>'cost_per_add_to_cart')::numeric, cost_per_add_to_cart),
      video_views = COALESCE((item->>'video_views')::integer, video_views),
      play_curve = COALESCE(item->'play_curve', play_curve),
      retention_p25 = COALESCE((item->>'retention_p25')::numeric, retention_p25),
      retention_p50 = COALESCE((item->>'retention_p50')::numeric, retention_p50),
      retention_p75 = COALESCE((item->>'retention_p75')::numeric, retention_p75),
      retention_p100 = COALESCE((item->>'retention_p100')::numeric, retention_p100)
    WHERE ad_id = item->>'ad_id';

    IF FOUND THEN updated_count := updated_count + 1; END IF;
  END LOOP;

  RETURN updated_count;
END;
$$;
