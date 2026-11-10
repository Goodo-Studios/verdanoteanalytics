import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * One card on the Content Pipeline board. Rows come from `pipeline_tasks`, which
 * the sync-clickup-tasks edge function fills from ClickUp. The table holds only
 * client-safe fields: the column (`stage`) is already mapped from the ClickUp
 * status, and no internal status, assignee, link or task id is selected here.
 */
export interface PipelineTask {
  id: string;
  task_name: string | null;
  stage: string | null;
  due_date: string | null;
  content_type: string | null;
  updated_at: string | null;
}

const STAGE_ORDER: Record<string, number> = {
  "Preparing Content": 1,
  Production: 2,
  Editing: 3,
  "Client Review": 4,
  "Ready to Launch": 5,
};

/**
 * Staff pass the selected ad account. A client login passes `own` instead: no
 * filter is sent, and the row rules return only rows of the client's linked ad
 * accounts or of its own clients (`client_slug IN get_user_client_slugs()`), so
 * a client with no ad account, or with several, still gets its board. Only pass
 * `own` for a real client session: staff have no row limit.
 */
export function usePipelineTasks(accountId?: string, own = false) {
  return useQuery<PipelineTask[]>({
    queryKey: ["pipeline-tasks", own || accountId],
    enabled: own || (!!accountId && accountId !== "all"),
    refetchInterval: 15 * 60 * 1000, // 15 minutes
    queryFn: async () => {
      const query = supabase
        .from("pipeline_tasks")
        .select("id, task_name, stage, due_date, content_type, updated_at");
      const { data, error } = await (own ? query : query.eq("account_id", accountId!));

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
