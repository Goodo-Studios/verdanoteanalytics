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
 * Uses the get_period_metrics Postgres RPC to perform a single server-side SUM()
 * instead of fetching and aggregating rows client-side.
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
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_period_metrics", {
        p_account_id: accountId && accountId !== "all" ? accountId : null,
        p_from: dateFrom!,
        p_to: dateTo!,
      });

      if (error) throw error;

      // RPC returns a single-row TABLE result; Supabase wraps it as an array
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        return {
          totalSpend: 0,
          totalImpressions: 0,
          totalClicks: 0,
          totalPurchases: 0,
          totalPurchaseValue: 0,
          totalAddsToCart: 0,
          totalVideoViews: 0,
          activeCount: 0,
          avgRoas: 0,
          avgCpa: 0,
          avgCtr: 0,
        };
      }

      const totalSpend = Number(row.total_spend) || 0;
      const totalImpressions = Number(row.total_impressions) || 0;
      const totalClicks = Number(row.total_clicks) || 0;
      const totalPurchases = Number(row.total_purchases) || 0;
      const totalPurchaseValue = Number(row.total_purchase_value) || 0;

      return {
        totalSpend,
        totalImpressions,
        totalClicks,
        totalPurchases,
        totalPurchaseValue,
        totalAddsToCart: Number(row.total_adds_to_cart) || 0,
        totalVideoViews: Number(row.total_video_views) || 0,
        activeCount: Number(row.active_count) || 0,
        avgRoas: totalSpend > 0 ? totalPurchaseValue / totalSpend : 0,
        avgCpa: totalPurchases > 0 ? totalSpend / totalPurchases : 0,
        avgCtr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      };
    },
  });
}
