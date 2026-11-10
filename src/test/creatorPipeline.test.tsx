/**
 * Creator pipeline (consolidation step 5a, port of the old dashboard Pipeline).
 *
 * - The brand lives in ?brand=; one brand shows every stage, All brands opens
 *   on the production stages and can widen to all active stages.
 * - Stage, owner and follow-up changes call updateAssignment; delivery goes
 *   through saveDelivery; add and remove change creator_assignments.
 * - The roster picker leaves out creators already on the brand and do-not-use ones.
 * - It is not the Content Pipeline and links to the old dashboard for approval boards.
 * The row rules are in supabase/tests/dashboard_batch1_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignment } from "@/features/dashboard/model";

const api = {
  loadBrandsAndTeam: vi.fn(),
  loadAssignments: vi.fn(),
  loadCreatorOptions: vi.fn(),
  updateAssignment: vi.fn(),
  addCreatorsToBrand: vi.fn(),
  removeAssignment: vi.fn(),
  saveDelivery: vi.fn(),
};
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
vi.mock("@/features/dashboard/api", () => ({
  DashboardError: class extends Error { code?: string },
  loadBrandsAndTeam: () => api.loadBrandsAndTeam(),
  loadAssignments: (b: string) => api.loadAssignments(b),
  loadCreatorOptions: () => api.loadCreatorOptions(),
  updateAssignment: (...a: unknown[]) => api.updateAssignment(...a),
  addCreatorsToBrand: (...a: unknown[]) => api.addCreatorsToBrand(...a),
  removeAssignment: (...a: unknown[]) => api.removeAssignment(...a),
  saveDelivery: (...a: unknown[]) => api.saveDelivery(...a),
}));

import CreatorPipelinePage from "@/features/dashboard/CreatorPipelinePage";
import { ACTIVE_STAGES, PRODUCTION_STAGES, addableCreators, boardColumns, currentAppUser, groupByStage, ownerOptions } from "@/features/dashboard/model";

const row = (id: string, stage: string, slug = "glow", extra: Partial<Assignment> = {}): Assignment => ({
  id, creator_id: `c-${id}`, client_slug: slug, stage, owner_id: null, next_follow_up_at: null, next_follow_up_source: null,
  tracking_number: null, product_delivered_at: null, brief_name: null, notes: null,
  dashboard_creators: { name: `Creator ${id}`, scale: 3, do_not_use_again: false }, ...extra,
});
const USERS = [
  { id: "u1", name: "Ellie", email: "ellie@example.test", role: "producer", active: true },
  { id: "u2", name: "Gone", email: "gone@example.test", role: "producer", active: false },
];

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.loadBrandsAndTeam.mockResolvedValue({
    brands: [
      { slug: "glow", name: "Glow Co", active: true, does_creators: true },
      { slug: "shoot", name: "Shoot Co", active: true, does_creators: false },
      { slug: "north", name: "North Co", active: true, does_creators: true },
    ],
    users: USERS,
  });
  api.updateAssignment.mockResolvedValue(undefined);
});

const renderAt = (search = "") => render(<MemoryRouter initialEntries={[`/builder/creator-pipeline${search}`]}><CreatorPipelinePage /></MemoryRouter>);

describe("Creator pipeline page", () => {
  it("asks for a brand and offers only creator-line brands", async () => {
    renderAt();
    expect(await screen.findByText(/Choose a brand, or All brands/)).toBeTruthy();
    const options = within(screen.getByLabelText("Brand")).getAllByRole("option").map((o) => o.textContent);
    await waitFor(() => expect(within(screen.getByLabelText("Brand")).getAllByRole("option").length).toBe(4));
    expect(options[0]).toBe("Choose a brand");
    expect(screen.queryByRole("option", { name: "Shoot Co" })).toBeNull();
    expect(api.loadAssignments).not.toHaveBeenCalled();
  });

  it("shows one brand on every stage and saves stage, owner and follow-up changes", async () => {
    api.loadAssignments.mockResolvedValue([row("1", "sourced"), row("2", "product_shipped", "glow", { owner_id: "u2" })]);
    renderAt("?brand=glow");
    const sourced = await screen.findByRole("region", { name: "Sourced" });
    expect(api.loadAssignments).toHaveBeenCalledWith("glow");
    expect(within(sourced).getByText("Creator 1")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Passed" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Stage for Creator 1"), { target: { value: "contract_sent" } });
    await waitFor(() => expect(api.updateAssignment).toHaveBeenCalledWith("1", { stage: "contract_sent" }));
    fireEvent.change(screen.getByLabelText("Owner for Creator 1"), { target: { value: "u1" } });
    await waitFor(() => expect(api.updateAssignment).toHaveBeenCalledWith("1", { owner_id: "u1" }));
    fireEvent.change(screen.getByLabelText("Follow-up for Creator 1"), { target: { value: "2026-11-20" } });
    await waitFor(() => expect(api.updateAssignment).toHaveBeenCalledWith("1", { next_follow_up_at: "2026-11-20" }));
    // The deactivated owner still labels the card that has them.
    expect(within(screen.getByLabelText("Owner for Creator 2")).getByRole("option", { name: "Gone (inactive)" })).toBeTruthy();
    expect(within(screen.getByLabelText("Owner for Creator 1")).queryByRole("option", { name: /Gone/ })).toBeNull();
  });

  it("records delivery on shipping stages", async () => {
    api.loadAssignments.mockResolvedValue([row("2", "product_shipped")]);
    api.saveDelivery.mockResolvedValue({});
    renderAt("?brand=glow");
    fireEvent.change(await screen.findByLabelText("Tracking number for Creator 2"), { target: { value: " 1Z99 " } });
    fireEvent.change(screen.getByLabelText("Delivered on for Creator 2"), { target: { value: "2026-11-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Save delivery" }));
    await waitFor(() => expect(api.saveDelivery).toHaveBeenCalledWith("2", "1Z99", "2026-11-09"));
  });

  it("adds creators from the roster and removes one after confirming", async () => {
    api.loadAssignments.mockResolvedValue([row("1", "sourced")]);
    api.loadCreatorOptions.mockResolvedValue([
      { id: "c-1", name: "Creator 1", scale: 3, do_not_use_again: false },
      { id: "c-9", name: "Nine", scale: 2, do_not_use_again: false },
      { id: "c-8", name: "Banned", scale: 1, do_not_use_again: true },
    ]);
    api.addCreatorsToBrand.mockResolvedValue(undefined);
    api.removeAssignment.mockResolvedValue(undefined);
    renderAt("?brand=glow");
    fireEvent.click(await screen.findByRole("button", { name: "Add creators" }));
    const picker = await screen.findByRole("group", { name: "Add creators" });
    expect(within(picker).queryByText("Banned")).toBeNull();
    expect(within(picker).queryByText(/Creator 1/)).toBeNull();
    fireEvent.click(within(picker).getByRole("checkbox"));
    fireEvent.click(within(picker).getByRole("button", { name: "Add 1 creator" }));
    await waitFor(() => expect(api.addCreatorsToBrand).toHaveBeenCalledWith("glow", ["c-9"]));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove from brand" }));
    await waitFor(() => expect(api.removeAssignment).toHaveBeenCalledWith("1"));
  });

  it("opens All brands on the production stages, with brand names and no remove button", async () => {
    api.loadAssignments.mockResolvedValue([row("1", "sourced", "north"), row("2", "shooting", "north")]);
    renderAt("?brand=all");
    const shooting = await screen.findByRole("region", { name: "Shooting" });
    expect(within(shooting).getByText("North Co")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Sourced" })).toBeNull();
    expect(screen.getByText(/1 creators are in stages not shown/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove from brand" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Stages shown"), { target: { value: "all" } });
    expect(await screen.findByRole("region", { name: "Sourced" })).toBeTruthy();
  });

  it("shows a list view and the old dashboard link for approval boards", async () => {
    api.loadAssignments.mockResolvedValue([row("1", "brief_sent", "glow", { brief_name: "Brief A", owner_id: "u1", next_follow_up_at: "2026-11-12" })]);
    renderAt("?brand=glow");
    await screen.findByRole("region", { name: "Brief Sent" });
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const table = screen.getByRole("table", { name: "Creator list" });
    expect(table).toHaveTextContent("Creator 1Brief SentEllieNov 12, 2026Brief A");
    expect(screen.getByRole("link", { name: "old dashboard" }).getAttribute("href")).toBe("https://goodostudios-production.vercel.app/pipeline?brand=glow");
    expect(screen.getByRole("link", { name: "Client page" }).getAttribute("href")).toBe("/builder/clients/glow");
  });
});

describe("creator pipeline model", () => {
  it("picks columns by brand and scope", () => {
    expect(boardColumns("glow", "production")).toHaveLength(18);
    expect(boardColumns("all", "production")).toEqual(PRODUCTION_STAGES);
    expect(boardColumns("all", "all")).toEqual(ACTIVE_STAGES);
    expect(ACTIVE_STAGES).not.toContain("declined");
  });
  it("groups by stage and leaves out unknown stages", () => {
    const g = groupByStage([row("b", "sourced"), row("a", "sourced"), row("x", "weird")], ["sourced"]);
    expect(g.get("sourced")?.map((r) => r.id)).toEqual(["a", "b"]);
    expect(g.has("weird")).toBe(false);
  });
  it("filters the roster and the owners, and finds the signed-in staff row by email", () => {
    expect(addableCreators([{ id: "c-1", name: "A", scale: null, do_not_use_again: false }, { id: "c-2", name: "B", scale: null, do_not_use_again: false }], [row("1", "sourced")], "").map((c) => c.id)).toEqual(["c-2"]);
    expect(ownerOptions(USERS, null).map((u) => u.id)).toEqual(["u1"]);
    expect(ownerOptions(USERS, "u2").map((u) => u.id)).toEqual(["u1", "u2"]);
    expect(currentAppUser(USERS, "ELLIE@example.test")?.id).toBe("u1");
    expect(currentAppUser(USERS, null)).toBeNull();
  });
});
