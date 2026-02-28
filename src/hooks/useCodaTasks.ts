import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CodaTask {
  id: string;
  task_name: string | null;
  stage: string | null;
  due_date: string | null;
  content_type: string | null;
  coda_url: string | null;
  brief: string | null;
  updated_at: string | null;
}

const STAGE_ORDER: Record<string, number> = {
  Planning: 1,
  Production: 2,
  Review: 3,
  "Your Review": 4,
  Complete: 5,
};

export function useCodaTasks(accountId?: string) {
  return useQuery<CodaTask[]>({
    queryKey: ["coda-tasks", accountId],
    enabled: !!accountId && accountId !== "all",
    refetchInterval: 15 * 60 * 1000, // 15 minutes
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coda_tasks")
        .select("id, task_name, stage, due_date, content_type, coda_url, brief, updated_at")
        .eq("account_id", accountId!);

      if (error) throw error;

      return (data || []).sort((a, b) => {
        const sa = STAGE_ORDER[a.stage || ""] ?? 6;
        const sb = STAGE_ORDER[b.stage || ""] ?? 6;
        if (sa !== sb) return sa - sb;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      });
    },
  });
}
