/**
 * A client with two ad accounts (Miracle) has pipeline cards with no account_id: the sync writes it only when
 * the client has exactly one linked account. Staff pick one account on /pipeline, so the board and the
 * delivered list must also match the client_slug of the client that owns the account.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  log: [] as Array<{ table: string; ops: string[] }>,
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
  return { supabase: { from: (table: string) => ({ select: () => chain(table) }) } };
});

import { staffAccountFilter, usePipelineDelivered, usePipelineTasks } from "@/hooks/usePipelineTasks";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.tables = {};
  h.log.length = 0;
});

describe("staffAccountFilter", () => {
  it("matches the account and every client that owns it", async () => {
    h.tables.client_ad_accounts = [{ client_slug: "miracle" }];
    expect(await staffAccountFilter("act_1")).toBe("account_id.eq.act_1,client_slug.in.(miracle)");
    expect(h.log[0]).toMatchObject({ table: "client_ad_accounts", ops: ["eq account_id,act_1"] });
  });

  it("matches only the account when it belongs to no client", async () => {
    h.tables.client_ad_accounts = [];
    expect(await staffAccountFilter("act_2")).toBe("account_id.eq.act_2");
  });

  it("drops a slug that is not lowercase letters, digits and hyphens, so it cannot add a filter", async () => {
    h.tables.client_ad_accounts = [{ client_slug: "ok-one" }, { client_slug: "bad),account_id.neq.x" }, { client_slug: null }];
    expect(await staffAccountFilter("act_3")).toBe("account_id.eq.act_3,client_slug.in.(ok-one)");
  });
});

describe("staff board and delivered list for a multi-account client", () => {
  it("the board sends the account and client filter in one or()", async () => {
    h.tables.client_ad_accounts = [{ client_slug: "miracle" }];
    h.tables.pipeline_tasks = [{ id: "a", stage: "Editing", due_date: null }];
    const r = renderHook(() => usePipelineTasks("act_1"), { wrapper: wrapper() });
    await waitFor(() => expect(r.result.current.data).toHaveLength(1));
    const board = h.log.find((e) => e.table === "pipeline_tasks")!;
    expect(board.ops).toContain("or account_id.eq.act_1,client_slug.in.(miracle)");
    expect(board.ops.some((o) => o.startsWith("eq account_id"))).toBe(false);
  });

  it("the delivered list does the same", async () => {
    h.tables.client_ad_accounts = [{ client_slug: "miracle" }];
    h.tables.pipeline_delivered = [{ id: "d" }];
    const r = renderHook(() => usePipelineDelivered("act_2"), { wrapper: wrapper() });
    await waitFor(() => expect(r.result.current.data).toHaveLength(1));
    const done = h.log.find((e) => e.table === "pipeline_delivered")!;
    expect(done.ops).toContain("or account_id.eq.act_2,client_slug.in.(miracle)");
  });

  it("a client login sends no filter and reads no links", async () => {
    h.tables.pipeline_tasks = [{ id: "a", stage: "Editing", due_date: null }];
    const r = renderHook(() => usePipelineTasks(undefined, true), { wrapper: wrapper() });
    await waitFor(() => expect(r.result.current.data).toHaveLength(1));
    expect(h.log.some((e) => e.table === "client_ad_accounts")).toBe(false);
    expect(h.log.find((e) => e.table === "pipeline_tasks")!.ops.some((o) => o.startsWith("or ") || o.startsWith("eq "))).toBe(false);
  });
});
