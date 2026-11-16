// Audit 7.3 / 6.1: the report chart read raw daily rows (one per ad per day) in one select,
// ordered by date. PostgREST returns at most 1,000 rows, so the newest days dropped off first,
// and ROAS, CPA and CTR were averages of per-ad values instead of totals over totals.
// The chart must use the database's daily totals (get_daily_trends).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const captured: { dates: string[]; values: number[] }[] = [];
vi.mock("@/components/MultiLineTrendChart", () => ({
  MultiLineTrendChart: (props: { dates: string[]; lines: { values: number[] }[] }) => {
    captured.push({ dates: props.dates, values: props.lines[0].values });
    return null;
  },
}));

// 30 days x 100 ads = 3,000 raw rows; a plain select returns only the first 1,000 (days 1-10).
const DAYS = Array.from({ length: 30 }, (_, i) => `2020-06-${String(i + 1).padStart(2, "0")}`);
const rawRows = DAYS.flatMap((date) =>
  Array.from({ length: 100 }, (_, a) => ({
    date,
    spend: a === 0 ? 900 : 1, // one big spender per day
    roas: a === 0 ? 1 : 10, // 99 tiny ads with a high ROAS
    cpa: 5,
    ctr: 1,
  })),
);
// Daily totals for the same data: spend 999, purchase value 900*1 + 99*10 = 1,890.
const totals = DAYS.map((date) => ({
  trend_date: date, spend: 999, impressions: 100000, clicks: 1000, purchases: 50, purchase_value: 1890,
  adds_to_cart: 0, video_views: 0, avg_frequency: 1, active_ad_count: 100,
}));

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const select = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["gte", "lte", "order", "eq"]) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rawRows.slice(0, 1000), error: null }).then(resolve);
    return q;
  };
  return { supabase: { from: () => ({ select }), rpc: (...args: unknown[]) => rpc(...args) } };
});

import { ChartSection } from "@/components/reports/sections/ChartSection";

function renderChart(metric: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ChartSection
        config={{ metric }}
        report={{ account_id: "act_a", date_range_start: DAYS[0], date_range_end: DAYS[29] }}
      />
    </QueryClientProvider>,
  );
}

describe("report chart uses daily totals", () => {
  beforeEach(() => {
    captured.length = 0;
    rpc.mockReset();
    rpc.mockResolvedValue({ data: totals, error: null });
  });

  it("shows every day in the range, including the newest", async () => {
    renderChart("spend");
    await waitFor(() => expect(captured.at(-1)?.dates.length).toBe(30));
    expect(captured.at(-1)!.dates.at(-1)).toBe("2020-06-30");
    expect(captured.at(-1)!.values.every((v) => v === 999)).toBe(true);
  });

  it("reads totals for the report's account and dates", async () => {
    renderChart("spend");
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("get_daily_trends", { p_account_id: "act_a", p_from: DAYS[0], p_to: DAYS[29] });
  });

  it("ROAS is purchase value over spend, not an average of per-ad ROAS", async () => {
    renderChart("roas");
    await waitFor(() => expect(captured.at(-1)?.values.length).toBe(30));
    expect(captured.at(-1)!.values[0]).toBeCloseTo(1890 / 999, 6);
  });

  it("CPA is spend over purchases and CTR is clicks over impressions", async () => {
    renderChart("cpa");
    await waitFor(() => expect(captured.at(-1)?.values.length).toBe(30));
    expect(captured.at(-1)!.values[0]).toBeCloseTo(999 / 50, 6);
    captured.length = 0;
    renderChart("ctr");
    await waitFor(() => expect(captured.at(-1)?.values.length).toBe(30));
    expect(captured.at(-1)!.values[0]).toBeCloseTo(1, 6);
  });
});
