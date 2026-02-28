import { useQuery } from "@tanstack/react-query";
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

export function useDailyTrends(accountId?: string) {
  return useQuery<DailyTrendPoint[]>({
    queryKey: ["daily-trends", accountId || "all"],
    queryFn: async () => {
      let query = supabase
        .from("creative_daily_metrics")
        .select("date, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views, frequency, account_id, ad_id")
        .order("date", { ascending: true });

      if (accountId && accountId !== "all") {
        query = query.eq("account_id", accountId);
      }

      // Fetch in chunks to handle large datasets
      const allRows: any[] = [];
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await query.range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < PAGE) break;
        offset += PAGE;
      }

      // Aggregate by date
      const byDate: Record<string, {
        spend: number; impressions: number; clicks: number; purchases: number;
        purchase_value: number; adds_to_cart: number; video_views: number;
        frequencySum: number; frequencyCount: number; adIds: Set<string>;
      }> = {};

      for (const row of allRows) {
        if (!byDate[row.date]) {
          byDate[row.date] = {
            spend: 0, impressions: 0, clicks: 0, purchases: 0,
            purchase_value: 0, adds_to_cart: 0, video_views: 0,
            frequencySum: 0, frequencyCount: 0, adIds: new Set(),
          };
        }
        const d = byDate[row.date];
        d.spend += Number(row.spend) || 0;
        d.impressions += Number(row.impressions) || 0;
        d.clicks += Number(row.clicks) || 0;
        d.purchases += Number(row.purchases) || 0;
        d.purchase_value += Number(row.purchase_value) || 0;
        d.adds_to_cart += Number(row.adds_to_cart) || 0;
        d.video_views += Number(row.video_views) || 0;
        if (row.frequency != null && Number(row.frequency) > 0) {
          d.frequencySum += Number(row.frequency);
          d.frequencyCount += 1;
        }
        if (row.ad_id) d.adIds.add(row.ad_id);
      }

      return Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => ({
          date,
          spend: d.spend,
          impressions: d.impressions,
          clicks: d.clicks,
          purchases: d.purchases,
          purchase_value: d.purchase_value,
          adds_to_cart: d.adds_to_cart,
          video_views: d.video_views,
          frequency: d.frequencyCount > 0 ? d.frequencySum / d.frequencyCount : 0,
          activeAdCount: d.adIds.size,
          ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
          cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
          cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
          cpa: d.purchases > 0 ? d.spend / d.purchases : 0,
          roas: d.spend > 0 ? d.purchase_value / d.spend : 0,
          cost_per_atc: d.adds_to_cart > 0 ? d.spend / d.adds_to_cart : 0,
        }));
    },
  });
}
