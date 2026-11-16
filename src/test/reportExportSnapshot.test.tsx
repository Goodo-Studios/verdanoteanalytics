/**
 * Historical report exports use the report's own saved data (audit plan item 6.2).
 *
 * The PDF export built its top creatives and tag mix from today's creatives table, next to
 * the report's original totals, so an old report's export changed every time the account's
 * numbers moved. Exports now come from the snapshot saved when the report was generated;
 * older reports without one use their saved top performers and label the tag mix as not
 * saved instead of filling it with today's data.
 */
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  reports: [] as Record<string, unknown>[],
  live: [] as Record<string, unknown>[],
  tables: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  // Chainable query that resolves to whatever the "live" tables hold right now.
  const query = (table: string) => {
    h.tables.push(table);
    const result = () => ({ data: table === "creatives" ? h.live : [], error: null });
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "gt", "gte", "lte", "order", "limit", "in", "range", "maybeSingle"]) {
      q[m] = () => q;
    }
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  };
  return { supabase: { from: query } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isClient: false, user: { id: "u1" } }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRoleNavigate: () => vi.fn(), useRolePrefix: () => "/builder" }));
vi.mock("@/hooks/useReportsApi", () => ({
  useReports: () => ({ data: h.reports, isLoading: false }),
  useSendReportToSlack: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("@/components/CreativeDetailModal", () => ({ CreativeDetailModal: () => null }));

import ReportDetailPage from "@/pages/ReportDetailPage";

const base = {
  report_name: "October report",
  account_id: "act_1",
  report_type: "standard",
  created_at: "2026-10-31T00:00:00Z",
  creative_count: 2,
  total_spend: 700,
  blended_roas: 2.5,
  date_range_start: "2026-10-01",
  date_range_end: "2026-10-31",
  sections: [{ id: "c1", type: "chart", config: { metric: "roas" } }],
};

const snapshotReport = {
  ...base,
  id: "r-snap",
  top_performers: JSON.stringify([{ ad_id: "a1", ad_name: "Snapshot Ad", roas: 3, spend: 500 }]),
  snapshot: {
    version: 1,
    top_creatives: [{ ad_id: "a1", ad_name: "Snapshot Ad", roas: 3, spend: 500, cpa: 25 }],
    tag_mix: [{ tag: "Snapshot Hook", roas: 2.5, count: 2, spendPct: 100 }],
    chart_series: [{ date: "2026-10-01", spend: 700, purchase_value: 1750, purchases: 20, clicks: 70, impressions: 7000 }],
  },
};

const legacyReport = {
  ...base,
  id: "r-old",
  top_performers: JSON.stringify([{ ad_id: "a2", ad_name: "Saved Performer", roas: 1.5, spend: 200 }]),
  snapshot: null,
};

const renderReport = (id: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/reports/${id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  h.reports = [snapshotReport, legacyReport];
  h.tables = [];
  h.live = [{ ad_id: "a9", ad_name: "Live Today Ad", roas: 9, spend: 9999, cpa: 1, hook: "Live Hook", purchase_value: 89991 }];
});
afterEach(cleanup);

describe("report export uses the report's saved data", () => {
  it("prints the snapshot, and changing today's numbers does not change the export", async () => {
    renderReport("r-snap");
    await flush();
    expect(screen.getAllByText("Snapshot Ad").length).toBeGreaterThan(0);
    expect(screen.getByText("Snapshot Hook")).toBeTruthy();
    expect(screen.queryByText("Live Today Ad")).toBeNull();
    cleanup();

    // Today's creative numbers change; export again.
    h.live = [{ ad_id: "a1", ad_name: "Snapshot Ad renamed", roas: 0.1, spend: 1, hook: "Other Hook", purchase_value: 0.1 }];
    renderReport("r-snap");
    await flush();
    expect(screen.getAllByText("Snapshot Ad").length).toBeGreaterThan(0);
    expect(screen.getByText("3.00x ROAS")).toBeTruthy();
    expect(screen.queryByText("Snapshot Ad renamed")).toBeNull();
    expect(screen.queryByText("Other Hook")).toBeNull();
  });

  it("does not read today's creatives or daily rows when a snapshot exists", async () => {
    renderReport("r-snap");
    await flush();
    expect(h.tables).not.toContain("creatives");
    expect(h.tables).not.toContain("creative_daily_metrics");
  });

  it("an older report uses its saved top performers and labels the tag mix as not saved", async () => {
    renderReport("r-old");
    await flush();
    expect(screen.getAllByText("Saved Performer").length).toBeGreaterThan(0);
    expect(screen.queryByText("Live Today Ad")).toBeNull();
    expect(screen.queryByText("Live Hook")).toBeNull();
    expect(screen.getByText(/tag mix was not saved with this report/i)).toBeTruthy();
    expect(h.tables).not.toContain("creatives");
  });
});
