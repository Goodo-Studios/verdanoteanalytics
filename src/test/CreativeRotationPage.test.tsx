/**
 * Creative Rotation page — gating + freshness-toggle wiring.
 *
 * The report ships behind the builder account first (roadmap §4). These lock:
 *   - a non-builder (or builder on a non-builder account) sees the gated notice,
 *     never the report, and never calls the edge fn;
 *   - a builder on the builder account renders KPIs from the edge fn, and the
 *     7/14/30 toggle re-queries with the new fresh_days (fireEvent, per repo
 *     convention — no @testing-library/user-event).
 */
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BUILDER_ACCOUNT_ID = "act_782159176742035";

const getCreativeRotation = vi.fn();
vi.mock("@/lib/api", () => ({
  getCreativeRotation: (...args: unknown[]) => getCreativeRotation(...args),
}));

let mockAuth = { isBuilder: true };
let mockAccount = { selectedAccountId: BUILDER_ACCOUNT_ID, selectedAccount: { id: BUILDER_ACCOUNT_ID, name: "Goodo" }, isLoading: false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockAuth }));
vi.mock("@/contexts/AccountContext", () => ({ useAccountContext: () => mockAccount }));

// Keep DateRangeFilter / PageHeader lightweight — they pull heavy deps.
vi.mock("@/components/DateRangeFilter", () => ({ DateRangeFilter: () => <div data-testid="date-range" /> }));
vi.mock("@/components/MultiLineTrendChart", () => ({ MultiLineTrendChart: () => <div data-testid="chart" /> }));

import CreativeRotationPage from "@/pages/CreativeRotationPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreativeRotationPage />
    </QueryClientProvider>,
  );
}

const sampleResponse = {
  fresh_days: 14,
  from: "2026-01-01",
  to: "2026-03-01",
  kpis: {
    bucket: "total", week_start: null, total_spend: 10000, fresh_spend: 6000, mid_spend: 2000,
    stale_spend: 2000, fresh_spend_pct: 60, spend_weighted_age: 12.3, fresh_purchases: 100,
    fresh_spend_conv: 6000, stale_purchases: 40, fresh_cpa: 60, stale_cpa: 50,
  },
  weekly_age: [],
  cohorts: [],
  new_ads_timeline: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth = { isBuilder: true };
  mockAccount = { selectedAccountId: BUILDER_ACCOUNT_ID, selectedAccount: { id: BUILDER_ACCOUNT_ID, name: "Goodo" }, isLoading: false };
  getCreativeRotation.mockResolvedValue(sampleResponse);
});
afterEach(() => cleanup());

describe("CreativeRotationPage gating", () => {
  it("shows the gated notice and never queries when not the builder account", async () => {
    mockAccount = { ...mockAccount, selectedAccountId: "act_999", selectedAccount: { id: "act_999", name: "Client" } };
    renderPage();
    expect(screen.getByText(/builder account only/i)).toBeInTheDocument();
    expect(getCreativeRotation).not.toHaveBeenCalled();
  });

  it("shows the gated notice for a non-builder role even on the builder account", async () => {
    mockAuth = { isBuilder: false };
    renderPage();
    expect(screen.getByText(/builder account only/i)).toBeInTheDocument();
    expect(getCreativeRotation).not.toHaveBeenCalled();
  });
});

describe("CreativeRotationPage report", () => {
  it("renders freshness KPIs from the edge fn on the builder account", async () => {
    renderPage();
    await waitFor(() => expect(getCreativeRotation).toHaveBeenCalled());
    expect(await screen.findByText("60.0%")).toBeInTheDocument();       // % spend fresh
    expect(screen.getByText("12.3d")).toBeInTheDocument();               // spend-weighted age
    // default fresh window is 14 days
    const call = getCreativeRotation.mock.calls[0];
    expect(call[3]).toBe(14);
  });

  it("re-queries with fresh_days=7 when the 7d toggle is clicked", async () => {
    renderPage();
    await waitFor(() => expect(getCreativeRotation).toHaveBeenCalled());
    fireEvent.click(screen.getByText("7d"));
    await waitFor(() =>
      expect(getCreativeRotation.mock.calls.some((c) => c[3] === 7)).toBe(true),
    );
  });
});
