/**
 * Production calendar, staff page (consolidation step 5c, port of the old
 * dashboard's /production/calendar).
 *
 * - One month of shoots grouped by day, month in the address.
 * - Schedule, edit and delete shoots; confirm and remove talent; add, edit and
 *   delete schedule blocks with talent and crew, all through productionApi.
 * - Forms are checked before any call (client, date, block times).
 * The row rules and functions are in supabase/tests/dashboard_production_calendar_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Casting, Shoot } from "@/features/dashboard/productionModel";

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
  loadCalendar: vi.fn(), createShoot: vi.fn(), updateShoot: vi.fn(), deleteShoot: vi.fn(), confirmTalent: vi.fn(), unconfirmTalent: vi.fn(),
  createBlock: vi.fn(), updateBlock: vi.fn(), deleteBlock: vi.fn(),
}));
const loadBrandsAndTeam = vi.fn();
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/employee" }));
vi.mock("@/features/dashboard/api", () => ({ DashboardError: FakeDashboardError, loadBrandsAndTeam: () => loadBrandsAndTeam() }));
vi.mock("@/features/dashboard/productionApi", () => api);

import { answerConfirm } from "@/test/productionConfirm";
import ProductionCalendarPage from "@/features/dashboard/ProductionCalendarPage";
import { EMPTY_BLOCK_FORM, EMPTY_SHOOT_FORM, formToBlockArgs, formToShootArgs, formatTime, groupByDate, monthRange, parseMonth, shiftMonth } from "@/features/dashboard/productionModel";

const shoot = (id: string, date: string, extra: Partial<Shoot> = {}): Shoot => ({
  id, client_slug: "harbor", shoot_date: date, location: "Demo Loft", location_id: "l1", notes: null, shoot_schedule_blocks: [], call_sheets: [], ...extra,
});
const S1 = shoot("s1", "2026-12-04", {
  call_sheets: [{ id: "cs1", revoked: false }],
  shoot_schedule_blocks: [
    { id: "b2", label: "Bathroom", start_time: "13:00:00", end_time: "15:00:00", location: null, notes: null, shoot_schedule_block_talent: [], shoot_schedule_block_crew: [{ crew_member_id: "c1" }] },
    { id: "b1", label: "Kitchen", start_time: "09:00:00", end_time: "12:00:00", location: "Kitchen", notes: "Bring the mugs", shoot_schedule_block_talent: [{ actor_assignment_id: "a1" }], shoot_schedule_block_crew: [] },
  ],
});
const S2 = shoot("s2", "2026-12-18", { client_slug: "pine", location: null, location_id: null });
const cast = (id: string, name: string, shootId: string | null, extra: Partial<Casting> = {}): Casting => ({ id, actor_id: `act-${id}`, client_slug: "harbor", stage: "booked", shoot_id: shootId, actors: { name }, ...extra });
const CASTINGS = [cast("a1", "Indigo Reyes", "s1"), cast("a2", "Jules Carter", null, { stage: "shortlisted" }), cast("a3", "Lane Foster", null, { stage: "declined" })];

describe("production calendar model", () => {
  it("handles months", () => {
    expect(parseMonth("2026-12", new Date())).toBe("2026-12");
    expect(parseMonth("2026-13", new Date("2026-11-10T00:00:00Z"))).toBe("2026-11");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthRange("2027-02")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
  });

  it("groups by day and formats times", () => {
    expect(groupByDate([S2, S1]).map(([d]) => d)).toEqual(["2026-12-04", "2026-12-18"]);
    expect(formatTime("09:05:00")).toBe("9:05 AM");
    expect(formatTime("12:30:00")).toBe("12:30 PM");
    expect(formatTime("00:15:00")).toBe("12:15 AM");
  });

  it("checks shoot and block forms before any call", () => {
    expect(() => formToShootArgs(EMPTY_SHOOT_FORM)).toThrow(/client/);
    expect(() => formToShootArgs({ ...EMPTY_SHOOT_FORM, client_slug: "harbor" })).toThrow(/date/);
    expect(formToShootArgs({ ...EMPTY_SHOOT_FORM, client_slug: "harbor", shoot_date: "2026-12-01", location_id: "l1", location: "ignored" })).toMatchObject({ p_location_id: "l1", p_location: null });
    expect(() => formToBlockArgs(EMPTY_BLOCK_FORM)).toThrow(/label/);
    expect(() => formToBlockArgs({ ...EMPTY_BLOCK_FORM, label: "A", start_time: "10:00" })).toThrow(/both/);
    expect(() => formToBlockArgs({ ...EMPTY_BLOCK_FORM, label: "A", start_time: "22:00", end_time: "01:00" })).toThrow(/past midnight/);
  });
});

describe("Production calendar page", () => {
  beforeEach(() => {
    for (const f of [...Object.values(api), loadBrandsAndTeam]) f.mockReset();
    api.loadCalendar.mockResolvedValue({ shoots: [S1, S2], castings: CASTINGS, locations: [{ id: "l1", name: "Demo Loft" }], crew: [{ id: "c1", name: "Rob Lens", role: "Videographer" }] });
    loadBrandsAndTeam.mockResolvedValue({ brands: [{ slug: "harbor", name: "Harbor Home", active: true, does_creators: false }, { slug: "pine", name: "Pinecrest", active: true, does_creators: true }], users: [] });
    for (const [k, f] of Object.entries(api)) if (k !== "loadCalendar") f.mockResolvedValue(k === "createShoot" ? "new" : undefined);
  });

  const renderAt = (q = "?month=2026-12") => render(<MemoryRouter initialEntries={[`/x${q}`]}><Routes><Route path="/x" element={<ProductionCalendarPage />} /></Routes></MemoryRouter>);

  it("lists the month's shoots by day with talent, blocks in time order and call sheet state", async () => {
    renderAt();
    const s1 = await screen.findByTestId("shoot-s1");
    expect(api.loadCalendar).toHaveBeenCalledWith("2026-12-01", "2026-12-31");
    expect(screen.getByTestId("calendar-month").textContent).toBe("December 2026");
    expect(within(s1).getByText("Call sheet made")).toBeTruthy();
    expect(within(s1).getByText("Indigo Reyes").getAttribute("href")).toBe("/employee/actors/act-a1");
    const blocks = within(s1).getAllByTestId(/^block-/).map((b) => b.getAttribute("data-testid"));
    expect(blocks).toEqual(["block-b1", "block-b2"]);
    expect(within(screen.getByTestId("block-b1")).getByText(/Talent: Indigo Reyes/)).toBeTruthy();
    expect(within(screen.getByTestId("block-b2")).getByText(/Crew: Rob Lens/)).toBeTruthy();
    expect(within(screen.getByTestId("shoot-s2")).getByText("No location yet")).toBeTruthy();
  });

  it("offers only the client's open castings to confirm, and confirms and removes talent", async () => {
    renderAt();
    const s1 = await screen.findByTestId("shoot-s1");
    const select = within(s1).getByLabelText("Confirm talent for s1");
    expect(within(select).queryByText(/Lane Foster/)).toBeNull();
    fireEvent.change(select, { target: { value: "a2" } });
    await waitFor(() => expect(api.confirmTalent).toHaveBeenCalledWith("a2", "s1"));
    fireEvent.click(within(screen.getByTestId("shoot-s1")).getByLabelText("Remove Indigo Reyes from the shoot"));
    await waitFor(() => expect(api.unconfirmTalent).toHaveBeenCalledWith("a1"));
  });

  it("schedules a shoot and refuses a missing date first", async () => {
    renderAt();
    await screen.findByTestId("shoot-s1");
    fireEvent.click(screen.getByText("Schedule a shoot"));
    fireEvent.change(screen.getByLabelText("Shoot client"), { target: { value: "harbor" } });
    fireEvent.click(screen.getByText("Save shoot"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/date/);
    fireEvent.change(screen.getByLabelText("Shoot date"), { target: { value: "2026-12-20" } });
    fireEvent.change(screen.getByLabelText("Shoot location"), { target: { value: "l1" } });
    fireEvent.click(screen.getByText("Save shoot"));
    await waitFor(() => expect(api.createShoot).toHaveBeenCalledWith({ p_client_slug: "harbor", p_shoot_date: "2026-12-20", p_location_id: "l1", p_location: null, p_notes: null }));
  });

  it("adds a block with talent and crew, and refuses one that ends before it starts", async () => {
    renderAt();
    const s1 = await screen.findByTestId("shoot-s1");
    fireEvent.click(within(s1).getByText("Add block"));
    fireEvent.change(screen.getByLabelText("Block label"), { target: { value: "Living room" } });
    fireEvent.change(screen.getByLabelText("Block start"), { target: { value: "16:00" } });
    fireEvent.change(screen.getByLabelText("Block end"), { target: { value: "15:00" } });
    fireEvent.click(screen.getByText("Save block"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/end after it starts/);
    fireEvent.change(screen.getByLabelText("Block end"), { target: { value: "17:30" } });
    const form = screen.getByRole("form", { name: "Schedule block" });
    fireEvent.click(within(form).getByLabelText("Indigo Reyes"));
    fireEvent.click(within(form).getByLabelText("Rob Lens"));
    fireEvent.click(screen.getByText("Save block"));
    await waitFor(() => expect(api.createBlock).toHaveBeenCalledWith("s1", expect.objectContaining({ p_label: "Living room", p_start_time: "16:00", p_end_time: "17:30", p_actor_assignment_ids: ["a1"], p_crew_member_ids: ["c1"] })));
  });

  it("deletes a shoot after a confirm and shows the database's refusal", async () => {
    api.deleteShoot.mockRejectedValue(new FakeDashboardError({ code: "P0001", message: "This shoot still has 1 confirmed actor(s) - remove them before deleting it." }));
    renderAt();
    fireEvent.click(within(await screen.findByTestId("shoot-s1")).getByText("Delete shoot"));
    await answerConfirm("Delete");
    expect((await screen.findByRole("alert")).textContent).toMatch(/confirmed actor/);
  });

  it("moves between months through the address", async () => {
    renderAt();
    await screen.findByTestId("shoot-s1");
    fireEvent.click(screen.getByText("Next month"));
    await waitFor(() => expect(api.loadCalendar).toHaveBeenLastCalledWith("2027-01-01", "2027-01-31"));
  });
});
