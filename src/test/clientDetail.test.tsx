/**
 * Client page (consolidation step 5a, port of the old dashboard Client Detail).
 *
 * - Synced (legacy origin 'coda') clients show read-only details with the
 *   knowledge-file note; a builder edits a hand-made client through
 *   set_client_details; an employee never gets the form.
 * - Scope and the overview switch are builder-only and call set_client_scope
 *   and set_client_active.
 * - Deliverables by month, cycles, Content Pipeline cards, creator stage counts,
 *   ad accounts and mappings all show for the slug; the step 4b slot is there.
 * - Unknown slug and load errors.
 * The row rules are in supabase/tests/dashboard_batch1_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientDetailData } from "@/features/dashboard/api";

const loadClientDetail = vi.fn();
const saveClientDetails = vi.fn();
const saveClientScope = vi.fn();
const saveClientActive = vi.fn();
let auth = { isBuilder: false };

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
// The month-hours card has its own tests (clientMonthHours.test.tsx); here it is a marker.
vi.mock("@/features/clients/ClientMonthHours", () => ({
  ClientMonthHours: ({ slug }: { slug: string }) => <div data-testid="client-month-hours-stub">{slug}</div>,
}));
vi.mock("@/features/dashboard/api", () => {
  class DashboardError extends Error {
    code?: string;
    constructor(e: { code?: string; message: string }) {
      super(e.message);
      this.code = e.code;
    }
  }
  return {
    DashboardError,
    loadClientDetail: (slug: string) => loadClientDetail(slug),
    saveClientDetails: (...a: unknown[]) => saveClientDetails(...a),
    saveClientScope: (...a: unknown[]) => saveClientScope(...a),
    saveClientActive: (...a: unknown[]) => saveClientActive(...a),
  };
});

import ClientDetailPage from "@/features/dashboard/ClientDetailPage";
import { deliverablesFor, monthOptions, stageCounts } from "@/features/dashboard/model";

const NOW = new Date("2026-11-10T12:00:00Z");

function data(extra: Partial<ClientDetailData["client"]> = {}): ClientDetailData {
  return {
    client: {
      slug: "glow", name: "Glow Co", status: "active", active: true, does_creators: true, does_production: false, origin: "coda",
      service_type: "Performance Creative", strategist: "Sam", pct_complete: 40, contract_start: "2026-09-01", contract_end: "2027-03-01",
      last_synced: "2026-11-09T12:00:00Z", scope: "6 videos per cycle", notes: null, ...extra,
    },
    deliverables: [
      { id: "d1", month: "2026-11", type: "production", status: "in_progress" },
      { id: "d2", month: "2026-11", type: "cycle_brief", status: "complete" },
      { id: "d3", month: "2026-10", type: "report", status: "complete" },
    ],
    adAccounts: [{ account_id: "act_1", ad_accounts: { name: "Glow Meta" } }],
    engagements: [
      { id: "e2", cycle_number: 2, engagement_type: "standard_sprint", status: "active", start_date: "2026-10-30", day30_date: "2026-11-28", day45_date: "2026-12-13" },
      { id: "e1", cycle_number: 1, engagement_type: "standard_sprint", status: "closed", start_date: "2026-09-01", day30_date: "2026-09-30", day45_date: "2026-10-15" },
    ],
    cards: [
      { task_name: "Asset 4", stage: "Client Review", due_date: "2026-11-11", content_type: "UGC" },
      { task_name: "Asset 2", stage: "Production", due_date: null, content_type: "UGC" },
    ],
    assignments: [
      { id: "a1", stage: "contract_sent", next_follow_up_at: null, dashboard_creators: { name: "Avery" } },
      { id: "a2", stage: "sourced", next_follow_up_at: null, dashboard_creators: { name: "Blake" } },
      { id: "a3", stage: "sourced", next_follow_up_at: null, dashboard_creators: { name: "Casey" } },
    ],
    mappings: [{ provider: "clickup", kind: "folder", external_id: "f1", label: "Glow folder" }],
    tasks: [],
    deliveredTasks: [],
  };
}

beforeEach(() => {
  for (const f of [loadClientDetail, saveClientDetails, saveClientScope, saveClientActive]) f.mockReset();
  auth = { isBuilder: false };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

const renderAt = (slug = "glow") =>
  render(
    <MemoryRouter initialEntries={[`/builder/clients/${slug}`]}>
      <Routes><Route path="/builder/clients/:slug" element={<ClientDetailPage />} /></Routes>
    </MemoryRouter>,
  );

describe("Client page, hours this month", () => {
  it("places the month-hours card for this client", async () => {
    loadClientDetail.mockResolvedValue(data());
    renderAt();
    expect(await screen.findByTestId("client-month-hours-stub")).toHaveTextContent("glow");
  });
});

describe("Client page, progress feed", () => {
  it("shows a plain Last updated line from last_synced", async () => {
    loadClientDetail.mockResolvedValue(data());
    renderAt();
    expect(await screen.findByTestId("client-last-updated")).toHaveTextContent("Last updated 1 day ago");
  });

  it("shows a friendly empty state when HQ has not sent anything yet", async () => {
    loadClientDetail.mockResolvedValue(data({ pct_complete: null, last_synced: null }));
    renderAt();
    expect(await screen.findByTestId("client-last-updated")).toHaveTextContent("Waiting for the first update from HQ");
    expect(screen.getByText("No progress yet. It appears after HQ sends its first update.")).toBeTruthy();
  });

  it("derives delivery from ClickUp when the month has tasks, and shows the last delivery day", async () => {
    const d = data();
    d.deliverables.push({ id: "d9", month: "2026-11", type: "delivery", status: "pending" });
    d.tasks = [
      { stage: "Ready to Launch", cycle_month: "2026-11-01", due_date: null, delivered_at: "2026-11-05" },
      { stage: "Production", cycle_month: "2026-11-01", due_date: null, delivered_at: null },
    ];
    loadClientDetail.mockResolvedValue(d);
    renderAt();
    const deliverables = await screen.findByRole("region", { name: "Deliverables" });
    expect(within(deliverables).getByText("1 of 2 delivered, from ClickUp")).toBeTruthy();
    expect(screen.getByTestId("client-last-delivery")).toHaveTextContent("Last delivery");
  });
});

describe("Client page", () => {
  it("shows a synced client read only with every section for its slug", async () => {
    loadClientDetail.mockResolvedValue(data());
    renderAt();
    expect(await screen.findByRole("heading", { name: "Glow Co" })).toBeTruthy();
    expect(loadClientDetail).toHaveBeenCalledWith("glow");
    expect(screen.getByText(/Kept in step with this client's knowledge file/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Edit details" })).toBeNull();
    const deliverables = screen.getByRole("region", { name: "Deliverables" });
    expect(within(deliverables).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Cycle briefComplete", "ProductionIn progress"]);
    fireEvent.change(within(deliverables).getByLabelText("Deliverables month"), { target: { value: "2026-10" } });
    expect(within(deliverables).getByText("Report")).toBeTruthy();
    expect(screen.getByTestId("client-cycle-2")).toHaveTextContent("Cycle 2: Active, day 12 of 45");
    const board = screen.getByRole("region", { name: "Content Pipeline" });
    expect(board).toHaveTextContent("Waiting on the client: Asset 4");
    expect(within(board).getByRole("link", { name: "Open the board" }).getAttribute("href")).toBe("/builder/clients/glow/work");
    expect(screen.getByRole("region", { name: "Creators" })).toHaveTextContent("Sourced: 2");
    expect(screen.getByRole("region", { name: "Linked accounts" })).toHaveTextContent("Ad account: Glow Meta");
    expect(screen.getByRole("region", { name: "Linked accounts" })).toHaveTextContent("clickup folder: Glow folder");
    // Plain links that carry the client, in place of the old "step 4b" placeholder.
    const links = screen.getByTestId("client-detail-engagement-links");
    expect(links.textContent).not.toMatch(/step 4b|step \d/i);
    expect(within(links).getByRole("link", { name: "Scope: Engagements" }).getAttribute("href")).toBe("/builder/clients/glow/scope/engagements");
    expect(within(links).getByRole("link", { name: "Scope: Deliverables" }).getAttribute("href")).toBe("/builder/clients/glow/scope/deliverables");
    expect(screen.queryByRole("button", { name: /overview/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/coda/i);
  });

  it("lets a builder edit a hand-made client, its scope and the overview switch", async () => {
    auth = { isBuilder: true };
    loadClientDetail.mockResolvedValue(data({ origin: "manual" }));
    saveClientDetails.mockResolvedValue({});
    saveClientScope.mockResolvedValue({});
    saveClientActive.mockResolvedValue({});
    renderAt();
    const form = await screen.findByRole("group", { name: "Edit details" });
    fireEvent.change(within(form).getByLabelText("Strategist"), { target: { value: "Robin" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(saveClientDetails).toHaveBeenCalledWith("glow", {
      service_type: "Performance Creative", strategist: "Robin", contract_start: "2026-09-01", contract_end: "2027-03-01", status: "active",
    }));
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: " 8 videos " } });
    fireEvent.click(screen.getByRole("button", { name: "Save scope" }));
    await waitFor(() => expect(saveClientScope).toHaveBeenCalledWith("glow", "8 videos"));
    fireEvent.click(screen.getByRole("button", { name: "Hide from client list" }));
    await waitFor(() => expect(saveClientActive).toHaveBeenCalledWith("glow", false));
  });

  it("gives a builder no details form for a synced client, and shows refusals as written", async () => {
    auth = { isBuilder: true };
    loadClientDetail.mockResolvedValue(data());
    const { DashboardError } = await import("@/features/dashboard/api");
    saveClientScope.mockRejectedValue(new DashboardError({ code: "42501", message: "Only admins can edit a client's scope." }));
    renderAt();
    await screen.findByRole("heading", { name: "Glow Co" });
    expect(screen.queryByRole("group", { name: "Edit details" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save scope" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to do that.");
  });

  it("shows unknown slugs and load errors", async () => {
    loadClientDetail.mockResolvedValueOnce({ ...data(), client: null });
    const { unmount } = renderAt("nope");
    expect(await screen.findByText(/We couldn.t find this client/)).toBeTruthy();
    expect(screen.queryByText(/nope/)).toBeNull();
    expect(screen.getByRole("link", { name: "Go to Clients" }).getAttribute("href")).toBe("/builder/clients");
    unmount();
    loadClientDetail.mockRejectedValueOnce(new Error("boom"));
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});

describe("client page model", () => {
  it("offers the current month plus months with deliverables, newest first", () => {
    expect(monthOptions(data().deliverables, "2026-11")).toEqual(["2026-11", "2026-10"]);
    expect(monthOptions([], "2026-11")).toEqual(["2026-11"]);
  });
  it("orders deliverables by type and counts stages in board order", () => {
    expect(deliverablesFor(data().deliverables, "2026-11").map((d) => d.type)).toEqual(["cycle_brief", "production"]);
    expect(stageCounts(data().assignments)).toEqual([
      { stage: "sourced", label: "Sourced", count: 2 },
      { stage: "contract_sent", label: "Contract Sent", count: 1 },
    ]);
  });
});
