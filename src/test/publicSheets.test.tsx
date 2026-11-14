/**
 * The pages opened from a location link and a call sheet link (no login, view only).
 * States: valid, wrong token, revoked, expired, rate limited, error, and retry.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublicLocationBoardPage from "@/features/public-links/PublicLocationBoardPage";
import PublicCallSheetPage from "@/features/public-links/PublicCallSheetPage";
import { describeOpens } from "@/features/public-links/linkStats";
import { publicLinkUrl } from "@/features/public-links/publicLinkApi";

const BOARD = {
  label: "Spring options", client_name: "Glow Co",
  locations: [{ location_id: "l1", name: "Loft", neighborhood: "Mission", rental_type: "house", rooms: ["Kitchen"], attributes: ["Bright"], photos: [{ id: "p1", caption: "Front", url: "https://signed.example/p1.jpg" }, { id: "p2", caption: null, url: null }] }],
};
const SHEET = {
  call_time: "08:00:00", wrap_time_estimate: "5 pm", general_notes: "Bring ID", shoot_date: "2026-12-01", shoot_location: "Loft", client_name: "Glow Co",
  talent: [{ name: "Ada", phone: "555-0100", email: null }],
  location: { name: "Loft", neighborhood: null, parking_instructions: "Street", wifi_name: "net", wifi_password: "pw", entry_instructions: "Side door", contact_name: "Host", contact_email: null },
  schedule: [{ id: "b1", label: "Setup", start_time: "08:00:00", end_time: "09:00:00", location: null, notes: null, talent: [{ name: "Ada" }], crew: [{ id: "c1", name: "Bo" }] }],
  crew: [{ id: "c1", name: "Bo", role: "DP", phone: "555-0101", email: null }],
};

const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/locations-board/:token" element={<PublicLocationBoardPage />} />
      <Route path="/call-sheet/:token" element={<PublicCallSheetPage />} />
    </Routes>
  </MemoryRouter>,
);

describe("public location board page", () => {
  it("shows the shared locations and photos with no staff menu, and asks for the location type", async () => {
    fetchMock.mockImplementation(() => reply(200, BOARD));
    renderAt("/locations-board/tok");
    expect(await screen.findByText("Loft")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Spring options");
    expect(screen.getByAltText("Front").getAttribute("src")).toBe("https://signed.example/p1.jpg");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ type: "location", action: "get", token: "tok" });
  });
  it.each([
    [404, { error: "not_found" }, "This link is not available"],
    [410, { error: "revoked" }, "This link has been turned off"],
    [410, { error: "expired" }, "This link has expired"],
    [429, { error: "rate_limited" }, "That was a lot of tries"],
    [500, { error: "server_error" }, "Something went wrong on our side"],
  ])("explains a %s answer plainly", async (status, body, title) => {
    fetchMock.mockImplementation(() => reply(status, body));
    renderAt("/locations-board/tok");
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(screen.queryByText("Loft")).toBeNull();
  });
  it("retries after an error", async () => {
    fetchMock.mockImplementationOnce(() => reply(500, {})).mockImplementation(() => reply(200, BOARD));
    renderAt("/locations-board/tok");
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Loft")).toBeTruthy();
  });
});

describe("public call sheet page", () => {
  it("shows the day, location, schedule, talent and crew", async () => {
    fetchMock.mockImplementation(() => reply(200, SHEET));
    renderAt("/call-sheet/tok");
    expect(await screen.findByRole("heading", { level: 1, name: "Call sheet for Glow Co" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "The day" }).textContent).toContain("08:00");
    expect(screen.getByRole("region", { name: "Location" }).textContent).toContain("Side door");
    expect(screen.getByRole("region", { name: "Schedule" }).textContent).toContain("Setup");
    expect(screen.getByRole("region", { name: "Crew" }).textContent).toContain("Bo (DP) · 555-0101");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ type: "call-sheet", action: "get", token: "tok" });
  });
  it.each([
    [404, { error: "not_found" }, "This link is not available"],
    [410, { error: "revoked" }, "This link has been turned off"],
    [410, { error: "expired" }, "This link has expired"],
    [429, { error: "rate_limited" }, "That was a lot of tries"],
    [500, { error: "server_error" }, "Something went wrong on our side"],
  ])("explains a %s answer plainly", async (status, body, title) => {
    fetchMock.mockImplementation(() => reply(status, body));
    renderAt("/call-sheet/tok");
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
  });
});

describe("link helpers for part 2", () => {
  it("builds both links on this site with the old dashboard paths", () => {
    expect(publicLinkUrl("location", "abc", "https://app.example")).toBe("https://app.example/locations-board/abc");
    expect(publicLinkUrl("call-sheet", "abc", "https://app.example")).toBe("https://app.example/call-sheet/abc");
  });
  it("describes how often a link was opened", () => {
    const f = (iso: string) => iso.slice(0, 10);
    expect(describeOpens(undefined, f)).toBe("Not opened yet.");
    expect(describeOpens({ open_count: 2, last_opened_at: "2026-11-09T00:00:00Z" }, f)).toBe("Opened 2 times, last on 2026-11-09.");
  });
});
