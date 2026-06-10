import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns month-to-date total spend for an account by summing creative_daily_metrics.
 */
export function useMtdSpend(accountId?: string) {
  return useQuery({
    queryKey: ["mtd-spend", accountId || "all"],
    queryFn: async () => {
      const now = new Date();
      const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      let query = supabase
        .from("creative_daily_metrics")
        .select("spend")
        .gte("date", firstOfMonth);

      if (accountId && accountId !== "all") {
        query = query.eq("account_id", accountId);
      }

      // Paginate to handle >1000 rows
      let total = 0;
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await query.range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        total += data.reduce((s, r) => s + (Number(r.spend) || 0), 0);
        if (data.length < PAGE) break;
        offset += PAGE;
      }

      return total;
    },
    staleTime: 5 * 60 * 1000,
  });
}
