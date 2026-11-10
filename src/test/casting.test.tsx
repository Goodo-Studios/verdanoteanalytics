/**
 * Casting, staff page (consolidation step 5c, port of the old dashboard's
 * /production/casting and actor approval panel). The one talent and casting
 * flow (Goodo OS talent pointed at the same actors and links).
 *
 * - Per production client: castings in stage order, closed ones on request;
 *   stage, owner, follow-up and notes written back; add from the roster (not
 *   already cast, not do-not-use); remove after a confirm.
 * - The casting link served by the old dashboard: create with an expiry,
 *   copy, revoke, the client's votes and Apply after a confirm.
 * - The page says that clients use the old dashboard's copy until the release.
 * The row rules and apply_actor_approval_votes are in supabase/tests/dashboard_casting_page_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CastingRow } from "@/features/dashboard/castingModel";
import { WithClient } from "./clientSelection";

const { FakeDashboardError } = vi.hoisted(() => ({
  FakeDashboardError: class extends Error {
    code?: string;
    constructor(e: { code?: string; message: string }) {
      super(e.message);
      this.code = e.code;
    }
  },
}));
const api = vi.hoisted(() => ({
  loadCasting: vi.fn(), loadActorOptions: vi.fn(), updateCasting: vi.fn(), addActors: vi.fn(), removeCasting: vi.fn(),
  createCastingLink: vi.fn(), revokeCastingLink: vi.fn(), applyActorVotes: vi.fn(),
}));
const loadBrandsAndTeam = vi.fn();
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/employee" }));
vi.mock("@/features/dashboard/api", () => ({ DashboardError: FakeDashboardError, loadBrandsAndTeam: () => loadBrandsAndTeam() }));
vi.mock("@/features/dashboard/castingApi", () => api);

import CastingPage from "@/features/dashboard/CastingPage";
import { addableActors, castingUrl, sortCastings, splitActorVotes } from "@/features/dashboard/castingModel";

const row = (id: string, name: string, stage: string, extra: Partial<CastingRow> = {}): CastingRow => ({
  id, actor_id: `act-${id}`, client_slug: "harbor", stage, owner_id: null, next_follow_up_at: null, notes: null, scheduled_shoot_date: null, shoot_id: null,
  actors: { name, gender: "Female", age_range: ["25-34"], do_not_use_again: false }, ...extra,
});
const ROWS = [row("c1", "Indigo Reyes", "booked", { scheduled_shoot_date: "2026-12-04", shoot_id: "s1" }), row("c2", "Jules Carter", "shortlisted"), row("c3", "Kai Morgan", "declined")];
const future = new Date(Date.now() + 5 * 86400000).toISOString();
const LIVE = { id: "b1", client_slug: "harbor", board_type: "actors", token: "tok1", expires_at: future, revoked: false, created_at: "2026-11-01T00:00:00Z" };
const OLD = { ...LIVE, id: "b0", token: "tok0", revoked: true, created_at: "2026-10-01T00:00:00Z" };
const VOTES = [
  { id: "v1", board_id: "b1", assignment_id: "c2", vote: "up" as const, voted_at: "2026-11-08T00:00:00Z", voted_by: "Sam" },
  { id: "v2", board_id: "b1", assignment_id: "c1", vote: "down" as const, voted_at: "2026-11-07T00:00:00Z", voted_by: null },
  { id: "v3", board_id: "b0", assignment_id: "c3", vote: "up" as const, voted_at: "2026-10-02T00:00:00Z", voted_by: null },
];

describe("casting model", () => {
  it("sorts by stage and hides closed castings unless asked", () => {
    expect(sortCastings(ROWS, false).map((r) => r.id)).toEqual(["c2", "c1"]);
    expect(sortCastings(ROWS, true).map((r) => r.id)).toEqual(["c2", "c1", "c3"]);
  });
  it("offers only actors not cast and not do-not-use", () => {
    const all = [{ id: "act-c1", name: "Indigo Reyes", do_not_use_again: false }, { id: "x", name: "Zed", do_not_use_again: false }, { id: "y", name: "Banned", do_not_use_again: true }];
    expect(addableActors(all, ROWS).map((a) => a.id)).toEqual(["x"]);
  });
  it("splits votes and links each to its casting", () => {
    const s = splitActorVotes(VOTES.slice(0, 2), ROWS);
    expect(s.approved[0].row?.id).toBe("c2");
    expect(s.passed[0].row?.id).toBe("c1");
    expect(castingUrl("abc")).toBe("https://goodostudios-production.vercel.app/cast/abc");
  });
});

describe("Casting page", () => {
  beforeEach(() => {
    for (const f of [...Object.values(api), loadBrandsAndTeam]) f.mockReset();
    loadBrandsAndTeam.mockResolvedValue({
      brands: [{ slug: "harbor", name: "Harbor Home", active: true, does_creators: false, does_production: true }, { slug: "glow", name: "Glow Co", active: true, does_creators: true, does_production: false }],
      users: [{ id: "u1", name: "Test Employee", email: "e@example.test", role: "producer", active: true }],
    });
    api.loadActorOptions.mockResolvedValue([{ id: "act-new", name: "Lane Foster", do_not_use_again: false }]);
    api.loadCasting.mockResolvedValue({ castings: ROWS, boards: [LIVE, OLD], votes: VOTES });
    for (const k of ["updateCasting", "addActors", "removeCasting", "createCastingLink", "revokeCastingLink"] as const) api[k].mockResolvedValue(undefined);
    api.applyActorVotes.mockResolvedValue(2);
    vi.spyOn(window, "confirm").mockImplementation(() => true);
  });

  const renderAt = (slug = "harbor") => render(<WithClient slug={slug}><MemoryRouter initialEntries={["/x"]}><Routes><Route path="/x" element={<CastingPage />} /></Routes></MemoryRouter></WithClient>);

  it("asks for a client when none is selected and has no client dropdown of its own", async () => {
    renderAt("");
    expect(await screen.findByTestId("pick-client-prompt")).toHaveTextContent("Pick a client in the switcher at the top of the page to see its castings.");
    expect(screen.queryByLabelText("Client")).toBeNull();
    expect(api.loadCasting).not.toHaveBeenCalled();
  });

  it("loads the castings of the selected client", async () => {
    renderAt("harbor");
    await screen.findByTestId("casting-c1");
    expect(api.loadCasting).toHaveBeenCalledWith("harbor");
    expect(screen.queryByLabelText("Client")).toBeNull();
    expect(screen.queryByTestId("pick-client-prompt")).toBeNull();
    expect(screen.getByRole("link", { name: "Client page" }).getAttribute("href")).toBe("/employee/clients/harbor");
  });

  it("shows castings by stage, links actors, and says the link is served by the old dashboard", async () => {
    renderAt();
    const c1 = await screen.findByTestId("casting-c1");
    expect(within(c1).getByText("Indigo Reyes").getAttribute("href")).toBe("/employee/actors/act-c1");
    expect(within(c1).getByText("Dec 4, 2026")).toBeTruthy();
    expect(screen.queryByTestId("casting-c3")).toBeNull();
    expect(screen.getByTestId("stage-counts").textContent).toBe("Shortlisted 1 · Booked 1 · Declined 1");
    expect(screen.getByTestId("old-dashboard-note").textContent).toMatch(/Public links still open on the old dashboard for now/);
    expect(within(screen.getByTestId("live-link")).getByText("https://goodostudios-production.vercel.app/cast/tok1")).toBeTruthy();
  });

  it("writes stage, owner and follow-up back to the casting", async () => {
    renderAt();
    await screen.findByTestId("casting-c2");
    fireEvent.change(screen.getByLabelText("Stage for Jules Carter"), { target: { value: "client_approved" } });
    await waitFor(() => expect(api.updateCasting).toHaveBeenCalledWith("c2", { stage: "client_approved" }));
    fireEvent.change(screen.getByLabelText("Owner for Jules Carter"), { target: { value: "u1" } });
    await waitFor(() => expect(api.updateCasting).toHaveBeenCalledWith("c2", { owner_id: "u1" }));
    fireEvent.change(screen.getByLabelText("Follow up for Jules Carter"), { target: { value: "2026-11-20" } });
    await waitFor(() => expect(api.updateCasting).toHaveBeenCalledWith("c2", { next_follow_up_at: "2026-11-20" }));
  });

  it("adds an actor from the roster and removes one after a confirm", async () => {
    renderAt();
    await screen.findByTestId("casting-c2");
    fireEvent.change(screen.getByLabelText("Actor to add"), { target: { value: "act-new" } });
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() => expect(api.addActors).toHaveBeenCalledWith("harbor", ["act-new"]));
    fireEvent.click(within(screen.getByTestId("casting-c2")).getByText("Remove"));
    await waitFor(() => expect(api.removeCasting).toHaveBeenCalledWith("c2"));
  });

  it("shows only the live link's votes and applies them after a confirm", async () => {
    renderAt();
    await screen.findByTestId("casting-c1");
    expect(within(screen.getByLabelText("Approved")).getByText("Jules Carter")).toBeTruthy();
    expect(within(screen.getByLabelText("Passed on")).getByText("Indigo Reyes")).toBeTruthy();
    expect(screen.queryByTestId("vote-v3")).toBeNull();
    fireEvent.click(screen.getByText("Apply decisions"));
    await waitFor(() => expect(api.applyActorVotes).toHaveBeenCalledWith("harbor", [{ assignment_id: "c2", vote: "up" }, { assignment_id: "c1", vote: "down" }]));
    expect((await screen.findByRole("status")).textContent).toBe("Applied 2 decisions: 1 approved, 1 declined.");
  });

  it("revokes the live link and makes a new one when none is live", async () => {
    renderAt();
    fireEvent.click(within(await screen.findByTestId("live-link")).getByText("Revoke"));
    await waitFor(() => expect(api.revokeCastingLink).toHaveBeenCalledWith("b1"));
    api.loadCasting.mockResolvedValue({ castings: ROWS, boards: [OLD], votes: [] });
    renderAt();
    const create = await screen.findAllByText("Create link");
    fireEvent.click(create[create.length - 1]);
    await waitFor(() => expect(api.createCastingLink).toHaveBeenCalledWith("harbor", expect.any(Date)));
  });
});
