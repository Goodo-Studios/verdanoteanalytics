/**
 * Client overview (consolidation step 5a, port of the old dashboard Overview).
 *
 * - Lists every client, whatever its service line, lowest completion first; clients
 *   hidden from the list show only on request, and a search box filters by name.
 * - At risk and Stale tiles count synced clients only (origin is not 'manual');
 *   a hand-made client is never flagged.
 * - Each card shows the Content Pipeline card count from pipeline_tasks and the
 *   active cycle day from engagements, and links to the client page.
 * - No "Coda" wording anywhere.
 * The row rules are in supabase/tests/dashboard_batch1_test.sql.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OverviewData } from "@/features/dashboard/api";

const loadOverview = vi.fn();
vi.mock("@/features/dashboard/api", () => ({ loadOverview: () => loadOverview() }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));

import OverviewPage from "@/features/dashboard/OverviewPage";
import {
  boardSummary,
  clientHealth,
  creatorClients,
  cycleDay,
  isSyncedClient,
  overviewCounts,
  sortByProgress,
  type DashboardClient,
} from "@/features/dashboard/model";

const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const client = (slug: string, extra: Partial<DashboardClient> = {}): DashboardClient => ({
  slug, name: slug, status: "active", active: true, does_creators: true, does_production: false, origin: "coda",
  service_type: null, strategist: null, pct_complete: 50, contract_start: null, contract_end: null,
  last_synced: daysAgo(1), scope: null, notes: null, ...extra,
});

const DATA: OverviewData = {
  clients: [
    client("fresh", { name: "Fresh Co", pct_complete: 90 }),
    client("risky", { name: "Risky Co", pct_complete: 20, last_synced: daysAgo(16), strategist: "Sam" }),
    client("stale", { name: "Stale Co", pct_complete: 70, last_synced: daysAgo(30) }),
    client("handmade", { name: "Handmade Co", origin: "manual", pct_complete: 10, last_synced: null }),
    client("shoots", { name: "Shoots Only", does_creators: false, does_production: true }),
    client("gone", { name: "Gone Co", active: false }),
  ],
  cards: [
    { client_slug: "risky", stage: "Client Review", due_date: null },
    { client_slug: "risky", stage: "Editing", due_date: null },
    { client_slug: "risky", stage: "not a column", due_date: null },
  ],
  engagements: [{ client_slug: "risky", cycle_number: 2, start_date: "2026-10-30", day30_date: null, day45_date: null }],
};

beforeEach(() => {
  loadOverview.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

const renderPage = () => render(<MemoryRouter><OverviewPage /></MemoryRouter>);

describe("Client overview page", () => {
  it("shows the tiles and every client, production-only ones too, lowest completion first", async () => {
    loadOverview.mockResolvedValue(DATA);
    renderPage();
    const cards = await screen.findAllByTestId(/^overview-client-/);
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual([
      "overview-client-handmade", "overview-client-risky", "overview-client-shoots", "overview-client-stale", "overview-client-fresh",
    ]);
    expect(screen.getByTestId("overview-client-shoots")).toHaveTextContent("Production");
    expect(screen.queryByTestId("overview-client-gone")).toBeNull();
    expect(within(screen.getByTestId("overview-tile-clients")).getByText("5")).toBeTruthy();
    expect(within(screen.getByTestId("overview-tile-at-risk")).getByText("1")).toBeTruthy();
    expect(within(screen.getByTestId("overview-tile-stale")).getByText("1")).toBeTruthy();
  });

  it("shows board, cycle and sync facts on a card and links to the client page", async () => {
    loadOverview.mockResolvedValue(DATA);
    renderPage();
    const risky = await screen.findByTestId("overview-client-risky");
    expect(risky.getAttribute("href")).toBe("/builder/clients/risky");
    expect(risky).toHaveTextContent("At risk");
    expect(risky).toHaveTextContent("2 cards, 1 in client review");
    expect(risky).toHaveTextContent("Cycle 2, day 12 of 45");
    expect(risky).toHaveTextContent("Last updated Oct 25, 2026");
    expect(screen.getByTestId("overview-client-handmade")).toHaveTextContent("Added by hand");
    expect(screen.getByTestId("overview-client-fresh")).toHaveTextContent("No active cycle");
    expect(document.body.textContent).not.toMatch(/coda/i);
  });

  it("searches by name or slug and offers the hidden clients on request", async () => {
    loadOverview.mockResolvedValue(DATA);
    renderPage();
    await screen.findByTestId("overview-client-risky");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search clients" }), { target: { value: "co" } });
    expect(screen.getAllByTestId(/^overview-client-/).map((c) => c.getAttribute("data-testid"))).toEqual([
      "overview-client-handmade", "overview-client-risky", "overview-client-stale", "overview-client-fresh",
    ]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search clients" }), { target: { value: "shoots" } });
    expect(screen.getAllByTestId(/^overview-client-/)).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search clients" }), { target: { value: "nothing like this" } });
    expect(screen.getByText("No clients match that search.")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search clients" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Show hidden clients \(1\)/ }));
    expect(screen.getByTestId("overview-client-gone")).toHaveTextContent("Hidden");
    expect(within(screen.getByTestId("overview-tile-clients")).getByText("6")).toBeTruthy();
  });

  it("shows an empty state and an error with a retry", async () => {
    loadOverview.mockResolvedValueOnce({ clients: [], cards: [], engagements: [] });
    const { unmount } = renderPage();
    expect(await screen.findByText("No clients yet.")).toBeTruthy();
    unmount();
    loadOverview.mockRejectedValueOnce(new Error("permission denied"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
  });
});

describe("overview model", () => {
  it("treats only manual as hand-made; coda and unknown values count as synced", () => {
    expect(isSyncedClient("manual")).toBe(false);
    expect(isSyncedClient("coda")).toBe(true);
    expect(isSyncedClient("something-new")).toBe(true);
  });

  it("stale wins over at risk and hand-made clients are never flagged", () => {
    const list = creatorClients(DATA.clients);
    expect(overviewCounts(list, NOW)).toEqual({ total: 4, atRisk: 1, stale: 1 });
    expect(clientHealth(client("x", { pct_complete: 10, last_synced: daysAgo(40) }), NOW)).toBe("stale");
    expect(clientHealth(client("x", { origin: "manual", last_synced: null }), NOW)).toBe("manual");
    expect(clientHealth(client("x", { pct_complete: 60, last_synced: daysAgo(16) }), NOW)).toBe("ok");
  });

  it("a synced client that has never been updated is waiting, not stale or at risk", () => {
    const waiting = client("new", { pct_complete: null, last_synced: null });
    expect(clientHealth(waiting, NOW)).toBe("no_data");
    expect(overviewCounts([waiting], NOW)).toEqual({ total: 1, atRisk: 0, stale: 0 });
  });

  it("sorts missing progress first, then by number and name", () => {
    const sorted = sortByProgress([client("b", { pct_complete: 5 }), client("a", { pct_complete: null }), client("c", { pct_complete: 5, name: "a" })]);
    expect(sorted.map((c) => c.slug)).toEqual(["a", "c", "b"]);
  });

  it("counts board cards per column and ignores unknown columns", () => {
    const s = boardSummary(DATA.cards);
    expect(s.total).toBe(2);
    expect(s.waitingOnClient).toBe(1);
    expect(s.byColumn.Editing).toBe(1);
  });

  it("works out the cycle day from the start date in UTC", () => {
    expect(cycleDay("2026-11-10", NOW)).toBe(1);
    expect(cycleDay("2026-10-30", NOW)).toBe(12);
    expect(cycleDay("2026-11-20", NOW)).toBeNull();
    expect(cycleDay(null, NOW)).toBeNull();
  });
});
