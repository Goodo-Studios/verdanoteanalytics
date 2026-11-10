/**
 * Crew, staff page (consolidation step 5c, port of the old dashboard's /crew).
 *
 * - Search, role filter, sort and archived toggle; call sheet count per person.
 * - Add and edit through the checked crew functions; name and role required.
 * - Archive only after a confirm; restore without one.
 * The row rules and functions are in supabase/tests/dashboard_crew_page_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrewMember } from "@/features/dashboard/crewModel";

const { FakeDashboardError } = vi.hoisted(() => ({
  FakeDashboardError: class extends Error {
    code?: string;
    constructor(e: { code?: string; message: string }) {
      super(e.message);
      this.code = e.code;
    }
  },
}));
const api = { loadCrew: vi.fn(), createCrewMember: vi.fn(), updateCrewMember: vi.fn(), setCrewActive: vi.fn() };
vi.mock("@/features/dashboard/api", () => ({ DashboardError: FakeDashboardError }));
vi.mock("@/features/dashboard/crewApi", () => ({
  loadCrew: () => api.loadCrew(),
  createCrewMember: (...a: unknown[]) => api.createCrewMember(...a),
  updateCrewMember: (...a: unknown[]) => api.updateCrewMember(...a),
  setCrewActive: (...a: unknown[]) => api.setCrewActive(...a),
}));

import CrewPage from "@/features/dashboard/CrewPage";
import { DEFAULT_CREW_FILTERS, EMPTY_CREW_FORM, filterCrew, formToCrewArgs, mailHref, roleOptions, telHref } from "@/features/dashboard/crewModel";

const member = (id: string, name: string, role: string, extra: Partial<CrewMember> = {}): CrewMember => ({
  id, name, role, rate_notes: null, phone: null, email: null, notes: null, active: true, updated_at: "2026-11-01T00:00:00Z", ...extra,
});
const ROB = member("c1", "Rob Lens", "Videographer", { phone: "555-0130", email: "rob@example.test", rate_notes: "$600 / day" });
const PAT = member("c2", "Pat Grip", "PA");
const OLD = member("c3", "Alex Former", "Stylist", { active: false });

describe("crew model", () => {
  it("filters, sorts and hides archived crew by default", () => {
    const all = [ROB, PAT, OLD];
    expect(filterCrew(all, DEFAULT_CREW_FILTERS).map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(filterCrew(all, { ...DEFAULT_CREW_FILTERS, showArchived: true, sort: "role" }).map((c) => c.id)).toEqual(["c2", "c3", "c1"]);
    expect(filterCrew(all, { ...DEFAULT_CREW_FILTERS, search: "0130" }).map((c) => c.id)).toEqual(["c1"]);
    expect(filterCrew(all, { ...DEFAULT_CREW_FILTERS, role: "PA" }).map((c) => c.id)).toEqual(["c2"]);
    expect(roleOptions([member("x", "X", "Sound")])).toEqual(["Director", "PA", "Sound", "Stylist", "Videographer"]);
  });

  it("links only real phone numbers and emails", () => {
    expect(telHref("(555) 013-0000")).toBe("tel:5550130000");
    expect(telHref("ask Pat")).toBeNull();
    expect(mailHref("rob@example.test")).toBe("mailto:rob@example.test");
    expect(mailHref("rob at example")).toBeNull();
  });

  it("checks the form before any call", () => {
    expect(() => formToCrewArgs(EMPTY_CREW_FORM)).toThrow(/name is required/);
    expect(() => formToCrewArgs({ ...EMPTY_CREW_FORM, name: "X" })).toThrow(/role is required/);
    expect(() => formToCrewArgs({ ...EMPTY_CREW_FORM, name: "X", role: "PA", email: "nope" })).toThrow(/email/);
    expect(formToCrewArgs({ ...EMPTY_CREW_FORM, name: " Sam ", role: " PA ", phone: " " })).toEqual({ p_name: "Sam", p_role: "PA", p_rate_notes: null, p_phone: null, p_email: null, p_notes: null });
  });
});

describe("Crew page", () => {
  let confirmReturn = true;
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset();
    api.loadCrew.mockResolvedValue({ crew: [ROB, PAT, OLD], sheets: new Map([["c1", 3]]) });
    for (const f of [api.createCrewMember, api.updateCrewMember, api.setCrewActive]) f.mockResolvedValue(undefined);
    confirmReturn = true;
    vi.spyOn(window, "confirm").mockImplementation(() => confirmReturn);
  });

  it("lists active crew with contact links, rates and call sheet counts", async () => {
    render(<CrewPage />);
    const rob = await screen.findByTestId("crew-row-c1");
    expect(within(rob).getByText("555-0130").getAttribute("href")).toBe("tel:5550130");
    expect(within(rob).getByText("rob@example.test").getAttribute("href")).toBe("mailto:rob@example.test");
    expect(within(rob).getByText("3")).toBeTruthy();
    expect(screen.queryByTestId("crew-row-c3")).toBeNull();
    expect(screen.getByTestId("crew-count").textContent).toBe("2 shown · 2 active, 1 archived");
    fireEvent.click(screen.getByLabelText("Show archived"));
    expect(within(screen.getByTestId("crew-row-c3")).getByText("Archived")).toBeTruthy();
  });

  it("adds a crew member and refuses a missing role first", async () => {
    render(<CrewPage />);
    await screen.findByTestId("crew-row-c1");
    fireEvent.click(screen.getByText("Add crew member"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dana Boom" } });
    fireEvent.click(screen.getByText("Save"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/role is required/);
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Sound" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(api.createCrewMember).toHaveBeenCalledWith(expect.objectContaining({ p_name: "Dana Boom", p_role: "Sound" })));
  });

  it("edits a crew member", async () => {
    render(<CrewPage />);
    fireEvent.click(within(await screen.findByTestId("crew-row-c2")).getByText("Edit"));
    fireEvent.change(screen.getByLabelText("Rate notes"), { target: { value: "$250 half day" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(api.updateCrewMember).toHaveBeenCalledWith("c2", expect.objectContaining({ p_rate_notes: "$250 half day", p_role: "PA" })));
  });

  it("archives only after a confirm and restores without one", async () => {
    render(<CrewPage />);
    const pat = await screen.findByTestId("crew-row-c2");
    confirmReturn = false;
    fireEvent.click(within(pat).getByText("Archive"));
    expect(api.setCrewActive).not.toHaveBeenCalled();
    confirmReturn = true;
    fireEvent.click(within(pat).getByText("Archive"));
    await waitFor(() => expect(api.setCrewActive).toHaveBeenCalledWith("c2", false));
    fireEvent.click(screen.getByLabelText("Show archived"));
    fireEvent.click(within(screen.getByTestId("crew-row-c3")).getByText("Restore"));
    await waitFor(() => expect(api.setCrewActive).toHaveBeenCalledWith("c3", true));
  });

  it("shows a permission refusal in plain words", async () => {
    api.updateCrewMember.mockRejectedValue(new FakeDashboardError({ code: "42501", message: "Only active staff can edit crew members." }));
    render(<CrewPage />);
    fireEvent.click(within(await screen.findByTestId("crew-row-c1")).getByText("Edit"));
    fireEvent.click(screen.getByText("Save"));
    expect((await screen.findByRole("alert")).textContent).toBe("You do not have permission to do that.");
  });
});
