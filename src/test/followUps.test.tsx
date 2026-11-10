/**
 * Follow-ups (consolidation step 5a, port of the old dashboard Follow-ups).
 *
 * - Overdue, due today and coming up, oldest first; terminal stages never show.
 * - An employee sees only their own (matched to app_users by login email);
 *   a builder starts on their own and can switch to all; a login with no
 *   app_users row sees all with the picker.
 * - Snooze 1 and 3 days, a typed date, clear and owner changes call updateAssignment.
 * The row rules are in supabase/tests/dashboard_batch1_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignment } from "@/features/dashboard/model";

const loadFollowUps = vi.fn();
const loadBrandsAndTeam = vi.fn();
const updateAssignment = vi.fn();
let auth: { user: { email: string } | null; isBuilder: boolean } = { user: { email: "ellie@example.test" }, isBuilder: false };

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useRolePath", () => ({ useRolePrefix: () => "/builder" }));
vi.mock("@/features/dashboard/api", () => ({
  DashboardError: class extends Error { code?: string },
  loadFollowUps: () => loadFollowUps(),
  loadBrandsAndTeam: () => loadBrandsAndTeam(),
  updateAssignment: (...a: unknown[]) => updateAssignment(...a),
}));

import FollowUpsPage from "@/features/dashboard/FollowUpsPage";
import { daysOverdue, formatOverdue, groupFollowUps, ownerScope, snoozeDate } from "@/features/dashboard/model";

const NOW = new Date("2026-11-10T12:00:00Z");
const row = (id: string, stage: string, date: string | null, owner: string | null): Assignment => ({
  id, creator_id: `c-${id}`, client_slug: "glow", stage, owner_id: owner, next_follow_up_at: date, next_follow_up_source: "manual",
  tracking_number: null, product_delivered_at: null, brief_name: null, notes: null,
  dashboard_creators: { name: `Creator ${id}`, scale: null, do_not_use_again: false },
});
const USERS = [
  { id: "u1", name: "Ellie", email: "ellie@example.test", role: "producer", active: true },
  { id: "u2", name: "Robin", email: "robin@example.test", role: "admin", active: true },
];
const ROWS = [
  row("old", "contract_sent", "2026-11-07", "u1"),
  row("today", "product_shipped", "2026-11-10", "u1"),
  row("later", "brief_sent", "2026-11-14", "u1"),
  row("theirs", "contract_signed", "2026-11-08", "u2"),
];

beforeEach(() => {
  for (const f of [loadFollowUps, loadBrandsAndTeam, updateAssignment]) f.mockReset();
  loadFollowUps.mockResolvedValue(ROWS);
  loadBrandsAndTeam.mockResolvedValue({ brands: [{ slug: "glow", name: "Glow Co", active: true, does_creators: true }], users: USERS });
  updateAssignment.mockResolvedValue(undefined);
  auth = { user: { email: "ellie@example.test" }, isBuilder: false };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

const renderPage = () => render(<MemoryRouter><FollowUpsPage /></MemoryRouter>);

describe("Follow-ups page", () => {
  it("shows an employee only their own, grouped and dated", async () => {
    renderPage();
    const overdue = await screen.findByRole("region", { name: "Overdue" });
    expect(overdue).toHaveTextContent("Overdue (1)");
    expect(within(overdue).getByTestId("follow-up-old")).toHaveTextContent("Glow Co · Contract Sent · 3 days overdue");
    expect(screen.getByRole("region", { name: "Due today" })).toHaveTextContent("Due today (1)");
    expect(screen.getByRole("region", { name: "Coming up" })).toHaveTextContent("Nov 14, 2026");
    expect(screen.queryByTestId("follow-up-theirs")).toBeNull();
    expect(screen.queryByLabelText("Whose follow-ups")).toBeNull();
    expect(screen.getByText(/Showing your follow-ups \(Ellie\)/)).toBeTruthy();
    expect(within(overdue).getByRole("link", { name: "Glow Co" }).getAttribute("href")).toBe("/builder/creator-pipeline?brand=glow");
  });

  it("snoozes, reschedules, clears and reassigns", async () => {
    renderPage();
    const row1 = await screen.findByTestId("follow-up-old");
    fireEvent.click(within(row1).getByRole("button", { name: "Snooze 1 day" }));
    await waitFor(() => expect(updateAssignment).toHaveBeenCalledWith("old", { next_follow_up_at: "2026-11-11" }));
    fireEvent.click(within(screen.getByTestId("follow-up-old")).getByRole("button", { name: "Snooze 3 days" }));
    await waitFor(() => expect(updateAssignment).toHaveBeenCalledWith("old", { next_follow_up_at: "2026-11-13" }));
    fireEvent.change(screen.getByLabelText("Follow-up date for Creator old"), { target: { value: "2026-12-01" } });
    await waitFor(() => expect(updateAssignment).toHaveBeenCalledWith("old", { next_follow_up_at: "2026-12-01" }));
    fireEvent.click(within(screen.getByTestId("follow-up-old")).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(updateAssignment).toHaveBeenCalledWith("old", { next_follow_up_at: null }));
    fireEvent.change(screen.getByLabelText("Owner for Creator old"), { target: { value: "u2" } });
    await waitFor(() => expect(updateAssignment).toHaveBeenCalledWith("old", { owner_id: "u2" }));
  });

  it("lets a builder switch from their own to all owners", async () => {
    auth = { user: { email: "robin@example.test" }, isBuilder: true };
    renderPage();
    expect(await screen.findByTestId("follow-up-theirs")).toBeTruthy();
    expect(screen.queryByTestId("follow-up-old")).toBeNull();
    fireEvent.change(screen.getByLabelText("Whose follow-ups"), { target: { value: "all" } });
    expect(await screen.findByTestId("follow-up-old")).toBeTruthy();
  });

  it("shows everyone, with the picker, to a login not on the team list", async () => {
    auth = { user: { email: "stranger@example.test" }, isBuilder: false };
    renderPage();
    expect(await screen.findByTestId("follow-up-theirs")).toBeTruthy();
    expect(screen.getByTestId("follow-up-old")).toBeTruthy();
    expect(screen.getByText(/not on the dashboard team list/)).toBeTruthy();
  });
});

describe("follow-ups model", () => {
  it("groups by date, oldest first, and drops terminal stages", () => {
    const g = groupFollowUps([...ROWS, row("done", "footage_delivered", "2026-11-01", "u1"), row("none", "sourced", null, "u1")], "2026-11-10");
    expect(g.overdue.map((r) => r.id)).toEqual(["old", "theirs"]);
    expect(g.dueToday.map((r) => r.id)).toEqual(["today"]);
    expect(g.upcoming.map((r) => r.id)).toEqual(["later"]);
  });
  it("counts days overdue and snoozes in UTC across month ends", () => {
    expect(daysOverdue("2026-11-07", "2026-11-10")).toBe(3);
    expect(formatOverdue(0)).toBe("Due today");
    expect(formatOverdue(1)).toBe("1 day overdue");
    expect(snoozeDate("2026-11-30", 1)).toBe("2026-12-01");
    expect(snoozeDate("2026-12-30", 3)).toBe("2027-01-02");
  });
  it("scopes owners by role", () => {
    expect(ownerScope(USERS[0], false, "all")).toEqual({ owner: "u1", canPick: false });
    expect(ownerScope(USERS[1], true, null)).toEqual({ owner: "u2", canPick: true });
    expect(ownerScope(USERS[1], true, "all")).toEqual({ owner: "all", canPick: true });
    expect(ownerScope(null, false, null)).toEqual({ owner: "all", canPick: true });
  });
});
