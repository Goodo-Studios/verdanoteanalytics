import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DONE_STATUS, MY_TASK_COLUMNS, type MyTaskRow } from "@/lib/myWork";

// os_tasks and its RPCs are not in the generated types yet, so the calls go through a small
// untyped shape (as useClientWork does for pipeline_tasks).
type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;
interface Query extends Result {
  neq(column: string, value: string): Query;
  or(filter: string): Query;
  eq(column: string, value: string | boolean): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  maybeSingle(): Result;
}
type Untyped = {
  from(table: string): { select(columns: string): Query };
  rpc(fn: string, args: Record<string, unknown>): Result;
};
const db = () => supabase as unknown as Untyped;

const UUID = /^[0-9a-f-]{36}$/i;

const PHONE_MAX = 639;

/** True below the sm breakpoint (640px): the task panel is a bottom sheet there. */
export function useIsPhone(): boolean {
  const read = () => typeof window !== "undefined" && window.innerWidth <= PHONE_MAX;
  const [phone, setPhone] = useState(read);
  useEffect(() => {
    const on = () => setPhone(window.innerWidth <= PHONE_MAX);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return phone;
}

/**
 * The signed-in person's open tasks (strategist, producer or editor), in one request with only
 * the row columns. `everyone` (builder only) drops the person filter.
 */
export function useMyTasks(userId: string | undefined, everyone = false) {
  return useQuery<MyTaskRow[]>({
    queryKey: ["my-tasks", everyone ? "everyone" : userId],
    enabled: everyone || !!userId,
    queryFn: async () => {
      let q = db().from("os_tasks").select(MY_TASK_COLUMNS).neq("status", DONE_STATUS)
        // Ended clients' tasks are read-only history, not work to do.
        .eq("read_only", false);
      if (!everyone) {
        if (!userId || !UUID.test(userId)) return [];
        q = q.or(`strategist_id.eq.${userId},producer_id.eq.${userId},editor_id.eq.${userId}`);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as MyTaskRow[];
    },
  });
}

export interface TaskDetail {
  id: string;
  brief: string | null;
  description: string | null;
  asset_url: string | null;
  clickup_url: string | null;
  hooks: string[] | null;
  qa_checklist: Array<{ item?: string; result?: string }> | null;
  stuck_reason: string | null;
}

export interface TaskComment {
  id: number;
  thread: "internal" | "client";
  body: string;
  author: { name?: string | null; username?: string | null; email?: string | null } | null;
  created_at: string;
  from_clickup: boolean;
}

export interface StatusChange {
  id: number;
  from_status: string | null;
  to_status: string;
  changed_at: string;
}

const DETAIL_COLUMNS = "id, brief, description, asset_url, clickup_url, hooks, qa_checklist, stuck_reason";

/** The side panel's details, loaded only when a row opens. Three requests in parallel. */
export function useTaskDetail(taskId: string | null) {
  return useQuery({
    queryKey: ["my-task-detail", taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const [detail, comments, history] = await Promise.all([
        db().from("os_tasks").select(DETAIL_COLUMNS).eq("id", taskId!).maybeSingle(),
        db().rpc("list_task_comments", { p_task_id: taskId }),
        db().from("os_task_status_history").select("id, from_status, to_status, changed_at").eq("task_id", taskId!).order("changed_at", { ascending: true }),
      ]);
      for (const r of [detail, comments, history]) if (r.error) throw new Error(r.error.message);
      return {
        detail: (detail.data ?? null) as TaskDetail | null,
        comments: (comments.data ?? []) as TaskComment[],
        history: (history.data ?? []) as StatusChange[],
      };
    },
  });
}
