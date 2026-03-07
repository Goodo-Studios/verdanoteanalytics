import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PeriodMetrics {
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalPurchases: number;
  totalPurchaseValue: number;
  totalAddsToCart: number;
  totalVideoViews: number;
  activeCount: number;
  avgRoas: number;
  avgCpa: number;
  avgCtr: number;
}

/**
 * Aggregates metrics from creative_daily_metrics for a specific date range.
 * This produces accurate period totals (unlike creatives table which is a snapshot).
 */
export function usePeriodMetrics(opts: {
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
  enabled?: boolean;
}) {
  const { accountId, dateFrom, dateTo, enabled = true } = opts;

  return useQuery<PeriodMetrics>({
    queryKey: ["period-metrics", accountId || "all", dateFrom, dateTo],
    enabled: enabled && !!dateFrom && !!dateTo,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // Fetch daily metrics in pages of 1000
      const allRows: any[] = [];
      let offset = 0;
      const PAGE = 1000;

      while (true) {
        let query = supabase
          .from("creative_daily_metrics")
          .select("ad_id, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views")
          .gte("date", dateFrom!)
          .lte("date", dateTo!)
          .range(offset, offset + PAGE - 1);

        if (accountId && accountId !== "all") {
          query = query.eq("account_id", accountId);
        }

        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < PAGE) break;
        offset += PAGE;
      }

      // Aggregate totals and track unique active ads
      let totalSpend = 0;
      let totalImpressions = 0;
      let totalClicks = 0;
      let totalPurchases = 0;
      let totalPurchaseValue = 0;
      let totalAddsToCart = 0;
      let totalVideoViews = 0;
      const activeAdIds = new Set<string>();

      for (const row of allRows) {
        const spend = Number(row.spend) || 0;
        totalSpend += spend;
        totalImpressions += Number(row.impressions) || 0;
        totalClicks += Number(row.clicks) || 0;
        totalPurchases += Number(row.purchases) || 0;
        totalPurchaseValue += Number(row.purchase_value) || 0;
        totalAddsToCart += Number(row.adds_to_cart) || 0;
        totalVideoViews += Number(row.video_views) || 0;
        if (spend > 0) activeAdIds.add(row.ad_id);
      }

      return {
        totalSpend,
        totalImpressions,
        totalClicks,
        totalPurchases,
        totalPurchaseValue,
        totalAddsToCart,
        totalVideoViews,
        activeCount: activeAdIds.size,
        avgRoas: totalSpend > 0 ? totalPurchaseValue / totalSpend : 0,
        avgCpa: totalPurchases > 0 ? totalSpend / totalPurchases : 0,
        avgCtr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      };
    },
  });
}
