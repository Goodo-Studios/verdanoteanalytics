/**
 * App audit group A regressions:
 * - one response is capped at 1000 rows, so the selects that can pass it are read in pages with a
 *   stable order (fetchAllPages, loadAssignments, loadFollowUps, loadOverview, home tasks, the
 *   builder everyone view, pipeline board and delivered, client work and delivery tasks);
 * - useSetTaskStatus also refreshes the task lookups behind the modal;
 * - useClientDecide refreshes what useRecordDecision refreshes;
 * - useClientCycles keeps one row per task id and prefers the delivered row.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Rows per table; `range(from, to)` returns the slice, like PostgREST. */
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  log: [] as Array<{ table: string; ops: string[] }>,
  rpcCalls: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const entry = { table, ops: [] as string[] };
    h.log.push(entry);
    let slice: [number, number] | null = null;
    const q: Record<string, unknown> = {};
    for (const op of ["eq", "neq", "or", "not", "in", "gte", "lt", "lte", "ilike"]) {
      q[op] = (...a: unknown[]) => { entry.ops.push(`${op} ${a.join(",")}`); return q; };
    }
    q.order = (c: string) => { entry.ops.push(`order ${c}`); return q; };
    q.range = (from: number, to: number) => { entry.ops.push(`range ${from}-${to}`); slice = [from, to]; return q; };
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      const rows = h.tables[table] ?? [];
      const data = slice ? rows.slice(slice[0], slice[1] + 1) : rows;
      return Promise.resolve({ data, error: null }).then(ok, bad);
    };
    return q;
  };
  return {
    supabase: {
      from: (table: string) => ({ select: () => chain(table) }),
      rpc: (name: string) => { h.rpcCalls.push(name); return Promise.resolve({ data: { status: "approved", task_status: "x" }, error: null }); },
    },
  };
});

import { fetchAllPages } from "@/lib/pagedSelect";
import { loadAssignments, loadFollowUps, loadOverview } from "@/features/dashboard/api";
import { ALL_BRANDS } from "@/features/dashboard/model";
import { useAllWorkTasks } from "@/hooks/useHomeData";
import { useMyTasks } from "@/hooks/useMyWork";
import { dedupeById, useClientCycles, usePipelineDelivered, usePipelineTasks } from "@/hooks/usePipelineTasks";
import { useClientDeliveryTasks, useClientWork } from "@/hooks/useClientWork";
import { useSetTaskStatus } from "@/hooks/useToday";
import { useClientDecide } from "@/hooks/useClientCards";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u" }, isBuilder: true, isEmployee: false, isClient: false }) }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: false, isEmployeePreview: false }) }));

const rowsOf = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, ...extra(i) }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, invalidate };
}
const keysOf = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
const rangesOf = (table: string) => h.log.filter((e) => e.table === table).flatMap((e) => e.ops.filter((o) => o.startsWith("range ")));

beforeEach(() => {
  h.tables = {};
  h.log.length = 0;
  h.rpcCalls.length = 0;
});

describe("fetchAllPages", () => {
  it("walks pages until one is short and keeps every row in order", async () => {
    const all = rowsOf(2503);
    const calls: Array<[number, number]> = [];
    const out = await fetchAllPages(async (from, to) => { calls.push([from, to]); return all.slice(from, to + 1); });
    expect(out).toHaveLength(2503);
    expect(out[2502]).toEqual({ id: "r2502" });
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops after one call when the result is short, and needs one more call after an exact page", async () => {
    expect(await fetchAllPages(async () => rowsOf(3))).toHaveLength(3);
    const calls: number[] = [];
    await fetchAllPages(async (from) => { calls.push(from); return from === 0 ? rowsOf(1000) : []; });
    expect(calls).toEqual([0, 1000]);
  });

  it("passes a database error up and returns nothing", async () => {
    await expect(fetchAllPages(async () => { throw new Error("down"); })).rejects.toThrow("down");
  });
});

describe("selects that pass 1000 rows are read in pages with a stable order", () => {
  it("loadAssignments for every brand, and loadFollowUps", async () => {
    h.tables.creator_assignments = rowsOf(1200);
    expect(await loadAssignments(ALL_BRANDS)).toHaveLength(1200);
    expect(rangesOf("creator_assignments")).toEqual(["range 0-999", "range 1000-1999"]);
    expect(h.log[0].ops).toContain("order id");
    h.log.length = 0;
    expect(await loadFollowUps()).toHaveLength(1200);
    expect(h.log[0].ops).toEqual(expect.arrayContaining(["order next_follow_up_at", "order id"]));
    expect(rangesOf("creator_assignments")).toEqual(["range 0-999", "range 1000-1999"]);
  });

  it("loadOverview reads every pipeline task", async () => {
    h.tables.pipeline_tasks = rowsOf(1500);
    h.tables.clients = [];
    h.tables.engagements = [];
    expect((await loadOverview()).cards).toHaveLength(1500);
  });

  it("useAllWorkTasks (home) and the builder everyone view", async () => {
    h.tables.pipeline_tasks = rowsOf(1100);
    const a = renderHook(() => useAllWorkTasks(), { wrapper: setup().wrapper });
    await waitFor(() => expect(a.result.current.data).toHaveLength(1100));
    h.tables.os_tasks = rowsOf(2100);
    const b = renderHook(() => useMyTasks(undefined, true), { wrapper: setup().wrapper });
    await waitFor(() => expect(b.result.current.data).toHaveLength(2100));
    expect(rangesOf("os_tasks")).toEqual(["range 0-999", "range 1000-1999", "range 2000-2999"]);
  });

  it("pipeline board and delivered, for a client login", async () => {
    h.tables.pipeline_tasks = rowsOf(1001, () => ({ stage: "Editing", due_date: null }));
    h.tables.pipeline_delivered = rowsOf(1700);
    const board = renderHook(() => usePipelineTasks(undefined, true), { wrapper: setup().wrapper });
    await waitFor(() => expect(board.result.current.data).toHaveLength(1001));
    const delivered = renderHook(() => usePipelineDelivered(undefined, true), { wrapper: setup().wrapper });
    await waitFor(() => expect(delivered.result.current.data).toHaveLength(1700));
    expect(delivered.result.current.data?.[0]).toMatchObject({ stage: "Ready to Launch", due_date: null });
    expect(rangesOf("pipeline_delivered")).toEqual(["range 0-999", "range 1000-1999"]);
    expect(h.log.find((e) => e.table === "pipeline_delivered")?.ops).toContain("order id");
  });

  it("client work and the client delivery tasks", async () => {
    h.tables.pipeline_tasks = rowsOf(1300, () => ({ due_date: null }));
    h.tables.pipeline_delivered = rowsOf(1050);
    const work = renderHook(() => useClientWork("glow"), { wrapper: setup().wrapper });
    await waitFor(() => expect(work.result.current.data).toHaveLength(1300));
    const delivery = renderHook(() => useClientDeliveryTasks("glow"), { wrapper: setup().wrapper });
    await waitFor(() => expect(delivery.result.current.data?.delivered).toHaveLength(1050));
    expect(delivery.result.current.data?.open).toHaveLength(1300);
  });
});

describe("useSetTaskStatus", () => {
  it("also refreshes the task lookups behind the task modal", async () => {
    h.tables.os_tasks = [];
    const { wrapper, invalidate } = setup();
    // The update chain is eq-only; the mock chain resolves it like any other query.
    const { result } = renderHook(() => useSetTaskStatus(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "t1", status: "complete" }).catch(() => undefined);
    });
    await waitFor(() => {
      expect(keysOf(invalidate)).toEqual(expect.arrayContaining([
        JSON.stringify(["my-tasks"]),
        JSON.stringify(["today-done"]),
        JSON.stringify(["task-by-clickup-id"]),
        JSON.stringify(["my-task-detail"]),
      ]));
    });
  });
});

describe("useClientDecide", () => {
  it("refreshes the same keys useRecordDecision refreshes, plus the client cards", async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useClientDecide(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ taskId: "t1", decision: "approved" as never });
    });
    await waitFor(() => {
      const keys = keysOf(invalidate);
      for (const k of [["client-decisions"], ["pipeline-tasks"], ["pipeline-delivered"], ["client-work"], ["home"]]) {
        expect(keys).toContain(JSON.stringify(k));
      }
      expect(keys.some((k) => k.includes("client-cards"))).toBe(true);
    });
  });
});

describe("useClientCycles", () => {
  it("dedupeById keeps one row per id, the last one, in first-seen position", () => {
    expect(dedupeById([{ id: "a", v: 1 }, { id: "b", v: 1 }, { id: "a", v: 2 }])).toEqual([{ id: "a", v: 2 }, { id: "b", v: 1 }]);
  });

  it("lists a task once when it is on the board and in the delivered list, preferring the delivered row", async () => {
    h.tables.pipeline_tasks = [
      { id: "dup", task_name: "Board copy", stage: "Ready to Launch", due_date: null },
      { id: "only-board", task_name: "Open", stage: "Editing", due_date: null },
    ];
    h.tables.pipeline_delivered = [{ id: "dup", task_name: "Delivered copy" }, { id: "only-delivered", task_name: "Old" }];
    const { result } = renderHook(() => useClientCycles(undefined, true), { wrapper: setup().wrapper });
    await waitFor(() => expect(result.current.tasks).toBeDefined());
    await waitFor(() => expect(result.current.tasks).toHaveLength(3));
    const tasks = result.current.tasks!;
    expect(tasks.filter((t) => t.id === "dup")).toHaveLength(1);
    expect(tasks.find((t) => t.id === "dup")?.task_name).toBe("Delivered copy");
  });
});
