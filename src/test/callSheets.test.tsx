/**
 * Call sheets, staff page (consolidation step 5c): one call sheet per shoot,
 * merged from the old dashboard's call sheet and Goodo OS's per-talent lines.
 *
 * - Upcoming shoots with their call sheet, crew and public link, and the note
 *   that the public page still reads the old dashboard's database.
 * - Make, edit, revoke and restore a call sheet; add, edit and remove talent
 *   lines, all through callSheetsApi.
 * - A talent line whose talent left the shoot is flagged stale.
 * The row rules and functions are in supabase/tests/dashboard_call_sheets_page_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallSheet, SheetShoot, ShootCasting } from "@/features/dashboard/callSheetsModel";

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
  loadCallSheets: vi.fn(), createCallSheet: vi.fn(), updateCallSheet: vi.fn(), setCallSheetRevoked: vi.fn(), saveTalentLine: vi.fn(), removeTalentLine: vi.fn(),
}));
const loadBrandsAndTeam = vi.fn();
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/employee" }));
vi.mock("@/features/dashboard/api", () => ({ DashboardError: FakeDashboardError, loadBrandsAndTeam: () => loadBrandsAndTeam() }));
vi.mock("@/features/dashboard/callSheetsApi", () => api);

import CallSheetsPage from "@/features/dashboard/CallSheetsPage";
import {
  EMPTY_SHEET_FORM,
  EMPTY_TALENT_FORM,
  callSheetUrl,
  currentSheet,
  formToSheetArgs,
  formToTalentArgs,
  splitShoots,
  talentLines,
} from "@/features/dashboard/callSheetsModel";

const sheet = (id: string, extra: Partial<CallSheet> = {}): CallSheet => ({
  id, shoot_id: "s1", token: `tok-${id}`, call_time: "08:30:00", wrap_time_estimate: "About 5 PM", general_notes: "Park on the street.", revoked: false,
  created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", call_sheet_crew: [{ crew_member_id: "c1" }], call_sheet_talent_entries: [], ...extra,
});
const shoot = (id: string, date: string, extra: Partial<SheetShoot> = {}): SheetShoot => ({
  id, client_slug: "harbor", shoot_date: date, location: null, location_id: "l1", notes: null, call_sheets: [], ...extra,
});
const cast = (id: string, name: string, shootId: string | null): ShootCasting => ({ id, actor_id: `act-${id}`, shoot_id: shootId, stage: "booked", actors: { name } });

const ENTRY = { actor_assignment_id: "a1", call_time: "09:00:00", wardrobe: "Blue sweater", talent_notes: "Bring sneakers", rate_note: "$400 flat", internal_note: "Second booking", updated_at: "2026-11-02T00:00:00Z" };
const S1 = shoot("s1", "2099-12-04", { call_sheets: [sheet("cs1", { call_sheet_talent_entries: [ENTRY, { ...ENTRY, actor_assignment_id: "a9", rate_note: null, internal_note: null }] })] });
const S2 = shoot("s2", "2099-12-18", { client_slug: "pine", location: "Typed studio", location_id: null });
const OLD = shoot("s0", "2000-01-01");
const CASTINGS = [cast("a1", "Indigo Reyes", "s1"), cast("a2", "Jules Carter", "s1"), cast("a9", "Lane Foster", null)];
const DATA = {
  shoots: [S2, S1, OLD], castings: CASTINGS,
  crew: [{ id: "c1", name: "Demo Shooter", role: "Videographer", active: true }, { id: "c2", name: "Demo Grip", role: "Grip", active: true }],
  locations: new Map([["l1", "Demo Loft"]]),
};

describe("call sheets model", () => {
  it("builds the old dashboard link and picks the live sheet", () => {
    expect(callSheetUrl("abc")).toBe("https://goodostudios-production.vercel.app/call-sheet/abc");
    const s = shoot("s", "2099-01-01", { call_sheets: [sheet("new", { revoked: true, created_at: "2026-11-05T00:00:00Z" }), sheet("live")] });
    expect(currentSheet(s)?.id).toBe("live");
    expect(currentSheet(shoot("s", "2099-01-01", { call_sheets: [sheet("r", { revoked: true })] }))?.id).toBe("r");
    expect(currentSheet(shoot("s", "2099-01-01"))).toBeNull();
  });

  it("splits upcoming and past shoots", () => {
    const { upcoming, past } = splitShoots([S2, OLD, S1], "2026-11-10");
    expect(upcoming.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(past.map((s) => s.id)).toEqual(["s0"]);
  });

  it("lists a line per confirmed talent and flags lines whose talent left the shoot", () => {
    const lines = talentLines(S1.call_sheets[0], "s1", CASTINGS);
    expect(lines.map((l) => [l.name, !!l.entry, l.stale])).toEqual([
      ["Indigo Reyes", true, false],
      ["Jules Carter", false, false],
      ["Lane Foster", true, true],
    ]);
  });

  it("checks forms before any call", () => {
    expect(formToSheetArgs({ ...EMPTY_SHEET_FORM, crew: ["c1", "c1"], wrap_time_estimate: "  5 PM " })).toEqual({ p_call_time: null, p_wrap_time_estimate: "5 PM", p_general_notes: null, p_crew_member_ids: ["c1"] });
    expect(() => formToSheetArgs({ ...EMPTY_SHEET_FORM, call_time: "9am" })).toThrow(/call time/);
    expect(formToTalentArgs({ ...EMPTY_TALENT_FORM, wardrobe: " Red " })).toMatchObject({ p_wardrobe: "Red", p_rate_note: null, p_call_time: null });
    expect(() => formToTalentArgs({ ...EMPTY_TALENT_FORM, rate_note: "x".repeat(501) })).toThrow(/500/);
    expect(() => formToTalentArgs({ ...EMPTY_TALENT_FORM, internal_note: "x".repeat(1001) })).toThrow(/1000/);
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/employee/call-sheets"]}>
      <Routes><Route path="/employee/call-sheets" element={<CallSheetsPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe("call sheets page", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.loadCallSheets.mockResolvedValue(DATA);
    loadBrandsAndTeam.mockReset();
    loadBrandsAndTeam.mockResolvedValue({ brands: [{ slug: "harbor", name: "Demo Harbor", active: true }, { slug: "pine", name: "Demo Pine", active: true }], users: [] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows upcoming shoots with the sheet, crew, link and the old dashboard note", async () => {
    renderPage();
    const card = await screen.findByTestId("call-sheet-shoot-s1");
    expect(within(card).getByText("Demo Harbor")).toBeTruthy();
    expect(within(card).getByText("Demo Loft")).toBeTruthy();
    expect(within(card).getByText(/Call 8:30 AM/)).toBeTruthy();
    expect(within(card).getByText(/Demo Shooter \(Videographer\)/)).toBeTruthy();
    expect(within(card).getByText("Open public call sheet").getAttribute("href")).toBe("https://goodostudios-production.vercel.app/call-sheet/tok-cs1");
    expect(within(card).getByText(/Rate \(staff only\): \$400 flat/)).toBeTruthy();
    expect(within(card).getByText("No longer on this shoot")).toBeTruthy();
    expect(screen.getByTestId("call-sheets-old-dashboard-note").textContent).toMatch(/reads its own database until the release/);
    expect(within(screen.getByTestId("call-sheet-shoot-s2")).getByText("No call sheet yet.")).toBeTruthy();
    expect(screen.queryByTestId("call-sheet-shoot-s0")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Show shoots from the last/));
    expect(screen.getByTestId("call-sheet-shoot-s0")).toBeTruthy();
  });

  it("makes a call sheet with crew", async () => {
    api.createCallSheet.mockResolvedValue("new");
    renderPage();
    const card = await screen.findByTestId("call-sheet-shoot-s2");
    fireEvent.click(within(card).getByText("Make a call sheet"));
    fireEvent.change(within(card).getByLabelText("Call time"), { target: { value: "07:00" } });
    fireEvent.click(within(card).getByLabelText(/Demo Grip/));
    fireEvent.click(within(card).getByText("Save call sheet"));
    await waitFor(() => expect(api.createCallSheet).toHaveBeenCalledWith("s2", { p_call_time: "07:00", p_wrap_time_estimate: null, p_general_notes: null, p_crew_member_ids: ["c2"] }));
    expect(await screen.findByText(/Call sheet made for Demo Pine/)).toBeTruthy();
  });

  it("edits and revokes a call sheet", async () => {
    renderPage();
    const card = await screen.findByTestId("call-sheet-shoot-s1");
    fireEvent.click(within(card).getByText("Edit"));
    fireEvent.change(within(card).getByLabelText("Wrap estimate"), { target: { value: "6 PM" } });
    fireEvent.click(within(card).getByText("Save call sheet"));
    await waitFor(() => expect(api.updateCallSheet).toHaveBeenCalledWith("cs1", { p_call_time: "08:30", p_wrap_time_estimate: "6 PM", p_general_notes: "Park on the street.", p_crew_member_ids: ["c1"] }));
    fireEvent.click(await within(await screen.findByTestId("call-sheet-shoot-s1")).findByText("Revoke link"));
    await waitFor(() => expect(api.setCallSheetRevoked).toHaveBeenCalledWith("cs1", true));
  });

  it("adds a talent line and removes a stale one", async () => {
    renderPage();
    const line = await screen.findByTestId("talent-line-a2");
    fireEvent.click(within(line).getByText("Add line"));
    fireEvent.change(within(line).getByLabelText("Wardrobe"), { target: { value: "Green jacket" } });
    fireEvent.change(within(line).getByLabelText("Rate note"), { target: { value: "$350" } });
    fireEvent.click(within(line).getByText("Save line"));
    await waitFor(() => expect(api.saveTalentLine).toHaveBeenCalledWith("cs1", "a2", { p_call_time: null, p_wardrobe: "Green jacket", p_talent_notes: null, p_rate_note: "$350", p_internal_note: null }));
    const stale = screen.getByTestId("talent-line-a9");
    expect(within(stale).queryByText("Edit line")).toBeNull();
    fireEvent.click(within(stale).getByText("Remove line"));
    await waitFor(() => expect(api.removeTalentLine).toHaveBeenCalledWith("cs1", "a9"));
  });

  it("shows the database's refusal", async () => {
    api.saveTalentLine.mockRejectedValue(new FakeDashboardError({ code: "22023", message: "Only talent confirmed onto this shoot can be on its call sheet." }));
    renderPage();
    const line = await screen.findByTestId("talent-line-a1");
    fireEvent.click(within(line).getByText("Edit line"));
    fireEvent.click(within(line).getByText("Save line"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Only talent confirmed onto this shoot/);
  });
});
