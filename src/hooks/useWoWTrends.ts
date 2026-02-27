import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface WoWTrend {
  thisWeekRoas: number;
  priorWeekRoas: number;
  pctChange: number;
  direction: "up" | "down" | "flat" | "insufficient";
  label: string;
}

/**
 * Fetch last 14 days of daily metrics per ad_id and compute WoW ROAS trends.
 * Returns a Map<ad_id, WoWTrend>.
 */
export function useWoWTrends(accountId?: string) {
  return useQuery<Map<string, WoWTrend>>({
    queryKey: ["wow-trends", accountId || "all"],
    queryFn: async () => {
      const now = new Date();
      const d14ago = new Date(now);
      d14ago.setDate(d14ago.getDate() - 14);
      const d7ago = new Date(now);
      d7ago.setDate(d7ago.getDate() - 7);

      const dateFrom = d14ago.toISOString().split("T")[0];

      let query = supabase
        .from("creative_daily_metrics")
        .select("ad_id, date, spend, purchase_value")
        .gte("date", dateFrom)
        .order("date", { ascending: true });

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

      const d7agoStr = d7ago.toISOString().split("T")[0];

      // Aggregate by ad_id into two buckets
      const map = new Map<string, { tw_spend: number; tw_pv: number; tw_days: Set<string>; pw_spend: number; pw_pv: number; pw_days: Set<string> }>();

      for (const row of allRows) {
        if (!map.has(row.ad_id)) {
          map.set(row.ad_id, { tw_spend: 0, tw_pv: 0, tw_days: new Set(), pw_spend: 0, pw_pv: 0, pw_days: new Set() });
        }
        const b = map.get(row.ad_id)!;
        const spend = Number(row.spend) || 0;
        const pv = Number(row.purchase_value) || 0;

        if (row.date >= d7agoStr) {
          b.tw_spend += spend;
          b.tw_pv += pv;
          if (spend > 0) b.tw_days.add(row.date);
        } else {
          b.pw_spend += spend;
          b.pw_pv += pv;
          if (spend > 0) b.pw_days.add(row.date);
        }
      }

      const result = new Map<string, WoWTrend>();

      for (const [adId, b] of map) {
        // Need at least some spend in both weeks
        if (b.tw_days.size < 3 || b.pw_days.size < 3) {
          result.set(adId, { thisWeekRoas: 0, priorWeekRoas: 0, pctChange: 0, direction: "insufficient", label: "Insufficient data" });
          continue;
        }

        const twRoas = b.tw_spend > 0 ? b.tw_pv / b.tw_spend : 0;
        const pwRoas = b.pw_spend > 0 ? b.pw_pv / b.pw_spend : 0;

        let pctChange = 0;
        if (pwRoas > 0) {
          pctChange = ((twRoas - pwRoas) / pwRoas) * 100;
        } else if (twRoas > 0) {
          pctChange = 100;
        }

        let direction: WoWTrend["direction"] = "flat";
        let label = "Holding steady";

        if (pctChange > 10) {
          direction = "up";
          label = "Gaining momentum";
        } else if (pctChange < -30) {
          direction = "down";
          label = "Fading fast — consider pausing";
        } else if (pctChange < -10) {
          direction = "down";
          label = "Losing momentum";
        }

        result.set(adId, { thisWeekRoas: twRoas, priorWeekRoas: pwRoas, pctChange, direction, label });
      }

      return result;
    },
    staleTime: 5 * 60 * 1000,
  });
}
