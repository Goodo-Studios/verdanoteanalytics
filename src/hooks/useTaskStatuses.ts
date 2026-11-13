import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** One status a task may take: its own ClickUp list's statuses, in ClickUp order (os_task_status_options). */
export interface TaskStatusOption {
  status: string;
  name: string;
  color: string | null;
  type: string | null;
  stage: string | null;
}

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** Keeps only well-formed rows, so a bad answer shows no picker rather than a broken one. */
export function toStatusOptions(data: unknown): TaskStatusOption[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: TaskStatusOption[] = [];
  for (const r of data as Record<string, unknown>[]) {
    if (!r || typeof r.status !== "string" || !r.status || seen.has(r.status)) continue;
    seen.add(r.status);
    out.push({
      status: r.status,
      name: typeof r.name === "string" && r.name ? r.name : r.status,
      color: typeof r.color === "string" ? r.color : null,
      type: typeof r.type === "string" ? r.type : null,
      stage: typeof r.stage === "string" ? r.stage : null,
    });
  }
  return out;
}

/** The statuses the side panel offers for one task. Staff only; a client gets none. */
export function useTaskStatusOptions(taskId: string | null) {
  return useQuery<TaskStatusOption[]>({
    queryKey: ["task-status-options", taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as Rpc).rpc("os_task_status_options", { p_task_id: taskId });
      if (error) throw new Error(error.message);
      return toStatusOptions(data);
    },
  });
}
