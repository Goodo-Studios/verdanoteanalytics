// Audit 7.3: the agency dashboard read one row per (account, ad) from
// get_agency_dashboard_summary. Production has about 6,000 such rows for a month and PostgREST
// returns at most 1,000, so whole accounts dropped out (no spend, no revenue, no card numbers).
// The hook must read get_agency_dashboard_data, which returns everything in one jsonb value.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { useAgencyDashboardData } from "@/hooks/useAgencyDashboardData";

// Accounts act_0..act_10; 600 spending ads each (6,600 ads).
const ACCOUNTS = Array.from({ length: 11 }, (_, i) => `act_${i}`);
const ads = ACCOUNTS.flatMap((account_id) =>
  Array.from({ length: 600 }, (_, j) => ({
    ad_id: `${account_id}_ad_${j}`, account_id, ad_name: `Ad ${j}`, thumbnail_url: null,
    spend: 10, purchase_value: 30, impressions: 1000, frequency_weighted: 2000, frequency_impressions: 1000,
  })),
);
const accountsData = ACCOUNTS.map((account_id) => ({
  account_id, period_spend: 6000, period_revenue: 18000, active_ad_count: 600, prior_spend: 3000,
}));
// What the old per-row RPC gives back at the 1,000-row cap: the first 1,000 (account, ad) rows.
const cappedRows = ads.slice(0, 1000).map((a) => ({
  account_id: a.account_id, period_spend: 6000, period_revenue: 18000, active_ad_count: 600, prior_spend: 3000,
  ad_id: a.ad_id, ad_name: a.ad_name, thumbnail_url: null, ad_spend: a.spend, ad_purchase_value: a.purchase_value,
  ad_impressions: a.impressions, ad_frequency_weighted: a.frequency_weighted, ad_frequency_impressions: a.frequency_impressions,
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("agency dashboard reads every account", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "get_agency_dashboard_data"
          ? { data: { accounts: accountsData, ads }, error: null }
          : { data: cappedRows, error: null },
      ),
    );
  });

  it("every account has its spend, revenue, prior spend and active count", async () => {
    const { result } = renderHook(
      () => useAgencyDashboardData(ACCOUNTS.map((id) => ({ id })), "2020-08-01", "2020-08-31"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const d = result.current.data!;
    for (const id of ACCOUNTS) {
      expect(d.perAccountSpend.get(id)).toBe(6000);
      expect(d.perAccountRevenue.get(id)).toBe(18000);
      expect(d.priorMonthSpend.get(id)).toBe(3000);
      expect(d.activeByAccount.get(id)).toBe(600);
    }
    expect(d.portfolio.mtdSpend).toBe(66000);
    expect(d.portfolio.portfolioRoas).toBe(3);
  });

  it("every spending ad is listed, with ROAS as value over spend and impression-weighted frequency", async () => {
    const { result } = renderHook(
      () => useAgencyDashboardData(ACCOUNTS.map((id) => ({ id })), "2020-08-01", "2020-08-31"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const d = result.current.data!;
    expect(d.creatives.length).toBe(6600);
    expect(d.portfolio.activeCreatives).toBe(6600);
    const one = d.creatives.find((c) => c.ad_id === "act_10_ad_599")!;
    expect(one.roas).toBe(3);
    expect(one.frequency).toBe(2);
  });

  it("asks for the one-value function with the current and prior ranges", async () => {
    const { result } = renderHook(
      () => useAgencyDashboardData([{ id: "act_0" }], "2020-08-01", "2020-08-31"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith("get_agency_dashboard_data", expect.objectContaining({
      p_from: "2020-08-01", p_to: "2020-08-31",
    }));
  });
});
