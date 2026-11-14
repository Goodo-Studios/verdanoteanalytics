import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DONE_STATUS } from "@/lib/myWork";
import { startOfDayIso } from "@/lib/today";

// os_tasks is not in the generated types yet (see useMyWork.ts), so the calls use a small shape.
type Result = PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>;
interface Query extends Result {
  eq(column: string, value: string | boolean): Query;
  gte(column: string, value: string): Query;
  or(filter: string): Query;
}
type Untyped = {
  from(table: string): {
    select(columns: string, opts?: { count?: "exact"; head?: boolean }): Query;
    update(values: Record<string, unknown>): Query;
  };
};
const db = () => supabase as unknown as Untyped;
const UUID = /^[0-9a-f-]{36}$/i;

/** How many of the person's tasks were finished today (status complete, changed since midnight). */
export function useDoneTodayCount(userId: string | undefined, today: string) {
  return useQuery<number>({
    queryKey: ["today-done", userId, today],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId || !UUID.test(userId)) return 0;
      const { count, error } = await db()
        .from("os_tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", DONE_STATUS)
        .gte("updated_at", startOfDayIso(today))
        .or(`strategist_id.eq.${userId},producer_id.eq.${userId},editor_id.eq.${userId}`);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}

/** Set one task's status. Used to mark a task done and to undo that. */
export function useSetTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await db().from("os_tasks").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["my-tasks"] });
      void qc.invalidateQueries({ queryKey: ["today-done"] });
    },
  });
}
