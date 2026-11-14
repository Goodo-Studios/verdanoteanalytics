import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CLIENT_BOARD_COLUMNS, CLIENT_DELIVERED_COLUMNS, CLIENT_ENGAGEMENT_COLUMNS, CLIENT_LINK_COLUMNS } from "@/lib/pageQueries";
import { fetchAllPages } from "@/lib/pagedSelect";
import { DELIVERED_STAGE, type CycleEngagement } from "@/lib/pipelineCycles";

/**
 * One card on the Content Pipeline board. Rows come from `pipeline_tasks`, which
 * the sync-clickup-tasks edge function fills from ClickUp. The table holds only
 * client-safe fields: the column (`stage`) is already mapped from the ClickUp
 * status, and no internal status, assignee, link or task id is selected here.
 * `cycle_month` and `delivered_at` come from the same sync (the cycle named in
 * the task, and the day it was delivered).
 */
export interface PipelineTask {
  id: string;
  /** ClickUp task id; the key a decision is recorded against. */
  clickup_task_id?: string | null;
  task_name: string | null;
  stage: string | null;
  due_date: string | null;
  content_type: string | null;
  updated_at: string | null;
  cycle_month?: string | null;
  delivered_at?: string | null;
  /** Air review link from the ClickUp "Link to Asset" field (https, air.inc host), or null. */
  asset_link?: string | null;
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
 * `own` for a real client session: with no filter, staff would read every row.
 * Rows are read in pages: one response is capped at 1000 rows.
 */
export function usePipelineTasks(accountId?: string, own = false) {
  return useQuery<PipelineTask[]>({
    queryKey: ["pipeline-tasks", own || accountId],
    enabled: own || (!!accountId && accountId !== "all"),
    refetchInterval: 15 * 60 * 1000, // 15 minutes
    queryFn: async () => {
      const data = await fetchAllPages<PipelineTask>(async (from, to) => {
        const query = supabase.from("pipeline_tasks").select(CLIENT_BOARD_COLUMNS);
        const { data: page, error } = await (own ? query : query.eq("account_id", accountId!)).order("id").range(from, to);
        if (error) throw error;
        return (page || []) as unknown as PipelineTask[];
      });

      return data.sort((a, b) => {
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

type Ranged = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  order(column: string): Ranged;
  range(from: number, to: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
type Untyped = {
  from(table: string): {
    select(columns: string): PromiseLike<{ data: unknown; error: { message: string } | null }> & {
      eq(column: string, value: string): Ranged;
      order(column: string): Ranged;
      range(from: number, to: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
};
const db = () => supabase as unknown as Untyped;

/**
 * Delivered work older than the board window, kept so past cycles keep their finished tasks. The same
 * row rules as the board apply (a client reads only its own clients' rows). Shaped like a board card
 * in the "Ready to Launch" stage.
 */
export function usePipelineDelivered(accountId?: string, own = false) {
  return useQuery<PipelineTask[]>({
    queryKey: ["pipeline-delivered", own || accountId],
    enabled: own || (!!accountId && accountId !== "all"),
    refetchInterval: 15 * 60 * 1000,
    queryFn: async () => {
      // pipeline_delivered only grows, so it will pass the 1000-row response cap: read it in pages.
      const data = await fetchAllPages<Omit<PipelineTask, "stage" | "due_date">>(async (from, to) => {
        const query = db().from("pipeline_delivered").select(CLIENT_DELIVERED_COLUMNS);
        const { data: page, error } = await (own ? query : query.eq("account_id", accountId!)).order("id").range(from, to);
        if (error) throw new Error(error.message);
        return (page || []) as Omit<PipelineTask, "stage" | "due_date">[];
      });
      return data.map((r) => ({
        ...r,
        stage: DELIVERED_STAGE,
        due_date: null,
      }));
    },
  });
}

/**
 * Engagement dates of the signed-in client's own clients (the cycle header dates). Only for a real
 * client login: staff read every client's engagements, so a staff preview gets no dates.
 */
export function useCycleEngagements(own = false) {
  return useQuery<CycleEngagement[]>({
    queryKey: ["cycle-engagements", own],
    enabled: own,
    queryFn: async () => {
      const { data, error } = await db().from("engagements").select(CLIENT_ENGAGEMENT_COLUMNS);
      if (error) throw new Error(error.message);
      return (data || []) as CycleEngagement[];
    },
  });
}

/** The client_members links of the signed-in login (which clients it belongs to, apart from ad accounts). */
export function useOwnClientLinks(enabled: boolean) {
  return useQuery<{ client_slug: string }[]>({
    queryKey: ["own-client-links"],
    enabled,
    queryFn: async () => {
      const { data, error } = await db().from("client_members").select(CLIENT_LINK_COLUMNS);
      if (error) throw new Error(error.message);
      return (data || []) as { client_slug: string }[];
    },
  });
}

/** One row per task id; a later row replaces an earlier one, in the earlier row's position. */
export function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const byId = new Map<string, T>();
  for (const r of rows) byId.set(r.id, r);
  return [...byId.values()];
}

/**
 * Everything the cycle view needs: the board cards and the delivered list as one list, the engagement
 * dates, and whether the past-cycle part failed to load (the board still shows; the page says so).
 */
export function useClientCycles(accountId?: string, own = false) {
  const board = usePipelineTasks(accountId, own);
  const delivered = usePipelineDelivered(accountId, own);
  const engagements = useCycleEngagements(own);
  // A task can be on the board and in the delivered list at once (it is copied when delivered):
  // keep one row per task id and prefer the delivered row.
  const tasks = board.data ? dedupeById([...board.data, ...(delivered.data ?? [])]) : undefined;
  return {
    tasks,
    boardTasks: board.data,
    engagements: engagements.data ?? [],
    isLoading: board.isLoading,
    isError: board.isError,
    pastCyclesFailed: delivered.isError,
    refetch: () => Promise.all([board.refetch(), delivered.refetch(), ...(own ? [engagements.refetch()] : [])]),
  };
}
