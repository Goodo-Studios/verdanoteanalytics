/**
 * Creator pipeline (consolidation step 5a, port of the old dashboard Pipeline).
 *
 * - The client comes from the one switcher (no page dropdown); one client shows every stage, All clients opens
 *   on the production stages and can widen to all active stages.
 * - Stage, owner and follow-up changes call updateAssignment; delivery goes
 *   through saveDelivery; add and remove change creator_assignments.
 * - The roster picker leaves out creators already on the brand and do-not-use ones.
 * - It is not the Content Pipeline and links to the Approval boards page (step 5b).
 * The row rules are in supabase/tests/dashboard_batch1_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WithClient } from "./clientSelection";
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
  tracking_number: null, product_delivered_at: null, delivery_notes: null, brief_name: null, notes: null,
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

const renderAt = (slug = "") => render(<WithClient slug={slug}><MemoryRouter initialEntries={["/builder/talent/pipeline"]}><CreatorPipelinePage /></MemoryRouter></WithClient>);

describe("Creator pipeline page", () => {
  it("with no client selected shows every client's creators and has no client dropdown of its own", async () => {
    api.loadAssignments.mockResolvedValue([row("1", "shooting", "north")]);
    renderAt("");
    expect(await screen.findByRole("region", { name: "Shooting" })).toBeTruthy();
    expect(api.loadAssignments).toHaveBeenCalledWith("all");
    expect(screen.queryByLabelText("Brand")).toBeNull();
    expect(screen.queryByLabelText("Client")).toBeNull();
    expect(screen.queryByText(/Choose a brand/)).toBeNull();
  });

  it("shows one brand on every stage and saves stage, owner and follow-up changes", async () => {
    api.loadAssignments.mockResolvedValue([row("1", "sourced"), row("2", "product_shipped", "glow", { owner_id: "u2" })]);
    renderAt("glow");
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
    renderAt("glow");
    fireEvent.change(await screen.findByLabelText("Tracking number for Creator 2"), { target: { value: " 1Z99 " } });
    fireEvent.change(screen.getByLabelText("Delivered on for Creator 2"), { target: { value: "2026-11-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Save delivery" }));
    await waitFor(() => expect(api.saveDelivery).toHaveBeenCalledWith("2", "1Z99", "2026-11-09", null));
  });

  it("keeps the delivery notes when tracking is saved (they were wiped before step 5c)", async () => {
    api.loadAssignments.mockResolvedValue([{ ...row("2", "product_shipped"), delivery_notes: "Left with the doorman" }]);
    api.saveDelivery.mockResolvedValue({});
    renderAt("glow");
    fireEvent.change(await screen.findByLabelText("Tracking number for Creator 2"), { target: { value: "1Z77" } });
    fireEvent.click(screen.getByRole("button", { name: "Save delivery" }));
    await waitFor(() => expect(api.saveDelivery).toHaveBeenCalledWith("2", "1Z77", null, "Left with the doorman"));
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
    renderAt("glow");
    fireEvent.click(await screen.findByRole("button", { name: "Add creators" }));
    const picker = await screen.findByRole("group", { name: "Add creators" });
    expect(within(picker).queryByText("Banned")).toBeNull();
    expect(within(picker).queryByText(/Creator 1/)).toBeNull();
    fireEvent.click(within(picker).getByRole("checkbox"));
    fireEvent.click(within(picker).getByRole("button", { name: "Add 1 creator" }));
    await waitFor(() => expect(api.addCreatorsToBrand).toHaveBeenCalledWith("glow", ["c-9"]));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove from client" }));
    await waitFor(() => expect(api.removeAssignment).toHaveBeenCalledWith("1"));
  });

  it("opens All clients on the production stages, with client names and no remove button", async () => {
    api.loadAssignments.mockResolvedValue([row("1", "sourced", "north"), row("2", "shooting", "north")]);
    renderAt("");
    const shooting = await screen.findByRole("region", { name: "Shooting" });
    expect(within(shooting).getByText("North Co")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Sourced" })).toBeNull();
    expect(screen.getByText(/1 creators are in stages not shown/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove from client" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Stages shown"), { target: { value: "all" } });
    expect(await screen.findByRole("region", { name: "Sourced" })).toBeTruthy();
  });

  it("shows a list view and the link to the brand's approval board", async () => {
    api.loadAssignments.mockResolvedValue([row("1", "brief_sent", "glow", { brief_name: "Brief A", owner_id: "u1", next_follow_up_at: "2026-11-12" })]);
    renderAt("glow");
    await screen.findByRole("region", { name: "Brief Sent" });
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const table = screen.getByRole("table", { name: "Creator list" });
    expect(table).toHaveTextContent("Creator 1Brief SentEllieNov 12, 2026Brief A");
    expect(screen.getByRole("link", { name: "Approval boards" }).getAttribute("href")).toBe("/builder/approval-boards?brand=glow");
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
