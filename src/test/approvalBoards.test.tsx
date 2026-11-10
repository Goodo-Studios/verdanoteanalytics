/**
 * Approval boards, staff side (consolidation step 5b, port of the old
 * dashboard's approval panel).
 *
 * - Per brand: the live creator link (served by the old dashboard) with copy and
 *   revoke, a new link with an expiry when none is live, past links.
 * - The client's thumbs up and down, with the unverified typed name, linked to
 *   the creator page; Apply sends them to apply_approval_votes after a confirm.
 * - The page says that clients use the old dashboard's copy until the release.
 * The row rules and apply_approval_votes are in supabase/tests/dashboard_approval_boards_page_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WithClient } from "./clientSelection";
import type { ApprovalBoard, ApprovalVote } from "@/features/dashboard/approvalBoardsModel";

const { FakeDashboardError } = vi.hoisted(() => ({
  FakeDashboardError: class extends Error {
    code?: string;
    constructor(e: { code?: string; message: string }) {
      super(e.message);
      this.code = e.code;
    }
  },
}));
const loadBrandsAndTeam = vi.fn();
const loadBoards = vi.fn();
const loadVotes = vi.fn();
const createBoard = vi.fn();
const revokeBoard = vi.fn();
const applyVotes = vi.fn();

vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/employee" }));
vi.mock("@/features/dashboard/api", () => ({ DashboardError: FakeDashboardError, loadBrandsAndTeam: () => loadBrandsAndTeam() }));
vi.mock("@/features/dashboard/approvalBoardsApi", () => ({
  loadBoards: (...a: unknown[]) => loadBoards(...a),
  loadVotes: (...a: unknown[]) => loadVotes(...a),
  createBoard: (...a: unknown[]) => createBoard(...a),
  revokeBoard: (...a: unknown[]) => revokeBoard(...a),
  applyVotes: (...a: unknown[]) => applyVotes(...a),
}));

import { answerConfirm } from "@/test/productionConfirm";
import ApprovalBoardsPage from "@/features/dashboard/ApprovalBoardsPage";
import {
  BOARD_TOKEN_LENGTH,
  activeBoard,
  approvalUrl,
  generateBoardToken,
  parseExpiry,
  splitVotes,
  votesPayload,
} from "@/features/dashboard/approvalBoardsModel";

const NOW = new Date("2026-11-10T12:00:00Z");
const board = (id: string, extra: Partial<ApprovalBoard> = {}): ApprovalBoard => ({
  id, client_slug: "glow", board_type: "creators", token: `tok-${id}`, expires_at: "2026-11-20T00:00:00Z", revoked: false,
  created_at: "2026-11-06T00:00:00Z", ...extra,
});
const vote = (id: string, v: "up" | "down", name: string, extra: Partial<ApprovalVote> = {}): ApprovalVote => ({
  id, board_id: "b1", assignment_id: `as-${id}`, vote: v, voted_at: "2026-11-08T00:00:00Z", voted_by: null,
  creator_assignments: { creator_id: `cr-${id}`, stage: "shortlisted", dashboard_creators: { name } }, ...extra,
});
const BOARDS = [board("b1"), board("b0", { revoked: true, created_at: "2026-10-01T00:00:00Z", expires_at: "2026-10-15T00:00:00Z" })];
const VOTES = [vote("v1", "up", "Avery Stone", { voted_by: "Sam" }), vote("v2", "up", "Blake Rivers"), vote("v3", "down", "Casey Moreno")];

beforeEach(() => {
  for (const f of [loadBrandsAndTeam, loadBoards, loadVotes, createBoard, revokeBoard, applyVotes]) f.mockReset();
  loadBrandsAndTeam.mockResolvedValue({
    brands: [
      { slug: "glow", name: "Glow Co", active: true, does_creators: true },
      { slug: "studio", name: "Studio only", active: true, does_creators: false },
    ],
    users: [],
  });
  loadBoards.mockResolvedValue(BOARDS);
  loadVotes.mockResolvedValue(VOTES);
  createBoard.mockResolvedValue(board("b2"));
  revokeBoard.mockResolvedValue(undefined);
  applyVotes.mockResolvedValue(3);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const renderPage = (slug = "glow") => render(
  <WithClient slug={slug}><MemoryRouter initialEntries={["/approval-boards"]}><Routes><Route path="/approval-boards" element={<ApprovalBoardsPage />} /></Routes></MemoryRouter></WithClient>,
);

describe("Approval boards page", () => {
  it("asks for a client when none is selected and has no client dropdown of its own", async () => {
    renderPage("");
    expect(await screen.findByTestId("pick-client-prompt")).toHaveTextContent("Pick a client in the switcher at the top of the page to see its approval link.");
    expect(screen.queryByLabelText("Brand")).toBeNull();
    expect(screen.queryByLabelText("Client")).toBeNull();
    expect(loadBoards).not.toHaveBeenCalled();
  });

  it("shows the live link on the old dashboard, the responses and past links", async () => {
    renderPage();
    const live = await screen.findByTestId("live-link");
    expect(within(live).getByRole("link").getAttribute("href")).toBe("https://goodostudios-production.vercel.app/approve/tok-b1");
    expect(live).toHaveTextContent("expires Nov 20, 2026");
    expect(loadVotes).toHaveBeenCalledWith("b1");
    const approved = await screen.findByRole("region", { name: "Approved" });
    expect(approved).toHaveTextContent("Approved (2)");
    expect(within(approved).getByRole("link", { name: "Avery Stone" }).getAttribute("href")).toBe("/employee/creators/cr-v1");
    expect(within(approved).getByTestId("vote-v1")).toHaveTextContent("Sam (name typed by the reviewer)");
    expect(screen.getByRole("region", { name: "Passed on" })).toHaveTextContent("Casey Moreno");
    expect(screen.getByTestId("past-b0")).toHaveTextContent("revoked");
    expect(screen.getByTestId("old-dashboard-note")).toHaveTextContent("Public links still open on the old dashboard for now");
    expect(screen.getByRole("link", { name: "Creator pipeline" }).getAttribute("href")).toBe("/employee/talent/pipeline");
  });

  it("applies the decisions after a confirm", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Apply decisions" }));
    await answerConfirm("Apply");
    await waitFor(() => expect(applyVotes).toHaveBeenCalledWith("glow", [
      { assignment_id: "as-v1", vote: "up" }, { assignment_id: "as-v2", vote: "up" }, { assignment_id: "as-v3", vote: "down" },
    ]));
    expect(await screen.findByRole("status")).toHaveTextContent("Applied 3 decisions: 2 approved, 1 declined.");
  });

  it("explains a refused apply and applies nothing when the confirm is cancelled", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Apply decisions" }));
    await answerConfirm("Cancel");
    expect(applyVotes).not.toHaveBeenCalled();
    applyVotes.mockRejectedValueOnce(new FakeDashboardError({ code: "P0002", message: "assignment not found for client" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply decisions" }));
    await answerConfirm("Apply");
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer on the client. Nothing was applied.");
  });

  it("revokes the live link after a confirm", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await answerConfirm("Revoke");
    await waitFor(() => expect(revokeBoard).toHaveBeenCalledWith("b1"));
    expect(await screen.findByRole("status")).toHaveTextContent("Link revoked.");
  });

  it("creates a link with an expiry when none is live, and refuses a past date", async () => {
    loadBoards.mockResolvedValue([BOARDS[1]]);
    renderPage();
    const input = await screen.findByLabelText("Expiry date");
    expect((input as HTMLInputElement).value).toBe("2026-11-24");
    expect(screen.queryByRole("region", { name: "Client responses" })).toBeNull();
    fireEvent.change(input, { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick an expiry date in the future.");
    expect(createBoard).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    await waitFor(() => expect(createBoard).toHaveBeenCalledWith("glow", new Date("2026-12-01T23:59:59.999Z")));
  });
});

describe("approval boards model", () => {
  it("makes 48-character tokens from the url-safe alphabet", () => {
    const t = generateBoardToken();
    expect(t).toHaveLength(BOARD_TOKEN_LENGTH);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateBoardToken()).not.toBe(t);
    expect(generateBoardToken(() => new Uint8Array(48).fill(255))).toBe("_".repeat(48));
  });
  it("picks the newest board that is neither revoked nor expired", () => {
    const boards = [board("old", { created_at: "2026-11-01T00:00:00Z" }), board("new", { created_at: "2026-11-09T00:00:00Z", revoked: true }), board("exp", { created_at: "2026-11-09T01:00:00Z", expires_at: "2026-11-09T00:00:00Z" })];
    expect(activeBoard(boards, NOW)?.id).toBe("old");
    expect(activeBoard([], NOW)).toBeNull();
  });
  it("parses an expiry as the end of a future day", () => {
    expect(parseExpiry("2026-11-11", NOW)?.toISOString()).toBe("2026-11-11T23:59:59.999Z");
    expect(parseExpiry("2026-11-09", NOW)).toBeNull();
    expect(parseExpiry("2026-02-30", NOW)).toBeNull();
    expect(parseExpiry("soon", NOW)).toBeNull();
  });
  it("splits and sends votes", () => {
    expect(splitVotes(VOTES).approved.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(votesPayload([VOTES[2]])).toEqual([{ assignment_id: "as-v3", vote: "down" }]);
    expect(approvalUrl("abc")).toBe("https://goodostudios-production.vercel.app/approve/abc");
  });
});
