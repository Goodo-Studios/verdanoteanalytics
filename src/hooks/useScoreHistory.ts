import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ScoreHistoryPoint {
  id: string;
  ad_id: string;
  account_id: string;
  score: number;
  roas_component: number | null;
  ctr_component: number | null;
  hook_rate_component: number | null;
  spend_efficiency_component: number | null;
  momentum_component: number | null;
  fatigue_component: number | null;
  recorded_at: string;
}

export function useScoreHistory(adId: string | undefined, days = 30) {
  return useQuery({
    queryKey: ["score-history", adId, days],
    enabled: !!adId,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const { data, error } = await supabase
        .from("score_history")
        .select("*")
        .eq("ad_id", adId!)
        .gte("recorded_at", since.toISOString())
        .order("recorded_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as ScoreHistoryPoint[];
    },
  });
}

export function useScoreHistoryBatch(adIds: string[], days = 7) {
  return useQuery({
    queryKey: ["score-history-batch", adIds.sort().join(","), days],
    enabled: adIds.length > 0,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const { data, error } = await supabase
        .from("score_history")
        .select("ad_id, score, recorded_at")
        .in("ad_id", adIds)
        .gte("recorded_at", since.toISOString())
        .order("recorded_at", { ascending: true });
      if (error) throw error;
      // Group by ad_id
      const map = new Map<string, { score: number; recorded_at: string }[]>();
      for (const row of (data || [])) {
        const points = map.get(row.ad_id) || [];
        points.push({ score: row.score, recorded_at: row.recorded_at });
        map.set(row.ad_id, points);
      }
      return map;
    },
  });
}
