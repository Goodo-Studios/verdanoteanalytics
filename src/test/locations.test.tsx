/**
 * Locations, staff page (consolidation step 5c, port of the old dashboard's
 * /locations page and its shared location links).
 *
 * - Search, neighborhood and bedroom and bathroom floors; a location with no
 *   count recorded is counted apart, never dropped.
 * - Add and edit go through the checked location functions (locationsApi);
 *   the form is checked before any call.
 * - Selected locations become a link served by the old dashboard; copy and
 *   revoke; the page says that clients use the old dashboard's copy.
 * The row rules and functions are in supabase/tests/dashboard_locations_page_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Location, LocationBoard } from "@/features/dashboard/locationsModel";

const { FakeDashboardError } = vi.hoisted(() => ({
  FakeDashboardError: class extends Error {
    code?: string;
    constructor(e: { code?: string; message: string }) {
      super(e.message);
      this.code = e.code;
    }
  },
}));
const loadLocations = vi.fn();
const createLocation = vi.fn();
const updateLocation = vi.fn();
const deleteLocation = vi.fn();
const createLocationBoard = vi.fn();
const revokeLocationBoard = vi.fn();
const loadBrandsAndTeam = vi.fn();

vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/employee" }));
vi.mock("@/features/dashboard/api", () => ({ DashboardError: FakeDashboardError, loadBrandsAndTeam: () => loadBrandsAndTeam() }));
vi.mock("@/features/dashboard/locationsApi", () => ({
  loadLocations: () => loadLocations(),
  createLocation: (...a: unknown[]) => createLocation(...a),
  updateLocation: (...a: unknown[]) => updateLocation(...a),
  deleteLocation: (...a: unknown[]) => deleteLocation(...a),
  createLocationBoard: (...a: unknown[]) => createLocationBoard(...a),
  revokeLocationBoard: (...a: unknown[]) => revokeLocationBoard(...a),
}));

import { answerConfirm } from "@/test/productionConfirm";
import LocationsPage from "@/features/dashboard/LocationsPage";
import {
  DEFAULT_LOCATION_FILTERS,
  EMPTY_LOCATION_FORM,
  filterLocations,
  formToArgs,
  formatCapacity,
  formatCost,
  locationBoardUrl,
  safeListingUrl,
  sortBoards,
} from "@/features/dashboard/locationsModel";

const loc = (id: string, name: string, extra: Partial<Location> = {}): Location => ({
  id, name, neighborhood: null, rental_type: null, notes: null, cost: null, cost_period: null, listing_url: null, rooms: [], attributes: [],
  have_rented: false, dont_rent_again: false, contact_name: null, contact_email: null, parking_instructions: null, wifi_name: null, wifi_password: null,
  bedrooms: null, bathrooms: null, max_guests: null, entry_instructions: null, updated_at: "2026-11-01T00:00:00Z", ...extra,
});
const LOFT = loc("l1", "Sunny Loft", { neighborhood: "Testville", bedrooms: 2, bathrooms: 1.5, max_guests: 6, cost: 250, cost_period: "daily", listing_url: "https://listing.example.test/1", rooms: ["Kitchen"] });
const HOUSE = loc("l2", "Big House", { neighborhood: "Sampletown", bedrooms: 4, bathrooms: 3, dont_rent_again: true });
const STUDIO = loc("l3", "Corner Studio", { neighborhood: "Testville" });
const board = (id: string, extra: Partial<LocationBoard> = {}): LocationBoard => ({
  id, client_slug: "harbor", label: "May shoot", token: `tok-${id}`, revoked: false, created_at: "2026-11-05T00:00:00Z",
  location_board_items: [{ location_id: "l1" }, { location_id: "l3" }], ...extra,
});

describe("locations model", () => {
  it("filters by search, neighborhood and floors, and keeps unrecorded counts apart", () => {
    const all = [LOFT, HOUSE, STUDIO];
    expect(filterLocations(all, DEFAULT_LOCATION_FILTERS).shown.map((l) => l.name)).toEqual(["Big House", "Corner Studio", "Sunny Loft"]);
    expect(filterLocations(all, { ...DEFAULT_LOCATION_FILTERS, search: "kitchen" }).shown.map((l) => l.id)).toEqual(["l1"]);
    expect(filterLocations(all, { ...DEFAULT_LOCATION_FILTERS, neighborhood: "Testville" }).shown.map((l) => l.id)).toEqual(["l3", "l1"]);
    const floor = filterLocations(all, { ...DEFAULT_LOCATION_FILTERS, minBedrooms: 3 });
    expect(floor.shown.map((l) => l.id)).toEqual(["l2"]);
    expect(floor.unrecorded.map((l) => l.id)).toEqual(["l3"]);
    expect(filterLocations(all, { ...DEFAULT_LOCATION_FILTERS, hideDontRent: true }).shown.map((l) => l.id)).not.toContain("l2");
  });

  it("formats cost and size, and only links http(s) listings", () => {
    expect(formatCost(250, "daily")).toBe("$250 / day");
    expect(formatCost(37.5, "hourly")).toBe("$37.50 / hour");
    expect(formatCost(null, null)).toBe("");
    expect(formatCapacity(LOFT)).toBe("2 bd · 1.5 ba · 6 guests");
    expect(safeListingUrl("javascript:alert(1)")).toBeNull();
    expect(safeListingUrl("https://listing.example.test/1")).toBe("https://listing.example.test/1");
    expect(locationBoardUrl("abc")).toBe("https://goodostudios-production.vercel.app/locations-board/abc");
  });

  it("checks the form before any call", () => {
    expect(() => formToArgs(EMPTY_LOCATION_FORM)).toThrow(/name is required/);
    expect(() => formToArgs({ ...EMPTY_LOCATION_FORM, name: "X", cost: "-1" })).toThrow(/Cost/);
    expect(() => formToArgs({ ...EMPTY_LOCATION_FORM, name: "X", bathrooms: "1.25" })).toThrow(/0.5/);
    expect(() => formToArgs({ ...EMPTY_LOCATION_FORM, name: "X", bedrooms: "2.5" })).toThrow(/whole number/);
    expect(() => formToArgs({ ...EMPTY_LOCATION_FORM, name: "X", contact_email: "nope" })).toThrow(/email/);
    const a = formToArgs({ ...EMPTY_LOCATION_FORM, name: " Loft ", rooms: "Kitchen, Bedroom, Kitchen", bathrooms: "1.5", cost: "200", cost_period: "daily" });
    expect(a.p_name).toBe("Loft");
    expect(a.p_rooms).toEqual(["Kitchen", "Bedroom"]);
    expect(a.capacity).toEqual({ p_bedrooms: null, p_bathrooms: 1.5, p_max_guests: null });
    expect(a.p_cost).toBe(200);
  });

  it("lists live links before revoked ones", () => {
    const sorted = sortBoards([board("old", { revoked: true, created_at: "2026-11-09T00:00:00Z" }), board("a", { created_at: "2026-11-01T00:00:00Z" }), board("b")]);
    expect(sorted.map((b) => b.id)).toEqual(["b", "a", "old"]);
  });
});

describe("Locations page", () => {
  beforeEach(() => {
    for (const f of [loadLocations, createLocation, updateLocation, deleteLocation, createLocationBoard, revokeLocationBoard, loadBrandsAndTeam]) f.mockReset();
    loadLocations.mockResolvedValue({
      locations: [LOFT, HOUSE, STUDIO],
      photos: [{ id: "p1", location_id: "l1", storage_path: "l1/a.jpg", caption: "Living room", sort_order: 0 }],
      boards: [board("b1"), board("b0", { revoked: true, label: "Old link" })],
      links: new Map([["l1/a.jpg", "https://signed.example.test/a.jpg"]]),
    });
    loadBrandsAndTeam.mockResolvedValue({ brands: [{ slug: "harbor", name: "Harbor Home", active: true, does_creators: false }], users: [] });
    createLocation.mockResolvedValue("new-id");
    updateLocation.mockResolvedValue(undefined);
    deleteLocation.mockResolvedValue(undefined);
    createLocationBoard.mockResolvedValue(board("b2", { token: "newtok" }));
    revokeLocationBoard.mockResolvedValue(undefined);
  });

  const renderPage = () => render(<MemoryRouter><LocationsPage /></MemoryRouter>);

  it("lists locations with cost, size and photo, and says links are served by the old dashboard", async () => {
    renderPage();
    const loft = await screen.findByTestId("location-row-l1");
    expect(within(loft).getByText("$250 / day")).toBeTruthy();
    expect(within(loft).getByText("2 bd · 1.5 ba · 6 guests")).toBeTruthy();
    expect(within(loft).getByRole("img").getAttribute("src")).toBe("https://signed.example.test/a.jpg");
    expect(within(screen.getByTestId("location-row-l2")).getByText("Do not rent again")).toBeTruthy();
    expect(screen.getByTestId("old-dashboard-note").textContent).toMatch(/Public links still open on the old dashboard for now/);
    expect(screen.getByTestId("locations-count").textContent).toBe("3 locations");
  });

  it("counts a location with no count apart when a floor is set", async () => {
    renderPage();
    await screen.findByTestId("location-row-l1");
    fireEvent.change(screen.getByLabelText("Minimum bedrooms"), { target: { value: "2" } });
    expect(screen.queryByTestId("location-row-l3")).toBeNull();
    expect(screen.getByText(/1 location has no bedroom or bathroom count recorded/)).toBeTruthy();
    expect(screen.getByTestId("locations-count").textContent).toBe("2 of 3 locations");
  });

  it("adds a location through the checked functions and refuses an empty name first", async () => {
    renderPage();
    await screen.findByTestId("location-row-l1");
    fireEvent.click(screen.getByText("Add location"));
    fireEvent.click(screen.getByText("Save"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/name is required/);
    expect(createLocation).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Space" } });
    fireEvent.change(screen.getByLabelText("Bedrooms"), { target: { value: "3" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(createLocation).toHaveBeenCalledTimes(1));
    expect(createLocation.mock.calls[0][0]).toMatchObject({ p_name: "New Space", capacity: { p_bedrooms: 3, p_bathrooms: null, p_max_guests: null } });
    expect((await screen.findByRole("status")).textContent).toBe("Added New Space.");
  });

  it("edits a location with its photos shown", async () => {
    renderPage();
    const loft = await screen.findByTestId("location-row-l1");
    fireEvent.click(within(loft).getByText("Edit"));
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Sunny Loft");
    expect(within(screen.getByLabelText("Photos")).getByText("Living room")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Host contact email"), { target: { value: "host@example.test" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(updateLocation).toHaveBeenCalledWith("l1", expect.objectContaining({ p_contact_email: "host@example.test", p_name: "Sunny Loft" })));
  });

  it("deletes only after a confirm", async () => {
    renderPage();
    const house = await screen.findByTestId("location-row-l2");
    fireEvent.click(within(house).getByText("Delete"));
    await answerConfirm("Cancel");
    expect(deleteLocation).not.toHaveBeenCalled();
    fireEvent.click(within(house).getByText("Delete"));
    await answerConfirm("Delete");
    await waitFor(() => expect(deleteLocation).toHaveBeenCalledWith("l2"));
  });

  it("shares the selected locations as a link, and shows and revokes links", async () => {
    renderPage();
    await screen.findByTestId("location-row-l1");
    const live = screen.getByTestId("location-board-b1");
    expect(within(live).getByText("Sunny Loft, Corner Studio")).toBeTruthy();
    expect(within(live).getByText("https://goodostudios-production.vercel.app/locations-board/tok-b1")).toBeTruthy();
    expect(within(screen.getByTestId("location-board-b0")).queryByText("Revoke")).toBeNull();
    expect((screen.getByText("Create link") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Select Sunny Loft"));
    fireEvent.click(screen.getByLabelText("Select Big House"));
    fireEvent.change(screen.getByLabelText("Share with client"), { target: { value: "harbor" } });
    fireEvent.change(screen.getByLabelText("Link label"), { target: { value: " June " } });
    fireEvent.click(screen.getByText("Create link"));
    await waitFor(() => expect(createLocationBoard).toHaveBeenCalledWith("harbor", "June", ["l1", "l2"]));
    expect((await screen.findByRole("status")).textContent).toMatch(/locations-board\/newtok/);
    fireEvent.click(within(screen.getByTestId("location-board-b1")).getByText("Revoke"));
    await answerConfirm("Revoke");
    await waitFor(() => expect(revokeLocationBoard).toHaveBeenCalledWith("b1"));
  });

  it("shows a permission refusal in plain words", async () => {
    deleteLocation.mockRejectedValue(new FakeDashboardError({ code: "42501", message: "Only active staff can delete locations." }));
    renderPage();
    fireEvent.click(within(await screen.findByTestId("location-row-l3")).getByText("Delete"));
    await answerConfirm("Delete");
    expect((await screen.findByRole("alert")).textContent).toBe("You do not have permission to do that.");
  });
});
