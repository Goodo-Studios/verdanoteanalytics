/**
 * useClientMonthHours reads the month total from the staff-only function time_client_month_seconds,
 * so an employee, who can read only their own time_entries rows, still sees the client's whole
 * total. The hook must not read time_entries itself.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tables: [] as string[],
  rpcs: [] as Array<{ fn: string; args: unknown }>,
  scope: 20 as number | string | null,
  seconds: 12659 as unknown,
  rpcError: null as null | { message: string },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      h.tables.push(table);
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = () => Promise.resolve({ data: { monthly_scope_hours: h.scope }, error: null });
      return b;
    },
    rpc: (fn: string, args: unknown) => {
      h.rpcs.push({ fn, args });
      return Promise.resolve({ data: h.rpcError ? null : h.seconds, error: h.rpcError });
    },
  },
}));

import { useClientMonthHours } from "@/hooks/useTimeReports";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  h.tables = [];
  h.rpcs = [];
  h.scope = 20;
  h.seconds = 12659;
  h.rpcError = null;
});

describe("useClientMonthHours", () => {
  it("takes the total from the staff function and the scope from the clients row", async () => {
    const { result } = renderHook(() => useClientMonthHours("glow", "2026-11-01T05:00:00.000Z", "2026-12-01T05:00:00.000Z"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ seconds: 12659, scopeHours: 20 });
    expect(h.rpcs).toEqual([
      { fn: "time_client_month_seconds", args: { p_client_slug: "glow", p_from: "2026-11-01T05:00:00.000Z", p_to: "2026-12-01T05:00:00.000Z" } },
    ]);
    // The entries are never read under row rules, which hide other people's time from an employee.
    expect(h.tables).toEqual(["clients"]);
  });

  it("reads a bigint that arrives as a string and a missing total as 0", async () => {
    h.seconds = "7200";
    h.scope = "12.5";
    const a = renderHook(() => useClientMonthHours("glow", "a", "b"), { wrapper });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    expect(a.result.current.data).toEqual({ seconds: 7200, scopeHours: 12.5 });

    h.seconds = null;
    h.scope = null;
    const b = renderHook(() => useClientMonthHours("glow", "c", "d"), { wrapper });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    expect(b.result.current.data).toEqual({ seconds: 0, scopeHours: null });
  });

  it("surfaces an error from the function instead of showing 0 hours", async () => {
    h.rpcError = { message: "Only staff can read client hours." };
    const { result } = renderHook(() => useClientMonthHours("glow", "a", "b"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("Only staff can read client hours.");
  });

  it("does not ask when disabled", () => {
    renderHook(() => useClientMonthHours("glow", "a", "b", false), { wrapper });
    expect(h.rpcs).toEqual([]);
  });
});
