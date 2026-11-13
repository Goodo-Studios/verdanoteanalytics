import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PIPELINE_TASK_COLUMNS } from "@/lib/pageQueries";
import { sortByDue, type WorkTask } from "@/lib/clientWork";
import type { DerivedTask } from "@/features/dashboard/model";

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

/**
 * Tasks for the client hub's monthly delivery bar (OS-025): open ClickUp tasks plus the delivered
 * archive, with the fields deriveMonthDelivery needs. Same row rules as the Work tab.
 */
export function useClientDeliveryTasks(clientSlug: string) {
  return useQuery<{ open: DerivedTask[]; delivered: DerivedTask[] }>({
    queryKey: ["client-delivery-tasks", clientSlug],
    enabled: !!clientSlug,
    refetchInterval: 15 * 60 * 1000,
    queryFn: async () => {
      const db = supabase as unknown as Untyped;
      const [open, delivered] = await Promise.all([
        db.from("pipeline_tasks").select("stage, cycle_month, due_date, delivered_at").eq("client_slug", clientSlug),
        db.from("pipeline_delivered").select("cycle_month, delivered_at").eq("client_slug", clientSlug),
      ]);
      if (open.error) throw new Error(open.error.message);
      if (delivered.error) throw new Error(delivered.error.message);
      return { open: (open.data ?? []) as DerivedTask[], delivered: (delivered.data ?? []) as DerivedTask[] };
    },
  });
}
