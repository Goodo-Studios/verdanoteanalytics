/**
 * Team and settings (consolidation step 5d, old dashboard Settings merged with Verdanote user
 * management).
 *
 * - An employee sees the team list and the role mapping (viewer flagged), and no reconciliation,
 *   invites or edit controls; the reconciliation is never requested for them.
 * - A builder sees the staff list check with counts, per-person issues and proposed changes, and
 *   the actions allowed for each row (prepare invite, add to team list, set role), each a checked
 *   function call; flagged and client rows get no role button.
 * - The builder edits a team member and the mapping (clearing the owner flag asks first), and
 *   cancels an invite with a reason; nothing is sent.
 * - Settings > Admin points staff management at the Team page.
 * - model rules.
 * The database rules are in supabase/tests/staff_team_reconciliation_test.sql.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: { isBuilder: true, role: "builder" } as Record<string, unknown>,
  preview: { isClientPreview: false, isEmployeePreview: false },
}));
const rpc = vi.fn();
const data: Record<string, unknown[]> = {};
const selects: Record<string, string> = {};

function chain(table: string) {
  const q = {
    order: () => q,
    limit: () => q,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: data[table] ?? [], error: null }).then(resolve),
  };
  return q;
}

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => h.preview }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => rpc(name, args),
    from: (table: string) => ({ select: (s: string) => ((selects[table] = s), chain(table)) }),
  },
}));

import TeamPage from "@/features/team/TeamPage";
import { UserManagementSection } from "@/components/user-settings/UserManagementSection";
import {
  canAddToTeam,
  canPrepareInvite,
  cancelReasonProblem,
  mappingFormProblem,
  memberFormProblem,
  proposedChange,
  type ReconRow,
  roleActionFor,
  sortPeople,
  summarize,
} from "@/features/team/model";

const row = (over: Partial<ReconRow>): ReconRow => ({
  email: "x@example.test", team_member_id: "t-x", team_name: "X", team_role: "producer", team_active: true, user_id: "u-x",
  login_name: null, staff_roles: ["employee"], has_client_role: false, mapped_role: "employee", mapping_flagged: false,
  prepared_invite_id: null, possible_match: null, issues: [], ...over,
});

const RECON: ReconRow[] = [
  row({ email: "ok@example.test", team_name: "Ok Person" }),
  row({ email: "nl@example.test", team_member_id: "t-nl", team_name: "No Login", user_id: null, staff_roles: [], issues: ["no_login"] }),
  row({ email: "s1@example.test", team_member_id: null, team_name: null, team_role: null, login_name: "Sam Staff", user_id: "u-s1", mapped_role: null, issues: ["not_on_team_list"] }),
  row({ email: "n1@example.test", team_name: "No Role", user_id: "u-n1", staff_roles: [], issues: ["no_staff_role"] }),
  row({ email: "v1@example.test", team_name: "Vee Viewer", team_role: "viewer", user_id: "u-v1", staff_roles: [], mapping_flagged: true, issues: ["no_staff_role", "mapping_needs_owner"] }),
  row({ email: "cl@example.test", team_name: "Client Mail", user_id: "u-cl", staff_roles: [], has_client_role: true, issues: ["client_login"] }),
];

beforeEach(() => {
  h.auth = { isBuilder: true, role: "builder" };
  h.preview = { isClientPreview: false, isEmployeePreview: false };
  rpc.mockReset();
  rpc.mockImplementation((name: string) => Promise.resolve(name === "staff_reconciliation" ? { data: RECON, error: null } : { data: null, error: null }));
  data.app_users = [
    { id: "t-b", name: "Bea Builder", email: "b@example.test", role: "admin", active: true },
    { id: "t-old", name: "Old Hand", email: "o@example.test", role: "producer", active: false },
    { id: "t-e", name: "Eli Employee", email: "e@example.test", role: "producer", active: true },
  ];
  data.staff_role_mappings = [
    { dashboard_role: "admin", verdanote_role: "builder", needs_owner_decision: false, note: "In the plan.", updated_at: "2026-11-10T00:00:00Z" },
    { dashboard_role: "producer", verdanote_role: "employee", needs_owner_decision: false, note: "Default.", updated_at: "2026-11-10T00:00:00Z" },
    { dashboard_role: "viewer", verdanote_role: "employee", needs_owner_decision: true, note: "Owner decision 2 is open.", updated_at: "2026-11-10T00:00:00Z" },
  ];
  data.staff_invites = [
    { id: "inv-1", team_member_id: "t-nl", email: "nl@example.test", name: "No Login", proposed_role: "employee", mapping_flagged: false, status: "prepared", prepared_at: "2026-11-10T00:00:00Z", cancelled_at: null, cancel_reason: null },
  ];
  data.staff_admin_events = [{ id: "ev-1", kind: "invite_prepared", subject: "nl@example.test", detail: {}, created_at: "2026-11-10T00:00:00Z" }];
});
afterEach(() => cleanup());

describe("TeamPage", () => {
  it("shows an employee the team list and the mapping only, and never asks for the reconciliation", async () => {
    h.auth = { isBuilder: false, role: "employee" };
    render(<TeamPage />);
    const members = await screen.findAllByTestId("team-member");
    expect(members.map((m) => m.textContent?.split(" ")[0])).toEqual(["Bea", "Eli", "Old"]);
    expect(members[2]).toHaveTextContent("Deactivated");
    const mappings = screen.getAllByTestId("mapping-row");
    expect(mappings).toHaveLength(3);
    expect(mappings[2]).toHaveTextContent("Waits on the owner (not applied)");
    expect(screen.queryByText("Staff list check")).toBeNull();
    expect(screen.queryByText("Invites")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Change")).toBeNull();
    // The only call an employee makes is the checklist counts (open to staff); no builder-only function.
    expect(rpc.mock.calls.map((c) => c[0]).filter((n) => n !== "client_setup_status")).toEqual([]);
    expect(selects.app_users).toBe("id, name, email, role, active");
  });

  it("treats a builder previewing as an employee as an employee", async () => {
    h.preview = { isClientPreview: false, isEmployeePreview: true };
    render(<TeamPage />);
    await screen.findAllByTestId("team-member");
    // The only call an employee makes is the checklist counts (open to staff); no builder-only function.
    expect(rpc.mock.calls.map((c) => c[0]).filter((n) => n !== "client_setup_status")).toEqual([]);
  });

  it("shows a builder the staff list check with counts, issues and proposed changes", async () => {
    render(<TeamPage />);
    expect(await screen.findByTestId("recon-summary")).toHaveTextContent("6 people, 1 lined up, 5 with something to settle.");
    const rows = screen.getAllByTestId("recon-row");
    expect(rows).toHaveLength(5);
    const byName = (n: string) => rows.find((r) => r.textContent?.includes(n))!;
    expect(byName("No Login")).toHaveTextContent("Proposed: Prepare an invite as Employee.");
    expect(byName("Sam Staff")).toHaveTextContent("Follow-ups cannot find them");
    expect(byName("Vee Viewer")).toHaveTextContent("once the owner has decided the mapping");
    expect(within(byName("Vee Viewer")).queryByRole("button", { name: /Set role/ })).toBeNull();
    expect(within(byName("Client Mail")).queryByRole("button")).toBeNull();
    expect(byName("Client Mail")).toHaveTextContent("Check by hand who this login belongs to");
    expect(screen.getByText(/Nothing is sent until a builder presses Send invite by email/)).toBeTruthy();
  });

  it("runs each row action through its checked function, with a confirm for team list and role changes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TeamPage />);
    const rows = await screen.findAllByTestId("recon-row");
    const byName = (n: string) => rows.find((r) => r.textContent?.includes(n))!;
    fireEvent.click(within(byName("No Login")).getByRole("button", { name: "Prepare invite (not sent)" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("prepare_staff_invite", { p_team_member_id: "t-nl" }));
    fireEvent.click(within(byName("Sam Staff")).getByRole("button", { name: "Add to team list" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("add_login_to_team_list", { p_user_id: "u-s1", p_name: "Sam Staff" }));
    fireEvent.click(within(byName("No Role")).getByRole("button", { name: "Set role to Employee" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_staff_role", { p_user_id: "u-n1", p_role: "employee" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it("does nothing when the builder declines the confirm", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<TeamPage />);
    const rows = await screen.findAllByTestId("recon-row");
    fireEvent.click(within(rows.find((r) => r.textContent?.includes("No Role"))!).getByRole("button", { name: "Set role to Employee" }));
    expect(rpc).not.toHaveBeenCalledWith("set_staff_role", expect.anything());
    confirm.mockRestore();
  });

  it("shows a refusal from the database in plain words", async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve(name === "staff_reconciliation" ? { data: RECON, error: null }
        : name === "list_user_invites" ? { data: [], error: null }
        : { data: null, error: { code: "42501", message: "only a builder can prepare invites" } }));
    render(<TeamPage />);
    const rows = await screen.findAllByTestId("recon-row");
    fireEvent.click(within(rows.find((r) => r.textContent?.includes("No Login"))!).getByRole("button", { name: "Prepare invite (not sent)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed: only a builder can prepare invites");
  });

  it("edits a team member through update_team_member", async () => {
    render(<TeamPage />);
    const group = await screen.findByRole("group", { name: "Edit Eli Employee" });
    fireEvent.change(within(group).getByLabelText("Name"), { target: { value: "  Eli E.  " } });
    fireEvent.change(within(group).getByLabelText("Dashboard role"), { target: { value: "admin" } });
    fireEvent.click(within(group).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("update_team_member", { p_team_member_id: "t-e", p_name: "Eli E.", p_dashboard_role: "admin", p_active: true }));
  });

  it("asks before clearing the owner flag on a mapping, and saves only when confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<TeamPage />);
    const group = await screen.findByRole("group", { name: "Change the viewer mapping" });
    fireEvent.click(within(group).getByLabelText("Still waits on the owner"));
    fireEvent.click(within(group).getByRole("button", { name: "Save mapping" }));
    expect(rpc).not.toHaveBeenCalledWith("set_staff_role_mapping", expect.anything());
    fireEvent.click(within(group).getByRole("button", { name: "Save mapping" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("set_staff_role_mapping", {
        p_dashboard_role: "viewer", p_verdanote_role: "employee", p_needs_owner_decision: false, p_note: "Owner decision 2 is open.",
      }));
    confirm.mockRestore();
  });

  it("a prepared invite can be sent by email: it fills the invite form, and nothing is sent until the builder confirms", async () => {
    render(<TeamPage />);
    const invite = await screen.findByTestId("invite-row");
    fireEvent.click(within(invite).getByRole("button", { name: "Send the invite to No Login" }));
    expect(await screen.findByLabelText("Invitee name")).toHaveValue("No Login");
    expect(screen.getByRole("button", { name: "Review invite" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Send invite" })).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith("cancel_staff_invite", expect.anything());
  });

  it("cancels a prepared invite only with a reason", async () => {
    render(<TeamPage />);
    const invite = await screen.findByTestId("invite-row");
    expect(invite).toHaveTextContent("Prepared, not sent");
    const button = within(invite).getByRole("button", { name: "Cancel invite" });
    expect(button).toBeDisabled();
    fireEvent.change(within(invite).getByLabelText("Reason to cancel the invite for No Login"), { target: { value: "Joins later" } });
    fireEvent.click(button);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("cancel_staff_invite", { p_invite_id: "inv-1", p_reason: "Joins later" }));
  });
});

describe("Settings user management", () => {
  it("points staff management at the Team page under the role prefix", () => {
    render(<UserManagementSection users={[]} accounts={[]} onCreateUser={() => {}} onDeleteUser={() => {}} onUpdateRole={() => {}} />);
    const link = within(screen.getByTestId("team-page-pointer")).getByRole("link", { name: "Team and settings" });
    expect(link.getAttribute("href")).toBe("/builder/team");
  });
});

describe("team model", () => {
  it("proposes one change per person and never for a lined-up row", () => {
    expect(proposedChange(row({}))).toBeNull();
    expect(proposedChange(row({ issues: ["no_login"], prepared_invite_id: "i" }))).toBe("Invite prepared as Employee, not sent.");
    expect(proposedChange(row({ issues: ["role_differs"], mapped_role: "builder" }))).toBe("Change the role to Builder.");
    expect(proposedChange(row({ issues: ["inactive_with_staff_role"] }))).toMatch(/Remove the staff role/);
    expect(proposedChange(row({ issues: ["client_login", "no_staff_role"] }))).toMatch(/Check by hand/);
    expect(proposedChange(row({ issues: ["possible_name_match"] }))).toMatch(/same person/);
  });

  it("allows actions only where they are safe", () => {
    expect(canPrepareInvite(row({ issues: ["no_login"], user_id: null }))).toBe(true);
    expect(canPrepareInvite(row({ issues: ["no_login"], user_id: null, prepared_invite_id: "i" }))).toBe(false);
    expect(canAddToTeam(row({ issues: ["not_on_team_list"], team_member_id: null }))).toBe(true);
    expect(canAddToTeam(row({ issues: ["not_on_team_list"], has_client_role: true }))).toBe(false);
    expect(roleActionFor(row({ issues: ["role_differs"], mapped_role: "builder" }))).toBe("builder");
    expect(roleActionFor(row({ issues: ["no_staff_role"], mapping_flagged: true }))).toBeNull();
    expect(roleActionFor(row({ issues: ["no_staff_role"], has_client_role: true }))).toBeNull();
    expect(roleActionFor(row({ issues: ["inactive_with_staff_role"] }))).toBeNull();
  });

  it("sorts people with issues first and counts each issue", () => {
    const sorted = sortPeople([row({ team_name: "Zed" }), row({ team_name: "Amy" }), row({ team_name: "Max", issues: ["no_login"] })]);
    expect(sorted.map((r) => r.team_name)).toEqual(["Max", "Amy", "Zed"]);
    const s = summarize(RECON);
    expect([s.people, s.clean, s.counts.no_staff_role, s.counts.mapping_needs_owner]).toEqual([6, 1, 2, 1]);
  });

  it("checks the forms", () => {
    expect(memberFormProblem({ name: " ", role: "admin", active: true })).toMatch(/name/);
    expect(memberFormProblem({ name: "A", role: "owner", active: true })).toMatch(/admin, producer or viewer/);
    expect(memberFormProblem({ name: "A", role: "viewer", active: false })).toBeNull();
    expect(mappingFormProblem({ verdanoteRole: "client", needsOwnerDecision: false, note: "" })).toMatch(/builder or employee/);
    expect(mappingFormProblem({ verdanoteRole: "employee", needsOwnerDecision: true, note: "x".repeat(501) })).toMatch(/500/);
    expect(cancelReasonProblem("no")).toMatch(/3 characters/);
    expect(cancelReasonProblem("Joins later")).toBeNull();
  });
});
