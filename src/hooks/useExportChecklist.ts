// OS-023: the export checklist and the setting that decides whether it stands in for the four
// export statuses. Staff only (row rules); clients never load these.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { EXPORT_CHECKLIST_SETTING } from "@/lib/exportChecklist";

type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;
interface Query extends Result {
  eq(column: string, value: string | boolean): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  maybeSingle(): Result;
}
type Untyped = {
  from(table: string): {
    select(columns: string): Query;
    update(values: Record<string, unknown>): Query;
    insert(values: Record<string, unknown>): Result;
    delete(): Query;
  };
  rpc(fn: string, args: Record<string, unknown>): Result;
};
const db = () => supabase as unknown as Untyped;

export interface ChecklistItem {
  id: string;
  label: string;
  position: number;
  done: boolean;
  done_at: string | null;
}

/** True only when os_settings says the checklist replaces the export statuses. Off by default. */
export function useExportChecklistOn() {
  const q = useQuery<boolean>({
    queryKey: ["os-setting", EXPORT_CHECKLIST_SETTING],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db().from("os_settings").select("value").eq("key", EXPORT_CHECKLIST_SETTING).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { value?: unknown } | null)?.value === true;
    },
  });
  return q.data === true;
}

export function useTaskChecklist(taskId: string | null, enabled: boolean) {
  const qc = useQueryClient();
  const key = ["task-checklist", taskId];
  const items = useQuery<ChecklistItem[]>({
    queryKey: key,
    enabled: enabled && !!taskId,
    queryFn: async () => {
      const { data, error } = await db()
        .from("os_task_checklist_items")
        .select("id, label, position, done, done_at")
        .eq("task_id", taskId!)
        .order("position", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ChecklistItem[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const check = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };

  const start = useMutation({
    mutationFn: async () => check(await db().rpc("os_task_checklist_start", { p_task_id: taskId })),
    onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) =>
      check(await db().from("os_task_checklist_items").update({ done }).eq("id", id)),
    onSuccess: refresh,
  });
  const add = useMutation({
    mutationFn: async (label: string) => {
      const last = (items.data ?? []).reduce((m, i) => Math.max(m, i.position), 0);
      check(await db().from("os_task_checklist_items").insert({ task_id: taskId, label, position: last + 10 }));
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => check(await db().from("os_task_checklist_items").delete().eq("id", id)),
    onSuccess: refresh,
  });

  return { items, start, toggle, add, remove };
}
