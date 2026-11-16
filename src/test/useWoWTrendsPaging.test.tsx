import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Regression: useWoWTrends paged creative_daily_metrics ordered by date only. Many rows share a date,
// so offset paging could skip or repeat rows between pages. It must order by (date, ad_id).
const h = vi.hoisted(() => ({
  orders: [] as string[],
  ranges: [] as Array<[number, number]>,
  pages: [] as any[][],
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder: any = {};
  for (const m of ["select", "gte", "lte", "eq"]) builder[m] = () => builder;
  builder.order = (col: string) => {
    h.orders.push(col);
    return builder;
  };
  builder.range = (from: number, to: number) => {
    h.ranges.push([from, to]);
    return Promise.resolve({ data: h.pages.shift() ?? [], error: null });
  };
  return { supabase: { from: () => builder } };
});

import { useWoWTrends } from "@/hooks/useWoWTrends";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useWoWTrends paging", () => {
  beforeEach(() => {
    h.orders.length = 0;
    h.ranges.length = 0;
    h.pages.length = 0;
  });

  it("orders by date then ad_id so offset pages are stable", async () => {
    h.pages.push([]);
    const { result } = renderHook(() => useWoWTrends("act_1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.orders).toEqual(["date", "ad_id"]);
  });

  it("keeps paging until a short page and aggregates rows from every page", async () => {
    const day = (offsetDays: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - offsetDays);
      return d.toISOString().split("T")[0];
    };
    // 1000 filler rows for another ad on the first page, then ad A with spend in both weeks on page 2.
    const full = Array.from({ length: 1000 }, (_, i) => ({ ad_id: `f${i}`, date: day(13), spend: 0, purchase_value: 0 }));
    const second = [
      ...[13, 12, 11].map((n) => ({ ad_id: "A", date: day(n), spend: 10, purchase_value: 10 })),
      ...[3, 2, 1].map((n) => ({ ad_id: "A", date: day(n), spend: 10, purchase_value: 30 })),
    ];
    h.pages.push(full, second);
    const { result } = renderHook(() => useWoWTrends("act_1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.ranges).toEqual([[0, 999], [1000, 1999]]);
    const trend = result.current.data!.get("A")!;
    expect(trend.direction).toBe("up");
    expect(trend.thisWeekRoas).toBeCloseTo(3);
    expect(trend.priorWeekRoas).toBeCloseTo(1);
  });
});
