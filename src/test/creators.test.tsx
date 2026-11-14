/**
 * Creators (consolidation step 5b, port of the old dashboard Creators page and
 * Creator detail).
 *
 * - The roster filters (search, category, scale, gender, trialed, needs review,
 *   do not use hidden by default), sort and 50-row pages, all kept in the address.
 * - Adding a creator by hand opens the new creator's page.
 * - The creator page saves the profile through saveCreator, refuses a bad scale
 *   before writing, keeps imported categories, adds the creator to a brand and
 *   links each brand to the client page and the Creator pipeline.
 * The row rules are in supabase/tests/dashboard_creators_page_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RosterCreator, CreatorRecord } from "@/features/dashboard/rosterModel";

const loadCreatorRoster = vi.fn();
const loadCreatorDetail = vi.fn();
const saveCreator = vi.fn();
const createCreator = vi.fn();
const loadBrandsAndTeam = vi.fn();
const addCreatorsToBrand = vi.fn();

vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/employee" }));
vi.mock("@/features/dashboard/rosterApi", () => ({
  loadCreatorRoster: () => loadCreatorRoster(),
  loadCreatorDetail: (...a: unknown[]) => loadCreatorDetail(...a),
  saveCreator: (...a: unknown[]) => saveCreator(...a),
  createCreator: (...a: unknown[]) => createCreator(...a),
}));
vi.mock("@/features/dashboard/api", () => ({
  DashboardError: class extends Error { code?: string },
  loadBrandsAndTeam: () => loadBrandsAndTeam(),
  addCreatorsToBrand: (...a: unknown[]) => addCreatorsToBrand(...a),
}));

import CreatorsPage from "@/features/dashboard/CreatorsPage";
import CreatorDetailPage from "@/features/dashboard/CreatorDetailPage";
import {
  DEFAULT_CREATOR_FILTERS,
  creatorFiltersFromParams,
  creatorFiltersToParams,
  creatorFormToPatch,
  creatorToForm,
  filterCreators,
  paginate,
  safeHref,
  sortCreators,
  splitCategories,
} from "@/features/dashboard/rosterModel";

const creator = (id: string, name: string, extra: Partial<RosterCreator> = {}): RosterCreator => ({
  id, name, email: `${id}@example.test`, gender: "Female", scale: 3, categories: ["Beauty"], age_range: ["25-34"], location: "Austin",
  trialed: false, do_not_use_again: false, categories_needs_review: false, source: "manual", headshot_path: null,
  created_at: "2026-01-01T00:00:00Z", ...extra,
});
const ROSTER = [
  creator("c1", "Avery Stone", { scale: 5, trialed: true }),
  creator("c2", "Blake Rivers", { gender: "Male", categories: ["Pet", "Dog"], location: "Denver", created_at: "2026-06-01T00:00:00Z" }),
  creator("c3", "Casey Moreno", { do_not_use_again: true }),
  creator("c4", "Devon Park", { scale: null, categories: ["food"], categories_needs_review: true }),
];
const BRANDS = [
  { slug: "glow", name: "Glow Co", active: true, does_creators: true },
  { slug: "north", name: "Northwind", active: true, does_creators: true },
  { slug: "studio", name: "Studio only", active: true, does_creators: false },
];
const record = (extra: Partial<CreatorRecord> = {}): CreatorRecord => ({
  ...creator("c1", "Avery Stone"), website: "avery.example.test", portfolio_url: null, shipping_address: "1 Test St", contact_notes: null,
  alcohol_ok: false, cbd_ok: false, thc_ok: false, family_inclusive_ok: true, import_notes: null, updated_at: "2026-01-01T00:00:00Z",
  categories: ["Beauty", "old free text"], ...extra,
});

beforeEach(() => {
  for (const f of [loadCreatorRoster, loadCreatorDetail, saveCreator, createCreator, loadBrandsAndTeam, addCreatorsToBrand]) f.mockReset();
  loadCreatorRoster.mockResolvedValue({ creators: ROSTER, assignments: [{ id: "a1", creator_id: "c1", client_slug: "glow", stage: "contract_sent" }] });
  loadBrandsAndTeam.mockResolvedValue({ brands: BRANDS, users: [] });
  loadCreatorDetail.mockResolvedValue({
    creator: record(), brands: [{ id: "a1", client_slug: "glow", stage: "contract_sent", next_follow_up_at: "2026-11-12", clients: { name: "Glow Co" } }],
    videos: [{ id: "v1", storage_path: "c1/video-1.mp4", thumbnail_path: null, title: null, format: "talking_head", sort_order: 1 }],
    photos: [], locations: [], links: new Map([["c1/video-1.mp4", "https://signed.example.test/v1"]]),
  });
  saveCreator.mockResolvedValue(undefined);
  createCreator.mockResolvedValue("new-id");
  addCreatorsToBrand.mockResolvedValue(undefined);
});

const renderList = (url = "/creators") => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/creators" element={<CreatorsPage />} />
      <Route path="/employee/creators/:id" element={<div data-testid="opened">opened</div>} />
    </Routes>
  </MemoryRouter>,
);
const renderDetail = () => render(
  <MemoryRouter initialEntries={["/creators/c1"]}>
    <Routes><Route path="/creators/:id" element={<CreatorDetailPage />} /></Routes>
  </MemoryRouter>,
);

describe("Creators page", () => {
  it("lists the roster without do-not-use creators and links each brand to the Creator pipeline", async () => {
    renderList();
    expect(await screen.findByTestId("creators-count")).toHaveTextContent("3 of 4 creators");
    expect(screen.queryByTestId("creator-row-c3")).toBeNull();
    const row = screen.getByTestId("creator-row-c1");
    expect(within(row).getByRole("link", { name: "Avery Stone" }).getAttribute("href")).toBe("/creators?creator=c1");
    expect(within(row).getByRole("link", { name: "Glow Co (Contract Sent)" }).getAttribute("href")).toBe("/employee/creator-pipeline?brand=glow");
  });

  it("filters from the address and from the controls", async () => {
    renderList("/creators?category=Pet&dnu=1");
    expect(await screen.findByTestId("creators-count")).toHaveTextContent("1 of 4 creators");
    expect(screen.getByTestId("creator-row-c2")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "" } });
    expect(await screen.findByTestId("creator-row-c3")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search creators"), { target: { value: "denver" } });
    await waitFor(() => expect(screen.getByTestId("creators-count")).toHaveTextContent("1 of 4 creators"));
  });

  it("adds a creator by hand and opens them in the modal", async () => {
    renderList();
    await screen.findByTestId("creators-count");
    fireEvent.click(screen.getByRole("button", { name: "Add creator" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A name is required");
    expect(createCreator).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("New creator name"), { target: { value: " New Person " } });
    fireEvent.change(screen.getByLabelText("New creator email"), { target: { value: "new@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add creator" }));
    await waitFor(() => expect(createCreator).toHaveBeenCalledWith("New Person", "new@example.test"));
    const modal = await screen.findByTestId("record-modal");
    expect(await within(modal).findByTestId("creator-detail-page")).toBeTruthy();
  });

  it("opens a creator in a modal over the list, without a back link, and closing keeps the list", async () => {
    renderList();
    const row = await screen.findByTestId("creator-row-c1");
    fireEvent.click(within(row).getByRole("link", { name: "Avery Stone" }));
    const modal = await screen.findByTestId("record-modal");
    expect(await within(modal).findByTestId("creator-detail-page")).toBeTruthy();
    expect(within(modal).queryByRole("link", { name: "Back to Creators" })).toBeNull();
    expect(screen.getByTestId("creators-count")).toBeTruthy();
    fireEvent.keyDown(modal, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("record-modal")).toBeNull());
    expect(screen.getByTestId("creator-row-c1")).toBeTruthy();
  });

  it("shows a load error instead of an empty list", async () => {
    loadCreatorRoster.mockRejectedValue(new Error("permission denied for table dashboard_creators"));
    renderList();
    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
    expect(screen.queryByTestId("creators-count")).toBeNull();
  });
});

describe("Creator page", () => {
  it("shows brands with links, media with a signed link and imported categories", async () => {
    renderDetail();
    const brands = await screen.findByRole("region", { name: "Clients" });
    expect(within(brands).getByRole("link", { name: "Glow Co" }).getAttribute("href")).toBe("/employee/clients/glow");
    expect(within(brands).getByRole("link", { name: "Open in Creator pipeline" }).getAttribute("href")).toBe("/employee/creator-pipeline?brand=glow");
    expect(within(screen.getByRole("region", { name: "Videos" })).getByRole("link", { name: "Play" }).getAttribute("href")).toBe("https://signed.example.test/v1");
    expect(screen.getByText(/Imported categories kept as they are: old free text/)).toBeTruthy();
    expect(screen.getByText("No headshot")).toBeTruthy();
  });

  it("offers upload on the headshot, videos, family and pet photos and filming locations, and asks before a delete", async () => {
    renderDetail();
    await screen.findByRole("region", { name: "Clients" });
    expect(screen.getByRole("button", { name: "Add main photo" })).toBeTruthy();
    for (const title of ["Videos", "Family and pet photos", "Filming locations"]) {
      expect(within(screen.getByRole("region", { name: title })).getByRole("button", { name: /^Add (videos|photos)$/ })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Delete Video 1" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete Video 1?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("saves the profile and keeps imported categories", async () => {
    renderDetail();
    await screen.findByRole("region", { name: "Clients" });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Boston" } });
    fireEvent.click(screen.getByLabelText("Skincare"));
    fireEvent.click(screen.getByLabelText("Do not use again"));
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(saveCreator).toHaveBeenCalledTimes(1));
    const [id, patch] = saveCreator.mock.calls[0];
    expect(id).toBe("c1");
    expect(patch).toMatchObject({ location: "Boston", do_not_use_again: true, categories: ["Beauty", "old free text", "Skincare"], website: "avery.example.test" });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
  });

  it("refuses a scale outside 1 to 5 without writing", async () => {
    renderDetail();
    await screen.findByRole("region", { name: "Clients" });
    fireEvent.change(screen.getByLabelText("Scale (1 to 5)"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Scale is a whole number from 1 to 5.");
    expect(saveCreator).not.toHaveBeenCalled();
  });

  it("adds the creator to a creators brand they are not on yet", async () => {
    renderDetail();
    const select = await screen.findByLabelText("Add to client");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose a client", "Northwind"]);
    fireEvent.change(select, { target: { value: "north" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to client" }));
    await waitFor(() => expect(addCreatorsToBrand).toHaveBeenCalledWith("north", ["c1"]));
  });

  it("says so when the id matches no creator", async () => {
    loadCreatorDetail.mockResolvedValue({ creator: null, brands: [], videos: [], photos: [], locations: [], links: new Map() });
    renderDetail();
    expect(await screen.findByText("No creator with this id.")).toBeTruthy();
  });
});

describe("roster model", () => {
  it("round-trips the filters through the address and drops defaults", () => {
    const f = { ...DEFAULT_CREATOR_FILTERS, search: "ann", category: "Pet", minScale: 3, showDoNotUse: true, sort: "scale" as const, page: 2 };
    expect(creatorFiltersFromParams(creatorFiltersToParams(f))).toEqual(f);
    expect(creatorFiltersToParams(DEFAULT_CREATOR_FILTERS).toString()).toBe("");
    expect(creatorFiltersFromParams(new URLSearchParams("scale=9&page=-2&sort=bogus"))).toEqual(DEFAULT_CREATOR_FILTERS);
  });

  it("applies every filter at once", () => {
    const f = { ...DEFAULT_CREATOR_FILTERS, minScale: 3 };
    expect(filterCreators(ROSTER, f).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(filterCreators(ROSTER, { ...DEFAULT_CREATOR_FILTERS, gender: "male" }).map((c) => c.id)).toEqual(["c2"]);
    expect(filterCreators(ROSTER, { ...DEFAULT_CREATOR_FILTERS, needsReviewOnly: true }).map((c) => c.id)).toEqual(["c4"]);
    expect(filterCreators(ROSTER, { ...DEFAULT_CREATOR_FILTERS, trialedOnly: true }).map((c) => c.id)).toEqual(["c1"]);
  });

  it("sorts by name, scale and newest", () => {
    expect(sortCreators(ROSTER, "scale").map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(sortCreators(ROSTER, "newest")[0].id).toBe("c2");
  });

  it("pages 50 at a time and clamps a page past the end", () => {
    const many = Array.from({ length: 120 }, (_, i) => i);
    expect(paginate(many, 1)).toMatchObject({ page: 1, pages: 3, total: 120 });
    expect(paginate(many, 9).rows).toEqual(many.slice(100));
    expect(paginate([], 1)).toMatchObject({ page: 1, pages: 1, rows: [] });
  });

  it("parses the form and checks the name and scale", () => {
    const form = creatorToForm(record());
    expect(creatorFormToPatch({ ...form, name: "  " })).toEqual({ error: "A name is required." });
    expect(creatorFormToPatch({ ...form, scale: "2.5" })).toEqual({ error: "Scale is a whole number from 1 to 5." });
    const ok = creatorFormToPatch({ ...form, scale: "", age_range: "18-24, 25-34,", email: " " });
    expect(ok).toMatchObject({ patch: { scale: null, age_range: ["18-24", "25-34"], email: null } });
  });

  it("only links http(s) addresses and splits imported categories", () => {
    expect(safeHref("example.test")).toBe("https://example.test");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.test")).toBeNull();
    expect(splitCategories(["Pet", "food"])).toEqual({ canonical: ["Pet"], legacy: ["food"] });
  });
});
