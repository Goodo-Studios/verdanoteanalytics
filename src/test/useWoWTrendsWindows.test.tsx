import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Audit plan item 6.5, part 1: week-over-week trends compared an 8-day "this week" that
// included today (a partial day) against a 7-day prior week. Both windows are now 7 full
// UTC days ending yesterday: this week = yesterday and the 6 days before, prior week = the
// 7 days before that.
const h = vi.hoisted(() => ({
  filters: [] as Array<[string, string, string]>,
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => {
  // deno-lint-ignore no-explicit-any
  const builder: any = {};
  builder.select = () => builder;
  builder.order = () => builder;
  builder.eq = () => builder;
  builder.gte = (col: string, v: string) => (h.filters.push(["gte", col, v]), builder);
  builder.lte = (col: string, v: string) => (h.filters.push(["lte", col, v]), builder);
  builder.range = () => Promise.resolve({ data: h.rows.splice(0), error: null });
  return { supabase: { from: () => builder } };
});

import { useWoWTrends } from "@/hooks/useWoWTrends";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const row = (date: string, spend: number, purchase_value: number) => ({ ad_id: "A", date, spend, purchase_value });

describe("useWoWTrends compares two full 7-day weeks ending yesterday", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
    h.filters.length = 0;
    h.rows.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("reads 2026-11-02 to 2026-11-15 and leaves today out", async () => {
    h.rows.push(
      // prior week: Nov 2 to Nov 8, ROAS 1
      row("2026-11-02", 10, 10), row("2026-11-05", 10, 10), row("2026-11-08", 10, 10),
      // this week: Nov 9 to Nov 15, ROAS 2
      row("2026-11-09", 10, 20), row("2026-11-12", 10, 20), row("2026-11-15", 10, 20),
      // today, a partial day: must not count
      row("2026-11-16", 100, 0),
    );
    const { result } = renderHook(() => useWoWTrends("act_1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Even if the read returned today's row, it must not count.
    const t = result.current.data!.get("A")!;
    expect(t.thisWeekRoas).toBeCloseTo(2);
    expect(t.priorWeekRoas).toBeCloseTo(1);
    expect(t.direction).toBe("up");
    expect(h.filters).toContainEqual(["gte", "date", "2026-11-02"]);
    expect(h.filters).toContainEqual(["lte", "date", "2026-11-15"]);
  });

  it("a day 8 days back is in the prior week, not this week", async () => {
    h.rows.push(
      row("2026-11-08", 30, 0), row("2026-11-03", 10, 10), row("2026-11-04", 10, 10),
      row("2026-11-09", 10, 10), row("2026-11-10", 10, 10), row("2026-11-11", 10, 10),
    );
    const { result } = renderHook(() => useWoWTrends("act_1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const t = result.current.data!.get("A")!;
    expect(t.thisWeekRoas).toBeCloseTo(1);
    expect(t.priorWeekRoas).toBeCloseTo(20 / 50);
  });
});
