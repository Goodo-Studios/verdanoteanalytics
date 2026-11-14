import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PIPELINE_TASK_COLUMNS } from "@/lib/pageQueries";
import { fetchAllPages } from "@/lib/pagedSelect";
import { sortByDue, type WorkTask } from "@/lib/clientWork";
import type { DerivedTask } from "@/features/dashboard/model";

type Page = PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Untyped = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { order(column: string): { range(from: number, to: number): Page } };
    };
  };
};

/** One client's rows from a table, in pages: one response is capped at 1000 rows. */
function clientRows<T>(table: string, columns: string, clientSlug: string): Promise<T[]> {
  const db = supabase as unknown as Untyped;
  return fetchAllPages<T>(async (from, to) => {
    const { data, error } = await db.from(table).select(columns).eq("client_slug", clientSlug).order("id").range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as T[];
  });
}

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
      return sortByDue(await clientRows<WorkTask>("pipeline_tasks", PIPELINE_TASK_COLUMNS, clientSlug));
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
      const [open, delivered] = await Promise.all([
        clientRows<DerivedTask>("pipeline_tasks", "stage, cycle_month, due_date, delivered_at", clientSlug),
        clientRows<DerivedTask>("pipeline_delivered", "cycle_month, delivered_at", clientSlug),
      ]);
      return { open, delivered };
    },
  });
}
