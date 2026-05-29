import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DailyTrendPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  adds_to_cart: number;
  video_views: number;
  frequency: number;
  activeAdCount: number;
  // Computed
  ctr: number;
  cpm: number;
  cpc: number;
  cpa: number;
  roas: number;
  cost_per_atc: number;
}

export function useDailyTrends(
  accountId?: string,
  dateRange?: { from: string; to: string }
) {
  return useQuery<DailyTrendPoint[]>({
    queryKey: ["daily-trends", accountId || "all", dateRange?.from, dateRange?.to],
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_daily_trends", {
        p_account_id: accountId && accountId !== "all" ? accountId : null,
        p_from: dateRange?.from ?? null,
        p_to: dateRange?.to ?? null,
      });

      if (error) throw error;
      if (!data) return [];

      return (data as any[]).map((row) => {
        const spend = Number(row.spend) || 0;
        const impressions = Number(row.impressions) || 0;
        const clicks = Number(row.clicks) || 0;
        const purchases = Number(row.purchases) || 0;
        const purchase_value = Number(row.purchase_value) || 0;
        const adds_to_cart = Number(row.adds_to_cart) || 0;

        return {
          date: row.trend_date as string,
          spend,
          impressions,
          clicks,
          purchases,
          purchase_value,
          adds_to_cart,
          video_views: Number(row.video_views) || 0,
          frequency: Number(row.avg_frequency) || 0,
          activeAdCount: Number(row.active_ad_count) || 0,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
          cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
          cpc: clicks > 0 ? spend / clicks : 0,
          cpa: purchases > 0 ? spend / purchases : 0,
          roas: spend > 0 ? purchase_value / spend : 0,
          cost_per_atc: adds_to_cart > 0 ? spend / adds_to_cart : 0,
        };
      });
    },
  });
}
