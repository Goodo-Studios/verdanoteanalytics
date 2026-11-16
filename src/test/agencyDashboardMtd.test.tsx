/**
 * Agency dashboard month to date and pacing (audit plan item 6.5, part 2).
 *
 * The "MTD" labels showed whatever date range was picked, and pacing was spend / monthly
 * target with no allowance for how far into the month we are, so a 30-day range read as 100%
 * paced on the 16th. Month to date is now the real calendar month (UTC days, like the server)
 * and pacing compares it with target x days elapsed / days in month.
 */
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ data: null as unknown }));

vi.mock("@/hooks/useRolePath", () => ({ useRoleNavigate: () => vi.fn(), useRolePrefix: () => "/builder" }));
vi.mock("@/contexts/AccountContext", () => ({
  useAccountContext: () => ({
    accounts: [{ id: "act_1", name: "Glow", target_monthly_spend: 3000 }],
    setSelectedAccountId: () => {},
  }),
}));
vi.mock("@/hooks/useWoWTrends", () => ({ useWoWTrends: () => ({ data: undefined }) }));
vi.mock("@/hooks/useSyncApi", () => ({ useSync: () => ({ mutate: () => {}, isPending: false }) }));
vi.mock("@/contexts/DateRangeContext", () => ({
  useDateRangeContext: () => ({ dateFrom: "2026-10-17", dateTo: "2026-11-15", setDateRange: () => {} }),
}));
vi.mock("@/components/DateRangeFilter", () => ({ DateRangeFilter: () => null }));
vi.mock("@/hooks/useAgencyDashboardData", () => ({ useAgencyDashboardData: () => ({ data: h.data }) }));

import AgencyDashboardPage from "@/pages/AgencyDashboardPage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadPacing = async (): Promise<any> => import("@/lib/monthPacing");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  h.data = {
    creatives: [],
    // Selected range (Oct 17 to Nov 15): $3,000. Real month to date (Nov 1 to 16): $1,000.
    perAccountSpend: new Map([["act_1", 3000]]),
    perAccountRevenue: new Map([["act_1", 6000]]),
    priorMonthSpend: new Map([["act_1", 0]]),
    activeByAccount: new Map([["act_1", 4]]),
    mtdSpendByAccount: new Map([["act_1", 1000]]),
    portfolio: { mtdSpend: 3000, monthToDateSpend: 1000, portfolioRoas: 2, activeCreatives: 4 },
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("agency dashboard month to date", () => {
  it("pacing compares month-to-date spend with the target for the days elapsed", () => {
    render(<MemoryRouter><AgencyDashboardPage /></MemoryRouter>);
    // 16 of 30 days: expected $1,600 by now, $1,000 spent, 63% paced (was 3000 / 3000 = 100%).
    expect(screen.getByText("63%")).toBeTruthy();
    expect(screen.queryByText("100%")).toBeNull();
  });

  it("the MTD tile shows the real month to date, not the picked range", () => {
    render(<MemoryRouter><AgencyDashboardPage /></MemoryRouter>);
    const tile = screen.getByText("Portfolio Spend (MTD)").parentElement as HTMLElement;
    expect(tile.textContent).toContain("$1.0k");
    expect(tile.textContent).not.toContain("$3.0k");
  });
});

describe("monthPacing helpers", () => {
  it("month to date runs from the 1st to today, in UTC days", async () => {
    const { monthToDateRange } = await loadPacing();
    expect(monthToDateRange(new Date("2026-11-16T03:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-16" });
  });

  it("pace is spend over target x days elapsed / days in month, null with no target", async () => {
    const { paceVsTarget } = await loadPacing();
    const now = new Date("2026-11-16T12:00:00Z");
    expect(paceVsTarget(1000, 3000, now)).toBeCloseTo(1000 / 1600);
    expect(paceVsTarget(1000, 0, now)).toBeNull();
  });
});
