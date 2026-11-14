/**
 * Goodo OS OS-024: the five original Creative data pages (Overview, Creatives, Analytics,
 * Tagging, Reports) are on the page kit. Each one shows skeleton rows while loading (no
 * spinner), an empty state with exactly one action, and change values in neutral grey with
 * an arrow (never green or red).
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { idle, metrics, stub } = vi.hoisted(() => ({
  idle: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  metrics: { totalSpend: 1200, activeCount: 4, avgCpa: 30, avgRoas: 2.1, winRate: 25, avgCtr: 1.2 },
  stub: (id: string) => () => <div data-testid={id} />,
}));

const h = vi.hoisted(() => ({
  auth: { user: { id: "u1" }, role: "builder", isClient: false, isBuilder: true, isEmployee: false } as Record<string, unknown>,
  navigate: vi.fn(),
  setDateRange: vi.fn(),
  sync: vi.fn(),
  loading: false,
  creatives: [] as Record<string, unknown>[],
  noDailyData: false,
  reports: [] as Record<string, unknown>[],
  hasPrev: false,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({
    accounts: [{ id: "act_1", name: "Glow" }],
    isLoading: false,
    selectedAccountId: "act_1",
    selectedAccount: { id: "act_1", name: "Glow" },
    setSelectedAccountId: () => {},
  }),
}));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => ({ isClientPreview: false }) }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder", useRoleNavigate: () => h.navigate }));
vi.mock("@/hooks/useSyncApi", () => ({ useSync: () => ({ mutate: h.sync, isPending: false }) }));
vi.mock("@/hooks/useIsSyncing", () => ({ useIsSyncing: () => false }));
vi.mock("@/hooks/usePipelineTasks", () => ({ useOwnClientLinks: () => ({ isLoading: false, data: [] }) }));
vi.mock("@/hooks/useWoWTrends", () => ({ useWoWTrends: () => ({ data: undefined }) }));
vi.mock("@/hooks/useCardPresence", () => ({ useCardPresence: () => ({ hoveredCards: new Map(), setHoveredCard: () => {} }) }));
vi.mock("@/hooks/useAllCreatives", () => ({ useAllCreatives: () => ({ data: [] }) }));
vi.mock("@/hooks/useAccountsApi", () => ({
  useUploadMappings: () => ({ mutate: () => {}, isPending: false }),
  useAccounts: () => ({ data: [] }),
}));
vi.mock("@/hooks/useCreatives", () => ({
  CREATIVES_PAGE_SIZE: 50,
  useCreatives: () => ({ isLoading: h.loading, data: { data: h.creatives, total: h.creatives.length, no_daily_data: h.noDailyData } }),
  useCreativeFilters: () => ({ data: {} }),
  useUpdateCreative: idle,
  useAutoTagPreview: idle,
  useAutoTagApply: idle,
}));
vi.mock("@/hooks/useReportsApi", () => ({
  useReports: () => ({ isLoading: h.loading, data: h.reports }),
  useReportSchedules: () => ({ data: [] }),
  useGenerateReport: idle,
  useDeleteReport: idle,
  useSendReportToSlack: idle,
  useUpsertReportSchedule: idle,
}));
vi.mock("@/hooks/useOverviewPageState", () => ({
  useOverviewPageState: () => ({
    accountName: "Glow",
    lastSyncedAgo: null,
    dateFrom: "2026-11-01",
    dateTo: "2026-11-07",
    setDateRange: h.setDateRange,
    metrics: h.creatives.length ? metrics : { totalSpend: 0, activeCount: 0, avgCpa: 0, avgRoas: 0, winRate: 0, avgCtr: 0 },
    // Spend went up 20%, CPA went up 50% (worse).
    prevMetrics: { ...metrics, totalSpend: 1000, avgCpa: 20 },
    hasPrevPeriod: h.hasPrev,
    isLoading: h.loading,
    creatives: h.creatives,
    selectedAccountId: "act_1",
  }),
}));
vi.mock("@/hooks/useAnalyticsPageState", () => ({
  useAnalyticsPageState: () => ({
    activeTab: "leaderboard", setActiveTab: () => {}, selectedCreative: null, setSelectedCreative: () => {},
    dateFrom: "2026-11-01", dateTo: "2026-11-07", setDateRange: h.setDateRange,
    selectedAccountId: "act_1", selectedAccount: {},
    creatives: h.creatives, isLoading: h.loading, filteredTrendData: [], trendsLoading: false,
    roasThreshold: 2, spendThreshold: 50, killScaleConfig: {},
  }),
}));
vi.mock("@/hooks/useCreativesPageState", () => ({
  useCreativesPageState: () => ({
    viewMode: "table", setViewMode: () => {}, visibleCols: new Set(["creative", "spend"]), toggleCol: () => {},
    columnOrder: ["creative", "spend"], handleReorder: () => {},
    filters: {}, updateFilter: () => {}, dateFrom: "2026-11-01", dateTo: "2026-11-07", setDateRange: h.setDateRange,
    selectedCreativeId: null, setSelectedCreativeId: () => {}, groupBy: "__none__", setGroupBy: () => {},
    sort: { key: "spend", direction: "desc" }, handleSort: () => {}, page: 0, setPage: () => {},
    searchInput: "", setSearchInput: () => {}, search: "",
    selectedAccountId: "act_1", allFilters: {}, advancedConditions: [], setAdvancedConditions: () => {},
  }),
}));

// Heavy children that are not under test.
vi.mock("@/components/DateRangeFilter", () => ({ DateRangeFilter: stub("date-range") }));
vi.mock("@/components/CreativeDetailModal", () => ({ CreativeDetailModal: stub("detail-modal"), useAdPreviewPrefetch: () => () => {} }));
vi.mock("@/components/SyncStatusBanner", () => ({ SyncStatusBanner: stub("sync-banner") }));
vi.mock("@/components/MediaRefreshBanner", () => ({ MediaRefreshBanner: stub("media-banner") }));
vi.mock("@/components/ColumnPicker", () => ({ ColumnPicker: stub("column-picker") }));
vi.mock("@/components/creatives/CreativesFilters", () => ({ CreativesFilters: stub("creatives-filters") }));
vi.mock("@/components/creatives/CreativesTable", () => ({ CreativesTable: stub("creatives-table") }));
vi.mock("@/components/analytics/LeaderboardTab", () => ({ LeaderboardTab: stub("leaderboard") }));
vi.mock("@/components/analytics/TrendsTab", () => ({ TrendsTab: stub("trends") }));
vi.mock("@/components/analytics/IterationsTab", () => ({ IterationsTab: stub("iterations") }));
vi.mock("@/components/analytics/TagInsightsTab", () => ({ TagInsightsTab: stub("tag-insights") }));
vi.mock("@/components/analytics/CreativeDnaTab", () => ({ CreativeDnaTab: stub("dna") }));
vi.mock("@/components/analytics/VideoTab", () => ({ VideoTab: stub("video") }));
vi.mock("@/components/tagging/TagHeatmap", () => ({ TagHeatmap: stub("heatmap") }));
vi.mock("@/components/tagging/TaggingProgressBar", () => ({ TaggingProgressBar: stub("progress") }));
vi.mock("@/components/tagging/NamingCheckTab", () => ({ NamingCheckTab: stub("naming") }));
vi.mock("@/components/tagging/QuickTagMode", () => ({ QuickTagMode: stub("quick-tag") }));
vi.mock("@/components/settings/CsvUploadModal", () => ({ CsvUploadModal: stub("csv-modal") }));
vi.mock("@/components/reports/MonthlyRollupModal", () => ({ MonthlyRollupModal: stub("rollup") }));
vi.mock("@/components/reports/PortfolioReportModal", () => ({ PortfolioReportModal: stub("portfolio") }));

import OverviewPage from "@/pages/OverviewPage";
import CreativesPage from "@/pages/CreativesPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import TaggingPage from "@/pages/TaggingPage";
import ReportsPage from "@/pages/ReportsPage";
import { MetricCard, fmt$ } from "@/components/page-kit";
import { RoasTrendArrow } from "@/components/creatives/RoasTrendArrow";

function renderPage(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const PAGES: [string, () => ReactNode][] = [
  ["Overview", () => <OverviewPage />],
  ["Creatives", () => <CreativesPage />],
  ["Analytics", () => <AnalyticsPage />],
  ["Tagging", () => <TaggingPage />],
  ["Reports", () => <ReportsPage />],
];

const COLOUR = /\b(text|bg)-(green|red|emerald|rose|success|destructive|verdant)\b|text-red-\d|text-green-\d|text-emerald-\d|text-rose-\d/;

beforeEach(() => {
  h.loading = false;
  h.creatives = [];
  h.noDailyData = false;
  h.reports = [];
  h.hasPrev = false;
  h.navigate.mockReset();
  h.setDateRange.mockReset();
  h.sync.mockReset();
});

describe.each(PAGES)("%s page on the page kit", (_name, page) => {
  it("sits in the page shell with one h1", () => {
    const { container } = renderPage(page());
    expect(container.querySelector("[data-page-shell]")).not.toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows skeleton rows while loading, not a spinner", () => {
    h.loading = true;
    const { container } = renderPage(page());
    expect(screen.getAllByTestId("loading-state").length).toBeGreaterThan(0);
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });

  it("shows an empty state with exactly one action", () => {
    const { container } = renderPage(page());
    const empty = screen.getByTestId("empty-state");
    expect(within(empty).getAllByRole("button")).toHaveLength(1);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});

describe("empty state actions do what they say", () => {
  it("Overview: staff can sync from the empty state", () => {
    renderPage(<OverviewPage />);
    fireEvent.click(within(screen.getByTestId("empty-state")).getByRole("button", { name: "Sync now" }));
    expect(h.sync).toHaveBeenCalledWith({ account_id: "act_1" });
  });

  it("Creatives: an empty date range offers Show all time", () => {
    h.noDailyData = true;
    renderPage(<CreativesPage />);
    fireEvent.click(within(screen.getByTestId("empty-state")).getByRole("button", { name: "Show all time" }));
    expect(h.setDateRange).toHaveBeenCalledWith(undefined, undefined);
  });

  it("Creatives: no creatives at all points to Settings", () => {
    renderPage(<CreativesPage />);
    fireEvent.click(within(screen.getByTestId("empty-state")).getByRole("button", { name: "Open Settings" }));
    expect(h.navigate).toHaveBeenCalledWith("/settings");
  });

  it("Analytics: Show all time clears the date range", () => {
    renderPage(<AnalyticsPage />);
    fireEvent.click(within(screen.getByTestId("empty-state")).getByRole("button", { name: "Show all time" }));
    expect(h.setDateRange).toHaveBeenCalledWith(undefined, undefined);
  });

  it("Tagging: the default Untagged filter offers Clear filters, then the CSV tab", () => {
    renderPage(<TaggingPage />);
    fireEvent.click(within(screen.getByTestId("empty-state")).getByRole("button", { name: "Clear filters" }));
    fireEvent.click(within(screen.getByTestId("empty-state")).getByRole("button", { name: "Upload a CSV" }));
    expect(screen.getByRole("tab", { name: "CSV Upload" })).toHaveAttribute("data-state", "active");
  });

  it("Reports: staff generate a report; a client goes back to Overview", () => {
    const { unmount } = renderPage(<ReportsPage />);
    expect(within(screen.getByTestId("empty-state")).getByRole("button", { name: "Generate Report" })).toBeInTheDocument();
    unmount();
    h.auth = { ...h.auth, isClient: true, isBuilder: false };
    renderPage(<ReportsPage />);
    fireEvent.click(within(screen.getByTestId("empty-state")).getByRole("button", { name: "Back to Overview" }));
    expect(h.navigate).toHaveBeenCalledWith("/");
    h.auth = { ...h.auth, isClient: false, isBuilder: true };
  });
});

describe("change values are neutral with an arrow", () => {
  it("Overview metric cards: 12px uppercase label, 28px number, grey change line with an arrow", () => {
    h.creatives = [{ ad_id: "a1" }];
    h.hasPrev = true;
    renderPage(<OverviewPage />);
    const cards = screen.getAllByTestId("metric-card");
    expect(cards).toHaveLength(6);
    const spend = cards.find((c) => c.textContent?.includes("Total Spend"))!;
    expect(within(spend).getByText("Total Spend").className).toMatch(/text-\[12px\].*uppercase|uppercase.*text-\[12px\]/);
    expect(within(spend).getByText(fmt$(1200)).className).toContain("text-[28px]");
    const changes = screen.getAllByTestId("metric-change");
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) {
      expect(c.className).toContain("text-muted-foreground");
      expect(c.className).not.toMatch(COLOUR);
      expect(c.textContent).toMatch(/[↑↓→]/);
    }
    // Spend rose 20%; CPA rose 50%: both show an up arrow even though CPA got worse.
    expect(within(spend).getByTestId("metric-change").textContent).toContain("↑");
    expect(within(spend).getByTestId("metric-change").textContent).toContain("20%");
    const cpa = cards.find((c) => c.textContent?.includes("Avg CPA"))!;
    expect(within(cpa).getByTestId("metric-change").textContent).toContain("↑");
    expect(within(cpa).getByTestId("metric-change").textContent).toContain("(worse)");
  });

  it("MetricCard never paints change green or red, whichever way it goes", () => {
    const { rerender } = render(<MetricCard label="ROAS" value="2.1x" trend={{ value: 12, positive: true }} />);
    let change = screen.getByTestId("metric-change");
    expect(change.className).not.toMatch(COLOUR);
    expect(change.textContent).toContain("↑");
    rerender(<MetricCard label="ROAS" value="2.1x" trend={{ value: 12, positive: false }} />);
    change = screen.getByTestId("metric-change");
    expect(change.className).not.toMatch(COLOUR);
    expect(change.textContent).toContain("↓");
    rerender(<MetricCard label="CPA" value="$30" inverse trend={{ value: 8, positive: true }} />);
    expect(screen.getByTestId("metric-change").textContent).toContain("↓");
  });

  it("the week-over-week ROAS arrow in the Creatives table is grey both ways", () => {
    for (const direction of ["up", "down"] as const) {
      const { container, unmount } = render(<RoasTrendArrow trend={{ direction, pctChange: direction === "up" ? 10 : -10 } as never} />);
      const el = container.querySelector("span")!;
      expect(el.textContent).toBe(direction === "up" ? "↑" : "↓");
      expect(el.className).toContain("text-muted-foreground");
      expect(el.className).not.toMatch(COLOUR);
      unmount();
    }
  });
});

describe("Reports table uses the kit table", () => {
  it("has a sticky header, 1px row lines and right-aligned tabular numbers", () => {
    h.reports = [{ id: "r1", account_id: "act_1", report_name: "Week 45", created_at: "2026-11-10T00:00:00Z", creative_count: 12, total_spend: 900, blended_roas: 2.4, win_rate: 30, average_cpa: 25, date_range_days: 7 }];
    renderPage(<ReportsPage />);
    const table = screen.getByRole("table", { name: "Reports" });
    expect(table.className).toContain("[&_tr]:border-b");
    expect(table.querySelector("thead")!.className).toContain("[&_th]:sticky");
    const row = screen.getByTestId("report-row-r1");
    const spend = within(row).getAllByRole("cell")[3];
    expect(spend.className).toContain("text-right");
    expect(spend.className).toContain("tabular-nums");
    fireEvent.click(within(row).getAllByRole("cell")[0]);
    expect(h.navigate).toHaveBeenCalledWith("/reports/r1");
  });
});
