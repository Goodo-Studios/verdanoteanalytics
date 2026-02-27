import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { detectAnomalies, type Anomaly } from "@/lib/anomalyDetection";

/**
 * Fetches daily metrics for anomaly detection and runs the detection engine.
 */
export function useAnomalyDetection(creatives: any[], accountId?: string) {
  // Fetch last 14 days of daily metrics
  const { data: dailyMetrics = [] } = useQuery({
    queryKey: ["anomaly-daily-metrics", accountId || "all"],
    queryFn: async () => {
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      const dateStr = fourteenDaysAgo.toISOString().slice(0, 10);

      let query = supabase
        .from("creative_daily_metrics")
        .select("ad_id, date, spend, roas, frequency, impressions, purchase_value")
        .gte("date", dateStr)
        .order("date", { ascending: false });

      if (accountId && accountId !== "all") {
        query = query.eq("account_id", accountId);
      }

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
      return allRows;
    },
    enabled: creatives.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const anomalies = useMemo(
    () => detectAnomalies(creatives, dailyMetrics),
    [creatives, dailyMetrics],
  );

  const anomalySet = useMemo(
    () => new Set(anomalies.map((a) => a.adId)),
    [anomalies],
  );

  return { anomalies, anomalySet, dailyMetrics };
}
