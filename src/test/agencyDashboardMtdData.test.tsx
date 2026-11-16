/**
 * useAgencyDashboardData reads the real month to date when the picked range is not the
 * calendar month (audit plan item 6.5, part 2).
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as Record<string, string>[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (_name: string, args: Record<string, string>) => {
      h.calls.push(args);
      const spend = args.p_from === "2026-11-01" ? 1000 : 3000;
      // get_agency_dashboard_data returns one jsonb value (audit 7.3).
      return Promise.resolve({
        data: { accounts: [{ account_id: "act_1", period_spend: spend, period_revenue: 0, prior_spend: 0, active_ad_count: 1 }], ads: [] },
        error: null,
      });
    },
  },
}));

import { useAgencyDashboardData } from "@/hooks/useAgencyDashboardData";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  h.calls.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("useAgencyDashboardData month to date", () => {
  it("reads Nov 1 to Nov 16 separately when the picked range is different", async () => {
    const { result } = renderHook(() => useAgencyDashboardData([{ id: "act_1" }], "2026-10-17", "2026-11-15"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.calls.map((c) => [c.p_from, c.p_to])).toEqual([["2026-10-17", "2026-11-15"], ["2026-11-01", "2026-11-16"]]);
    expect(result.current.data!.perAccountSpend.get("act_1")).toBe(3000);
    expect(result.current.data!.mtdSpendByAccount.get("act_1")).toBe(1000);
    expect(result.current.data!.portfolio.monthToDateSpend).toBe(1000);
  });

  it("makes one call when the picked range is the month to date", async () => {
    const { result } = renderHook(() => useAgencyDashboardData([{ id: "act_1" }], "2026-11-01", "2026-11-16"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.calls).toHaveLength(1);
    expect(result.current.data!.mtdSpendByAccount.get("act_1")).toBe(1000);
  });
});
