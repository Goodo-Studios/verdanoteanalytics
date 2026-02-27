import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccountContext } from "@/contexts/AccountContext";
import { startOfMonth, endOfMonth, format } from "date-fns";

export function useCalendarCreatives(month: Date) {
  const { selectedAccountId } = useAccountContext();
  const monthStart = format(startOfMonth(month), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(month), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["calendar-creatives", selectedAccountId, monthStart, monthEnd],
    queryFn: async () => {
      // Get creatives that have a scheduled_launch_date in this month
      let scheduledQuery = supabase
        .from("creatives")
        .select("ad_id, ad_name, account_id, thumbnail_url, scheduled_launch_date, spend, roas, ad_type, ad_status")
        .gte("scheduled_launch_date", monthStart)
        .lte("scheduled_launch_date", monthEnd);

      if (selectedAccountId && selectedAccountId !== "all") {
        scheduledQuery = scheduledQuery.eq("account_id", selectedAccountId);
      }

      const { data: scheduled } = await scheduledQuery;

      // Get creatives that first appeared (created_at) in this month — "launched"
      let launchedQuery = supabase
        .from("creatives")
        .select("ad_id, ad_name, account_id, thumbnail_url, scheduled_launch_date, spend, roas, ad_type, ad_status, created_at")
        .gte("created_at", `${monthStart}T00:00:00`)
        .lte("created_at", `${monthEnd}T23:59:59`);

      if (selectedAccountId && selectedAccountId !== "all") {
        launchedQuery = launchedQuery.eq("account_id", selectedAccountId);
      }

      const { data: launched } = await launchedQuery;

      // Merge & deduplicate
      const map = new Map<string, any>();
      for (const c of launched || []) {
        map.set(c.ad_id, { ...c, launchDate: c.created_at?.split("T")[0], isLaunched: Number(c.spend || 0) > 0 });
      }
      for (const c of scheduled || []) {
        if (!map.has(c.ad_id)) {
          map.set(c.ad_id, { ...c, launchDate: c.scheduled_launch_date, isLaunched: Number(c.spend || 0) > 0 });
        } else {
          // Prefer scheduled_launch_date if set
          const existing = map.get(c.ad_id)!;
          if (c.scheduled_launch_date) {
            existing.launchDate = c.scheduled_launch_date;
          }
        }
      }

      return Array.from(map.values());
    },
  });
}
