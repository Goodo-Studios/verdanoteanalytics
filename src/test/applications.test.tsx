/**
 * Applications (consolidation step 5b, port of the old dashboard Applications
 * and Actor applications pages).
 *
 * - Creator and actor queues, pending or rejected, newest first, with search;
 *   approved ones are counted and live on the roster pages.
 * - An applicant whose email is already on the roster is flagged.
 * - Bulk reject needs a reason and reports each outcome.
 * - The application page approves (and opens the new roster page) or rejects
 *   with a reason; a decided application shows who, when and why.
 * - The public forms stay on the old dashboard and are linked.
 * The row rules and the checked functions are in supabase/tests/dashboard_applications_page_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorApplication, CreatorApplication } from "@/features/dashboard/applicationsModel";

const loadApplications = vi.fn();
const loadApplicationDetail = vi.fn();
const approveApplication = vi.fn();
const rejectApplication = vi.fn();

const { FakeDashboardError } = vi.hoisted(() => ({
  FakeDashboardError: class extends Error {
    code?: string;
    constructor(e: { code?: string; message: string }) {
      super(e.message);
      this.code = e.code;
    }
  },
}));

vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/employee" }));
vi.mock("@/features/dashboard/api", () => ({ DashboardError: FakeDashboardError }));
vi.mock("@/features/dashboard/applicationsApi", () => ({
  loadApplications: (...a: unknown[]) => loadApplications(...a),
  loadApplicationDetail: (...a: unknown[]) => loadApplicationDetail(...a),
  approveApplication: (...a: unknown[]) => approveApplication(...a),
  rejectApplication: (...a: unknown[]) => rejectApplication(...a),
}));

import ApplicationsPage from "@/features/dashboard/ApplicationsPage";
import ApplicationDetailPage from "@/features/dashboard/ApplicationDetailPage";
import { queue, reviewErrorText, rosterMatches, socialLines, summarizeBulkReject } from "@/features/dashboard/applicationsModel";

const capp = (id: string, name: string, extra: Partial<CreatorApplication> = {}): CreatorApplication => ({
  id, status: "pending", name, email: `${id}@example.test`, gender: null, age_range: ["25-34"], headshot_path: null,
  submitted_at: "2026-11-01T00:00:00Z", reviewed_at: null, review_notes: null, app_users: null,
  socials: null, website: null, categories: ["Skincare"], location: "Testville", shipping_address: "1 Test St",
  alcohol_ok: false, cbd_ok: true, thc_ok: false, family_inclusive_ok: true, ...extra,
});
const aapp = (id: string, name: string, extra: Partial<ActorApplication> = {}): ActorApplication => ({
  id, status: "pending", name, email: `${id}@example.test`, gender: "Male", age_range: ["35-44"], headshot_path: null,
  submitted_at: "2026-11-02T00:00:00Z", reviewed_at: null, review_notes: null, app_users: null,
  phone: "555-0150", notes: null, dog_owner: null, kids_in_videos: null, social_url: null, additional_social_url: null, ...extra,
});
const CREATOR_ROWS = [
  capp("c1", "Morgan Ellis", { submitted_at: "2026-11-03T00:00:00Z" }),
  capp("c2", "Avery Stone", { email: "Avery@Example.test " }),
  capp("c3", "Oakley Price", { status: "rejected", review_notes: "Outside the categories" }),
  capp("c4", "Already In", { status: "approved" }),
];

let confirmSpy: { mockReturnValue: (v: boolean) => unknown; mockRestore: () => void };
beforeEach(() => {
  for (const f of [loadApplications, loadApplicationDetail, approveApplication, rejectApplication]) f.mockReset();
  loadApplications.mockImplementation((kind: string) => Promise.resolve(kind === "actors"
    ? { rows: [aapp("a1", "Parker Lane")], roster: [] }
    : { rows: CREATOR_ROWS, roster: [{ id: "r1", name: "Avery Stone", email: "avery@example.test" }] }));
  rejectApplication.mockResolvedValue(undefined);
  approveApplication.mockResolvedValue("new-creator");
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => confirmSpy.mockRestore());

const renderList = (url = "/applications") => render(
  <MemoryRouter initialEntries={[url]}><Routes><Route path="/applications" element={<ApplicationsPage />} /></Routes></MemoryRouter>,
);
const renderDetail = (url = "/applications/creators/c1") => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/applications/:kind/:id" element={<ApplicationDetailPage />} />
      <Route path="/employee/creators/:id" element={<div data-testid="creator-opened">opened</div>} />
    </Routes>
  </MemoryRouter>,
);

describe("Applications page", () => {
  it("shows the pending creator queue newest first, with counts, the form link and roster matches", async () => {
    renderList();
    const first = await screen.findByTestId("application-c1");
    const items = screen.getAllByTestId(/^application-/).map((el) => el.getAttribute("data-testid"));
    expect(items).toEqual(["application-c1", "application-c2"]);
    expect(within(first).getByRole("link", { name: "Morgan Ellis" }).getAttribute("href")).toBe("/employee/applications/creators/c1");
    expect(screen.getByRole("button", { name: "Pending (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rejected (1)" })).toBeTruthy();
    expect(screen.getByText(/1 approved, now on the/)).toBeTruthy();
    const avery = within(screen.getByTestId("application-c2")).getAllByRole("link", { name: "Avery Stone" }).map((l) => l.getAttribute("href"));
    expect(avery).toEqual(["/employee/applications/creators/c2", "/employee/creators/r1"]);
    expect(screen.getByTestId("application-c2")).toHaveTextContent("Already on the roster");
    expect(screen.getByTestId("application-c1")).not.toHaveTextContent("Already on the roster");
    expect(screen.getByRole("link", { name: "https://goodostudios-production.vercel.app/creatorapply" }).getAttribute("target")).toBe("_blank");
  });

  it("switches to rejected and to actor applications", async () => {
    renderList("/applications?status=rejected");
    expect(await screen.findByTestId("application-c3")).toHaveTextContent("Reason: Outside the categories");
    fireEvent.click(screen.getByRole("button", { name: "Actor applications" }));
    expect(await screen.findByTestId("application-a1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pending (1)" }).getAttribute("aria-pressed")).toBe("true");
    expect(loadApplications).toHaveBeenLastCalledWith("actors");
    expect(screen.getByRole("link", { name: "https://goodostudios-production.vercel.app/actorapply" })).toBeTruthy();
  });

  it("bulk rejects with one reason and reports the outcome", async () => {
    rejectApplication.mockImplementation((_k: string, id: string) =>
      id === "c2" ? Promise.reject(new FakeDashboardError({ code: "55000", message: "already decided" })) : Promise.resolve());
    renderList();
    await screen.findByTestId("application-c1");
    fireEvent.click(screen.getByLabelText("Select Morgan Ellis"));
    fireEvent.click(screen.getByLabelText("Select Avery Stone"));
    fireEvent.click(screen.getByRole("button", { name: "Reject 2" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A rejection reason is required.");
    expect(rejectApplication).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Rejection reason"), { target: { value: "Not a fit this round" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject 2" }));
    await waitFor(() => expect(rejectApplication).toHaveBeenCalledTimes(2));
    expect(rejectApplication).toHaveBeenCalledWith("creators", "c1", "Not a fit this round");
    expect(await screen.findByRole("status")).toHaveTextContent("Rejected 1 of 2 applications. Failed: Avery Stone.");
  });
});

describe("Application page", () => {
  it("shows the applicant, the roster match and approves into the roster", async () => {
    loadApplicationDetail.mockResolvedValue({
      application: capp("c1", "Morgan Ellis", { socials: { instagram: "@morgan", tiktok: "" }, website: "morgan.example.test" }),
      videos: [{ id: "v1", storage_path: "app/v1.mp4", thumbnail_path: null, title: null, sort_order: 1 }],
      roster: [{ id: "r9", name: "Morgan Ellis", email: "c1@example.test" }],
      links: new Map([["app/v1.mp4", "https://signed.example.test/v1"]]),
    });
    renderDetail();
    expect(await screen.findByTestId("roster-match")).toHaveTextContent("already on the roster");
    expect(screen.getByText("instagram: @morgan")).toBeTruthy();
    expect(screen.getByText("1 Test St")).toBeTruthy();
    expect(screen.getByRole("link", { name: "https://morgan.example.test" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Videos" })).getByRole("link", { name: "Play" }).getAttribute("href")).toBe("https://signed.example.test/v1");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approveApplication).toHaveBeenCalledWith("creators", "c1"));
    expect(await screen.findByTestId("creator-opened")).toBeTruthy();
  });

  it("does not approve when the confirm is cancelled", async () => {
    confirmSpy.mockReturnValue(false);
    loadApplicationDetail.mockResolvedValue({ application: capp("c1", "Morgan Ellis"), videos: [], roster: [], links: new Map() });
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(approveApplication).not.toHaveBeenCalled();
  });

  it("rejects with a reason and explains a refusal", async () => {
    loadApplicationDetail.mockResolvedValue({ application: aapp("a1", "Parker Lane"), videos: [], roster: [], links: new Map() });
    rejectApplication.mockRejectedValueOnce(new FakeDashboardError({ code: "55000", message: "already decided" }));
    renderDetail("/applications/actors/a1");
    expect(await screen.findByText("555-0150")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A rejection reason is required.");
    fireEvent.change(screen.getByLabelText("Rejection reason"), { target: { value: "No reel" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(rejectApplication).toHaveBeenCalledWith("actors", "a1", "No reel"));
    expect(await screen.findByRole("alert")).toHaveTextContent("already decided");
  });

  it("shows a decided application with who, when and why", async () => {
    loadApplicationDetail.mockResolvedValue({
      application: capp("c3", "Oakley Price", { status: "rejected", reviewed_at: "2026-11-05T10:00:00Z", review_notes: "Outside the categories", app_users: { name: "Test Employee" } }),
      videos: [], roster: [], links: new Map(),
    });
    renderDetail("/applications/creators/c3");
    expect(await screen.findByTestId("decision")).toHaveTextContent("Rejected on Nov 5, 2026 by Test Employee. Reason: Outside the categories");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("applications model", () => {
  it("queues by status and search, newest first", () => {
    expect(queue(CREATOR_ROWS, "pending", "").map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(queue(CREATOR_ROWS, "pending", "testville").length).toBe(2);
    expect(queue(CREATOR_ROWS, "rejected", "").map((r) => r.id)).toEqual(["c3"]);
  });
  it("matches roster emails exactly, ignoring case and spaces", () => {
    const roster = [{ id: "r1", name: "A", email: "a_b@example.test" }, { id: "r2", name: "B", email: "aXb@example.test" }];
    expect(rosterMatches(" A_B@example.TEST ", roster).map((r) => r.id)).toEqual(["r1"]);
    expect(rosterMatches("", roster)).toEqual([]);
  });
  it("words refusals and bulk outcomes", () => {
    expect(reviewErrorText("42501", "x")).toBe("You do not have permission to do that.");
    expect(reviewErrorText(undefined, "failed to copy application headshot")).toBe("failed to copy application headshot");
    expect(summarizeBulkReject([{ id: "1", name: "A", ok: true }])).toBe("Rejected 1 application.");
    expect(summarizeBulkReject([{ id: "1", name: "A", ok: false }])).toBe("Could not reject A.");
    expect(socialLines({ instagram: " @a ", tiktok: "" })).toEqual(["instagram: @a"]);
  });
});
