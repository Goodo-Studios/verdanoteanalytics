import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PIPELINE_TASK_COLUMNS } from "@/lib/pageQueries";
import { sortByDue, type WorkTask } from "@/lib/clientWork";

type Untyped = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

/**
 * The ClickUp cards for one client, by the client (client_slug), not by ad account. A client with no
 * ad account, or with several, still has its board. Staff read every client; a client login uses
 * usePipelineTasks with `own` instead.
 */
export function useClientWork(clientSlug: string) {
  return useQuery<WorkTask[]>({
    queryKey: ["client-work", clientSlug],
    enabled: !!clientSlug,
    refetchInterval: 15 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as Untyped).from("pipeline_tasks").select(PIPELINE_TASK_COLUMNS).eq("client_slug", clientSlug);
      if (error) throw new Error(error.message);
      return sortByDue((data ?? []) as WorkTask[]);
    },
  });
}
