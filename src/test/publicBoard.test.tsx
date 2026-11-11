/**
 * The page opened from an approval or casting link (no login).
 * States: valid, wrong token, revoked, expired, rate limited, error, vote success, vote error.
 * The function itself is covered in supabase/functions/public-link/index.test.ts.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublicBoardPage from "@/features/public-links/PublicBoardPage";
import { failureFromStatus, publicLinkUrl, safeHref } from "@/features/public-links/publicLinkApi";
import { describeActivity, lastResponse } from "@/features/public-links/linkStats";

const BOARD = {
  kind: "approval",
  client_name: "Glow Co",
  expires_at: "2030-01-01T00:00:00Z",
  people: [
    { assignment_id: "a1", name: "Avery Stone", vote: null, videos: [{ id: "v1", title: "Intro", url: "https://signed.example/v1.mp4", thumbnail_url: null }], family_pet_photos: [{ id: "p1", category: "pet", caption: "Rex" }], filming_location_photos: [], },
    { assignment_id: "a2", name: "Blake Rivers", vote: "up", videos: [] },
  ],
};

const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
let fetchMock: ReturnType<typeof vi.fn>;

const renderPage = (type: "approval" | "casting" = "approval") => render(
  <MemoryRouter initialEntries={[`/${type === "approval" ? "approve" : "cast"}/tok`]}>
    <Routes><Route path="/approve/:token" element={<PublicBoardPage type="approval" />} /><Route path="/cast/:token" element={<PublicBoardPage type="casting" />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("public board page", () => {
  it("shows the board with no staff menu, and asks for the get action with the token", async () => {
    fetchMock.mockImplementation(() => reply(200, BOARD));
    renderPage();
    expect(await screen.findByText("Avery Stone")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Glow Co");
    expect(screen.getByTestId("progress").textContent).toBe("1 of 2 answered");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toEqual({ type: "approval", action: "get", token: "tok" });
  });

  it.each([
    [404, { error: "not_found" }, "This link is not available"],
    [410, { error: "revoked" }, "This link has been turned off"],
    [410, { error: "expired" }, "This link has expired"],
    [429, { error: "rate_limited" }, "That was a lot of tries"],
    [500, { error: "server_error" }, "Something went wrong on our side"],
  ])("explains a %s answer plainly and shows no board", async (status, body, title) => {
    fetchMock.mockImplementation(() => reply(status, body));
    renderPage("casting");
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(screen.queryByText("Avery Stone")).toBeNull();
  });

  it("offers a retry after a server error and loads the board on the second try", async () => {
    fetchMock.mockImplementationOnce(() => reply(500, { error: "server_error" })).mockImplementation(() => reply(200, BOARD));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Avery Stone")).toBeTruthy();
  });

  it("treats a network failure as an error", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("offline")));
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Something went wrong on our side" })).toBeTruthy();
  });

  it("saves a vote with the typed first name and shows it", async () => {
    fetchMock.mockImplementation((_u: string, init: { body: string }) => (JSON.parse(init.body).action === "vote" ? reply(200, { ok: true }) : reply(200, BOARD)));
    renderPage();
    await screen.findByText("Avery Stone");
    fireEvent.change(screen.getByLabelText(/Your first name/), { target: { value: "Sam" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Yes/ })[0]);
    expect(await screen.findByTestId("saved")).toBeTruthy();
    const vote = JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
    expect(vote).toEqual({ type: "approval", action: "vote", token: "tok", assignment_id: "a1", vote: "up", voted_by: "Sam" });
    expect(screen.getByTestId("progress").textContent).toBe("2 of 2 answered");
  });

  it("says so when a vote fails, and keeps the board", async () => {
    fetchMock.mockImplementation((_u: string, init: { body: string }) => (JSON.parse(init.body).action === "vote" ? reply(500, { error: "server_error" }) : reply(200, BOARD)));
    renderPage();
    await screen.findByText("Avery Stone");
    fireEvent.click(screen.getAllByRole("button", { name: /No thanks/ })[0]);
    expect((await screen.findByRole("alert")).textContent).toContain("Something went wrong on our side");
    expect(screen.getByText("Avery Stone")).toBeTruthy();
  });

  it("turns the page over when the link is revoked while it is open", async () => {
    fetchMock.mockImplementation((_u: string, init: { body: string }) => (JSON.parse(init.body).action === "vote" ? reply(410, { error: "revoked" }) : reply(200, BOARD)));
    renderPage();
    await screen.findByText("Avery Stone");
    fireEvent.click(screen.getAllByRole("button", { name: /Yes/ })[0]);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("This link has been turned off"));
  });

  it("loads a photo only after the reviewer asks for photos", async () => {
    fetchMock.mockImplementation((_u: string, init: { body: string }) => (JSON.parse(init.body).action === "photo" ? reply(200, { url: "https://signed.example/p1.jpg" }) : reply(200, BOARD)));
    renderPage();
    await screen.findByText("Avery Stone");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Show 1 photo" }));
    expect((await screen.findByAltText("Rex")).getAttribute("src")).toBe("https://signed.example/p1.jpg");
  });
});

describe("public link helpers", () => {
  it("builds the link on this site with the old dashboard paths", () => {
    expect(publicLinkUrl("approval", "abc", "https://app.example/")).toBe("https://app.example/approve/abc");
    expect(publicLinkUrl("casting", "abc", "https://app.example")).toBe("https://app.example/cast/abc");
  });
  it("maps statuses to reasons", () => {
    expect(failureFromStatus(404, undefined)).toBe("not_found");
    expect(failureFromStatus(410, "revoked")).toBe("revoked");
    expect(failureFromStatus(410, "expired")).toBe("expired");
    expect(failureFromStatus(429, undefined)).toBe("rate_limited");
    expect(failureFromStatus(503, undefined)).toBe("error");
  });
  it("only links http and https", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("insta.com/x")).toBe("https://insta.com/x");
    expect(safeHref(" ")).toBeNull();
  });
  it("describes link activity", () => {
    const f = (iso: string) => iso.slice(0, 10);
    expect(describeActivity(undefined, null, f)).toBe("Not opened yet. No responses yet.");
    expect(describeActivity({ open_count: 1, last_opened_at: "2026-11-09T00:00:00Z" }, "2026-11-10T00:00:00Z", f)).toBe("Opened 1 time, last on 2026-11-09. Last response 2026-11-10.");
    expect(lastResponse([{ voted_at: "a" }, { voted_at: "c" }, { voted_at: "b" }])).toBe("c");
  });
});
