/**
 * Actors (consolidation step 5b, port of the old dashboard Actors page and
 * Actor detail).
 *
 * - The roster filters (search over name, email, phone and skills, gender,
 *   skill, dog owner, do not use hidden by default), sort and pages, kept in the address.
 * - Adding an actor by hand opens the new actor's page.
 * - The actor page saves the profile through saveActor (dog owner is yes, no or
 *   not asked), lists castings read only with links to the client page, and
 *   shows media through signed links.
 * The row rules are in supabase/tests/dashboard_actors_page_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorRecord, RosterActor } from "@/features/dashboard/rosterModel";

const loadActorRoster = vi.fn();
const loadActorDetail = vi.fn();
const saveActor = vi.fn();
const createActor = vi.fn();
const loadBrandsAndTeam = vi.fn();

vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
vi.mock("@/features/dashboard/rosterApi", () => ({
  loadActorRoster: () => loadActorRoster(),
  loadActorDetail: (...a: unknown[]) => loadActorDetail(...a),
  saveActor: (...a: unknown[]) => saveActor(...a),
  createActor: (...a: unknown[]) => createActor(...a),
}));
vi.mock("@/features/dashboard/api", () => ({
  DashboardError: class extends Error { code?: string },
  loadBrandsAndTeam: () => loadBrandsAndTeam(),
}));

import ActorsPage from "@/features/dashboard/ActorsPage";
import ActorDetailPage from "@/features/dashboard/ActorDetailPage";
import {
  DEFAULT_ACTOR_FILTERS,
  actorFiltersFromParams,
  actorFiltersToParams,
  actorFormToPatch,
  actorToForm,
  filterActors,
  skillOptions,
} from "@/features/dashboard/rosterModel";

const actor = (id: string, name: string, extra: Partial<RosterActor> = {}): RosterActor => ({
  id, name, email: `${id}@example.test`, phone: "555-0100", gender: "Female", age_range: ["25-34"], skills: ["Comedy"],
  dog_owner: null, kids_in_videos: null, do_not_use_again: false, headshot_path: null, source: "manual",
  created_at: "2026-01-01T00:00:00Z", ...extra,
});
const ROSTER = [
  actor("a1", "Indigo Reyes", { dog_owner: true, skills: ["Comedy", "Improv"] }),
  actor("a2", "Jules Carter", { gender: "Male", dog_owner: false, skills: ["Voiceover"], phone: "555-0199" }),
  actor("a3", "Kai Morgan", { do_not_use_again: true }),
];
const record = (extra: Partial<ActorRecord> = {}): ActorRecord => ({
  ...actor("a1", "Indigo Reyes", { dog_owner: true }), notes: null, social_url: "instagram.com/indigo", additional_social_url: null,
  import_notes: null, updated_at: "2026-01-01T00:00:00Z", ...extra,
});

beforeEach(() => {
  for (const f of [loadActorRoster, loadActorDetail, saveActor, createActor, loadBrandsAndTeam]) f.mockReset();
  loadActorRoster.mockResolvedValue({ actors: ROSTER, castings: [{ id: "x1", actor_id: "a1", client_slug: "harbor", stage: "booked" }] });
  loadBrandsAndTeam.mockResolvedValue({ brands: [{ slug: "harbor", name: "Harbor Home", active: true, does_creators: false }], users: [] });
  loadActorDetail.mockResolvedValue({
    actor: record(),
    castings: [{ id: "x1", client_slug: "harbor", stage: "booked", scheduled_shoot_date: "2026-11-19", shoot_location: "Test Studio A", clients: { name: "Harbor Home" } }],
    videos: [{ id: "v1", storage_path: "a1/reel.mp4", thumbnail_path: "a1/reel.jpg", title: "Reel", sort_order: 1 }],
    photos: [{ id: "p1", storage_path: "a1/photo.jpg", caption: null }],
    links: new Map([["a1/reel.mp4", "https://signed.example.test/reel"], ["a1/reel.jpg", "https://signed.example.test/thumb"]]),
  });
  saveActor.mockResolvedValue(undefined);
  createActor.mockResolvedValue("new-actor");
});

const renderList = (url = "/actors") => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/actors" element={<ActorsPage />} />
      <Route path="/builder/actors/:id" element={<div data-testid="opened">opened</div>} />
    </Routes>
  </MemoryRouter>,
);
const renderDetail = () => render(
  <MemoryRouter initialEntries={["/actors/a1"]}>
    <Routes><Route path="/actors/:id" element={<ActorDetailPage />} /></Routes>
  </MemoryRouter>,
);

describe("Actors page", () => {
  it("lists actors without do-not-use ones and shows where they are cast", async () => {
    renderList();
    expect(await screen.findByTestId("actors-count")).toHaveTextContent("2 of 3 actors");
    const row = screen.getByTestId("actor-row-a1");
    expect(within(row).getByRole("link", { name: "Indigo Reyes" }).getAttribute("href")).toBe("/actors?actor=a1");
    expect(row).toHaveTextContent("Harbor Home (Booked)");
    expect(screen.queryByTestId("actor-row-a3")).toBeNull();
  });

  it("filters by dog owner, skill and search", async () => {
    renderList("/actors?dog=no");
    expect(await screen.findByTestId("actors-count")).toHaveTextContent("1 of 3 actors");
    expect(screen.getByTestId("actor-row-a2")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Dog owner"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "Improv" } });
    await waitFor(() => expect(screen.getByTestId("actors-count")).toHaveTextContent("1 of 3 actors"));
    expect(screen.getByTestId("actor-row-a1")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Search actors"), { target: { value: "0199" } });
    await waitFor(() => expect(screen.getByTestId("actor-row-a2")).toBeTruthy());
    expect(screen.queryByTestId("actor-row-a1")).toBeNull();
  });

  it("adds an actor by hand and opens them in the modal", async () => {
    renderList();
    await screen.findByTestId("actors-count");
    fireEvent.change(screen.getByLabelText("New actor name"), { target: { value: "New Actor" } });
    fireEvent.click(screen.getByRole("button", { name: "Add actor" }));
    await waitFor(() => expect(createActor).toHaveBeenCalledWith("New Actor", null));
    const modal = await screen.findByTestId("record-modal");
    expect(await within(modal).findByTestId("actor-detail-page")).toBeTruthy();
  });

  it("opens an actor in a modal over the list, without a back link, and closing keeps the list", async () => {
    renderList();
    const row = await screen.findByTestId("actor-row-a1");
    fireEvent.click(within(row).getByRole("link", { name: "Indigo Reyes" }));
    const modal = await screen.findByTestId("record-modal");
    expect(await within(modal).findByTestId("actor-detail-page")).toBeTruthy();
    expect(within(modal).queryByRole("link", { name: "Back to Actors" })).toBeNull();
    expect(screen.getByTestId("actors-count")).toBeTruthy();
    fireEvent.keyDown(modal, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("record-modal")).toBeNull());
    expect(screen.getByTestId("actor-row-a1")).toBeTruthy();
  });
});

describe("Actor page", () => {
  it("lists castings read only and shows media through signed links", async () => {
    renderDetail();
    const castings = await screen.findByRole("region", { name: "Castings" });
    expect(within(castings).getByRole("link", { name: "Harbor Home" }).getAttribute("href")).toBe("/builder/clients/harbor");
    expect(castings).toHaveTextContent("Booked");
    expect(castings).toHaveTextContent("Shoot Nov 19, 2026, Test Studio A");
    expect(within(castings).queryByRole("combobox")).toBeNull();
    expect(within(screen.getByRole("region", { name: "Videos" })).getByRole("link", { name: "Play" }).getAttribute("href")).toBe("https://signed.example.test/reel");
    expect(within(screen.getByRole("region", { name: "Photos" })).getByText("File not in storage")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Social" }).getAttribute("href")).toBe("https://instagram.com/indigo");
  });

  it("offers upload on the headshot, videos and photos, and asks before a delete", async () => {
    renderDetail();
    await screen.findByRole("region", { name: "Castings" });
    expect(screen.getByRole("button", { name: "Add main photo" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Videos" })).getByRole("button", { name: "Add videos" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Photos" })).getByRole("button", { name: "Add photos" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete Photo 1" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete Photo 1?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("saves the profile", async () => {
    renderDetail();
    await screen.findByRole("region", { name: "Castings" });
    fireEvent.change(screen.getByLabelText("Skills (comma separated)"), { target: { value: "Comedy, Stunts" } });
    fireEvent.change(screen.getByLabelText("Dog owner"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(saveActor).toHaveBeenCalledTimes(1));
    expect(saveActor.mock.calls[0][0]).toBe("a1");
    expect(saveActor.mock.calls[0][1]).toMatchObject({ skills: ["Comedy", "Stunts"], dog_owner: null, name: "Indigo Reyes" });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
  });

  it("refuses a blank name without writing", async () => {
    renderDetail();
    await screen.findByRole("region", { name: "Castings" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A name is required.");
    expect(saveActor).not.toHaveBeenCalled();
  });

  it("says so when the id matches no actor", async () => {
    loadActorDetail.mockResolvedValue({ actor: null, castings: [], videos: [], photos: [], links: new Map() });
    renderDetail();
    expect(await screen.findByText("No actor with this id.")).toBeTruthy();
  });
});

describe("actor model", () => {
  it("round-trips the filters and ignores bad values", () => {
    const f = { ...DEFAULT_ACTOR_FILTERS, search: "kai", dog: "yes" as const, skill: "Dance", showDoNotUse: true, sort: "newest" as const, page: 3 };
    expect(actorFiltersFromParams(actorFiltersToParams(f))).toEqual(f);
    expect(actorFiltersFromParams(new URLSearchParams("dog=maybe&page=0"))).toEqual(DEFAULT_ACTOR_FILTERS);
  });

  it("treats an unknown dog answer as neither yes nor no", () => {
    const unknown = actor("u", "Unknown", { dog_owner: null });
    expect(filterActors([unknown], { ...DEFAULT_ACTOR_FILTERS, dog: "yes" })).toEqual([]);
    expect(filterActors([unknown], { ...DEFAULT_ACTOR_FILTERS, dog: "no" })).toEqual([]);
    expect(filterActors([unknown], DEFAULT_ACTOR_FILTERS)).toEqual([unknown]);
  });

  it("collects distinct skills and parses the form", () => {
    expect(skillOptions(ROSTER)).toEqual(["Comedy", "Improv", "Voiceover"]);
    const form = actorToForm(record());
    expect(form.dog_owner).toBe("yes");
    expect(actorFormToPatch({ ...form, dog_owner: "no", phone: " ", age_range: "18-24,  " })).toMatchObject({ patch: { dog_owner: false, phone: null, age_range: ["18-24"] } });
  });
});
