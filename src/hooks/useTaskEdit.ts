// Editing a task from the task modal. Both writes go through the staff rules of os_tasks. Edits
// to a task that comes from ClickUp are queued for write-back by the database (OS-017); that
// stays off until it is switched on in the functions' settings, so an edit here is saved in the
// app only for now.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;
interface Filter extends Result {
  eq(column: string, value: string | boolean): Filter;
  not(column: string, operator: string, value: unknown): Filter;
  order(column: string, opts?: { ascending?: boolean }): Filter;
}
type Untyped = {
  from(table: string): {
    update(values: Record<string, unknown>): Filter;
    select(columns: string): Filter;
  };
  rpc(fn: string, args: Record<string, unknown>): Result;
};
const db = () => supabase as unknown as Untyped;

function refresh(qc: QueryClient, taskId: string) {
  void qc.invalidateQueries({ queryKey: ["my-task-detail", taskId] });
  void qc.invalidateQueries({ queryKey: ["my-tasks"] });
  void qc.invalidateQueries({ queryKey: ["task-by-clickup-id"] });
}

/** Columns of os_tasks the modal may change directly. Anything else is refused here, not just in the UI. */
export const EDITABLE_TASK_COLUMNS = [
  "description_markdown",
  "description",
  "brief",
  "due_date",
  "start_date",
  "priority",
  "strategist_id",
  "producer_id",
  "editor_id",
] as const;

/** Updates some columns of one task. */
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Record<string, string | null> }) => {
      const bad = Object.keys(values).filter((k) => !(EDITABLE_TASK_COLUMNS as readonly string[]).includes(k));
      if (bad.length > 0) throw new Error(`Cannot edit ${bad.join(", ")} here`);
      const { error } = await db().from("os_tasks").update(values).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSettled: (_d, _e, vars) => refresh(qc, vars.id),
  });
}

/** Sets one ClickUp custom field (os_set_task_field checks the field, its type and the value). */
export function useSetTaskField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, fieldId, value }: { id: string; fieldId: string; value: string }) => {
      const { error } = await db().rpc("os_set_task_field", { p_task_id: id, p_field_id: fieldId, p_value: value });
      if (error) throw new Error(error.message);
    },
    onSettled: (_d, _e, vars) => refresh(qc, vars.id),
  });
}

export interface StaffPerson {
  /** The login id stored in strategist_id, producer_id and editor_id. */
  user_id: string;
  name: string;
  email: string;
}

/** Active staff with a login, for the strategist, producer and editor pickers. */
export function toStaffPeople(data: unknown): StaffPerson[] {
  if (!Array.isArray(data)) return [];
  const out: StaffPerson[] = [];
  for (const r of data as Array<Record<string, unknown>>) {
    if (!r || typeof r.auth_user_id !== "string" || !r.auth_user_id) continue;
    if (r.active === false) continue;
    const email = typeof r.email === "string" ? r.email : "";
    out.push({ user_id: r.auth_user_id, name: typeof r.name === "string" && r.name ? r.name : email, email });
  }
  return out;
}

export function useStaffPeople(enabled: boolean) {
  return useQuery<StaffPerson[]>({
    queryKey: ["staff-people"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db()
        .from("app_users")
        .select("auth_user_id, name, email, active")
        .not("auth_user_id", "is", null)
        .order("name");
      if (error) throw new Error(error.message);
      return toStaffPeople(data);
    },
  });
}
