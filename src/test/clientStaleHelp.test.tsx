/**
 * Clients page: the Stale badge explains itself in plain words, and the rule is unchanged
 * (no update from HQ for more than 21 days; at exactly 21 days a client is not stale).
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OverviewData } from "@/features/dashboard/api";

const loadOverview = vi.fn();
vi.mock("@/features/dashboard/api", () => ({ loadOverview: () => loadOverview() }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

import OverviewPage from "@/features/dashboard/OverviewPage";
import { STALE_AFTER_DAYS, STALE_HELP, isStale, type DashboardClient } from "@/features/dashboard/model";

const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const client = (slug: string, extra: Partial<DashboardClient> = {}): DashboardClient => ({
  slug, name: slug, status: "active", active: true, does_creators: true, does_production: false, origin: "coda",
  service_type: null, strategist: null, pct_complete: 90, contract_start: null, contract_end: null,
  last_synced: daysAgo(1), scope: null, notes: null, ...extra,
});

beforeEach(() => {
  loadOverview.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

describe("the stale rule", () => {
  it("is unchanged: more than 21 days since the last update from HQ", () => {
    expect(STALE_AFTER_DAYS).toBe(21);
    expect(isStale(daysAgo(21), NOW)).toBe(false);
    expect(isStale(daysAgo(21.1), NOW)).toBe(true);
    expect(isStale(daysAgo(5), NOW)).toBe(false);
  });

  it("the help text names the number of days and says it is about HQ updates, not ad data", () => {
    expect(STALE_HELP).toContain("21 days");
    expect(STALE_HELP).toContain("HQ has not sent an update");
    expect(STALE_HELP).toContain("not at ad data");
    expect(STALE_HELP).not.toMatch(/[–—]/);
  });
});

describe("Stale badge help", () => {
  it("shows the help text on a stale client and the Stale tile, and not on a fresh client", async () => {
    const data: OverviewData = {
      clients: [client("stale", { name: "Stale Co", last_synced: daysAgo(30) }), client("fresh", { name: "Fresh Co" })],
      cards: [],
      engagements: [],
    };
    loadOverview.mockResolvedValue(data);
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    const stale = await screen.findByTestId("overview-health-stale");
    expect(stale.getAttribute("title")).toBe(STALE_HELP);
    expect(within(stale).getByText("Stale")).toBeTruthy();
    expect(within(stale).getByText(STALE_HELP)).toBeTruthy();
    expect(screen.getByTestId("overview-tile-stale").getAttribute("title")).toBe(STALE_HELP);
    expect(screen.queryByTestId("overview-health-fresh")).toBeNull();
  });
});
