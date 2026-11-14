// The timer and the weekly log (OS-012). The running entry comes from the database, and elapsed
// time is worked out from its start_at, so the timer survives a reload and shows the same on every
// tab. time_entries and the time_* functions are not in the generated types yet, so the calls go
// through a small untyped shape (as useMyWork does for os_tasks).
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { friendlyTimeError, type TimeEntryRow } from "@/lib/timeLog";

type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;
interface Query extends Result {
  eq(column: string, value: string | boolean): Query;
  is(column: string, value: null): Query;
  gte(column: string, value: string): Query;
  lt(column: string, value: string): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  limit(n: number): Query;
  select(columns: string): Query;
  maybeSingle(): Result;
}
type Untyped = {
  from(table: string): {
    select(columns: string): Query;
    insert(values: Record<string, unknown>): Query;
    update(values: Record<string, unknown>): Query;
    delete(): Query;
  };
  rpc(fn: string, args?: Record<string, unknown>): Result;
};
const db = () => supabase as unknown as Untyped;

/** Columns for one entry, with the task title and client name. person!inner limits to mine. */
export const ENTRY_COLUMNS =
  "id, person_id, task_id, client_slug, is_internal, category, description, start_at, end_at, source_id, task:os_tasks(title), client:clients(name), person:time_people!inner(user_id)";

export const RUNNING_KEY = "timer-running";
export const ENTRIES_KEY = "time-entries";

/** The signed-in person's running entry, or null. Refetched when the window regains focus. */
export function useRunningTimer(userId: string | undefined, enabled = true) {
  return useQuery<TimeEntryRow | null>({
    queryKey: [RUNNING_KEY, userId],
    enabled: enabled && !!userId,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await db()
        .from("time_entries")
        .select(ENTRY_COLUMNS)
        .eq("person.user_id", userId!)
        .is("end_at", null)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as TimeEntryRow | null;
    },
  });
}

export interface StartArgs {
  taskId?: string | null;
  clientSlug?: string | null;
  internal?: boolean;
  category?: string | null;
  description?: string;
}

function useInvalidate() {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: [RUNNING_KEY] });
    void qc.invalidateQueries({ queryKey: [ENTRIES_KEY] });
  }, [qc]);
}

/** Starts a timer. Any running timer is stopped first, in the same database call. */
export function useStartTimer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (a: StartArgs) => {
      const { data, error } = await db().rpc("time_start_timer", {
        p_task_id: a.taskId ?? null,
        p_client_slug: a.clientSlug ?? null,
        p_internal: !!a.internal,
        p_category: a.category ?? null,
        p_description: a.description ?? "",
      });
      if (error) throw new Error(friendlyTimeError(error.message));
      return data as TimeEntryRow;
    },
    onSettled: invalidate,
  });
}

export function useStopTimer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async () => {
      const { error } = await db().rpc("time_stop_timer", {});
      if (error) throw new Error(friendlyTimeError(error.message));
    },
    onSettled: invalidate,
  });
}

/**
 * For play buttons on task rows: which task is running, and a toggle that starts that task's
 * timer (switching from any other) or stops it when it is the one running.
 */
export function useTaskTimer(userId: string | undefined) {
  const running = useRunningTimer(userId);
  const start = useStartTimer();
  const stop = useStopTimer();
  const runningTaskId = running.data?.task_id ?? null;
  const toggle = useCallback(
    (taskId: string) => {
      if (runningTaskId === taskId) {
        stop.mutate(undefined, { onError: (e) => toast.error(`Could not stop the timer: ${(e as Error).message}`) });
      } else {
        start.mutate({ taskId }, { onError: (e) => toast.error(`Could not start the timer: ${(e as Error).message}`) });
      }
    },
    // The mutate functions are stable; the objects are not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runningTaskId, start.mutate, stop.mutate],
  );
  return { runningTaskId, toggle, busy: start.isPending || stop.isPending };
}

/** My entries that start inside [fromIso, toIso). */
export function useWeekEntries(userId: string | undefined, fromIso: string, toIso: string) {
  return useQuery<TimeEntryRow[]>({
    queryKey: [ENTRIES_KEY, userId, fromIso],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await db()
        .from("time_entries")
        .select(ENTRY_COLUMNS)
        .eq("person.user_id", userId!)
        .gte("start_at", fromIso)
        .lt("start_at", toIso)
        .order("start_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as TimeEntryRow[];
    },
  });
}

export interface ClientOption {
  slug: string;
  name: string;
}

/** Clients to pick for time with no task. */
export function useTimeClients(enabled = true) {
  return useQuery<ClientOption[]>({
    queryKey: ["time-clients"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db().from("clients").select("slug, name").order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ClientOption[];
    },
  });
}

export interface EntryInput {
  task_id: string | null;
  client_slug: string | null;
  is_internal: boolean;
  category: string | null;
  description: string;
  start_at: string;
  end_at: string;
}

/** Adds (no id) or edits (id) one of my entries. A new entry gets my person row first. */
export function useSaveEntry() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: EntryInput }) => {
      if (id) {
        const { error } = await db().from("time_entries").update({ ...values }).eq("id", id);
        if (error) throw new Error(friendlyTimeError(error.message));
        return;
      }
      const person = await db().rpc("time_my_person", {});
      if (person.error) throw new Error(friendlyTimeError(person.error.message));
      const { error } = await db().from("time_entries").insert({ ...values, person_id: person.data as string });
      if (error) throw new Error(friendlyTimeError(error.message));
    },
    onSettled: invalidate,
  });
}

export function useDeleteEntry() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db().from("time_entries").delete().eq("id", id);
      if (error) throw new Error(friendlyTimeError(error.message));
    },
    onSettled: invalidate,
  });
}
