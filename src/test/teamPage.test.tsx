/**
 * Team and settings (consolidation step 5d, old dashboard Settings merged with Verdanote user
 * management).
 *
 * - An employee sees the team list and the role mapping (viewer maps to client), and no reconciliation,
 *   invites or edit controls; the reconciliation is never requested for them.
 * - A builder sees the staff list check with counts, per-person issues and proposed changes, and
 *   the actions allowed for each row (prepare invite, add to team list, set role), each a checked
 *   function call; client login rows get no role button.
 * - The builder edits a team member and the mapping (clearing the owner flag asks first), and
 *   cancels an invite with a reason; nothing is sent.
 * - Settings > Admin points staff management at the Team page.
 * - model rules.
 * The database rules are in supabase/tests/staff_team_reconciliation_test.sql.
 */
import { acceptConfirm, confirmDialogText, declineConfirm } from "./adminConfirm";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: { isBuilder: true, role: "builder" } as Record<string, unknown>,
  preview: { isClientPreview: false, isEmployeePreview: false },
  failTeam: false,
}));
const rpc = vi.fn();
const data: Record<string, unknown[]> = {};
const selects: Record<string, string> = {};

function chain(table: string) {
  const q = {
    order: () => q,
    limit: () => q,
    // The client invites section (OS-021) reads its one email-text row with maybeSingle.
    maybeSingle: () => Promise.resolve({ data: (data[table] ?? [])[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(h.failTeam && table === "app_users" ? { data: null, error: { message: "down" } } : { data: data[table] ?? [], error: null }).then(resolve),
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
  login_name: null, staff_roles: ["employee"], has_client_role: false, client_linked: false, mapped_role: "employee",
  prepared_invite_id: null, possible_match: null, issues: [], ...over,
});

const RECON: ReconRow[] = [
  row({ email: "ok@example.test", team_name: "Ok Person" }),
  row({ email: "nl@example.test", team_member_id: "t-nl", team_name: "No Login", user_id: null, staff_roles: [], issues: ["no_login"] }),
  row({ email: "s1@example.test", team_member_id: null, team_name: null, team_role: null, login_name: "Sam Staff", user_id: "u-s1", mapped_role: null, issues: ["not_on_team_list"] }),
  row({ email: "n1@example.test", team_name: "No Role", user_id: "u-n1", staff_roles: [], issues: ["no_staff_role"] }),
  row({ email: "v1@example.test", team_name: "Vee Viewer", team_role: "viewer", user_id: "u-v1", staff_roles: [], mapped_role: "client", issues: ["no_staff_role"] }),
  row({ email: "v2@example.test", team_name: "Vic Viewer", team_role: "viewer", user_id: "u-v2", staff_roles: [], has_client_role: true, mapped_role: "client", issues: ["no_client_linked"] }),
  row({ email: "cl@example.test", team_name: "Client Mail", user_id: "u-cl", staff_roles: [], has_client_role: true, issues: ["client_login"] }),
];

beforeEach(() => {
  h.auth = { isBuilder: true, role: "builder" };
  h.preview = { isClientPreview: false, isEmployeePreview: false };
  h.failTeam = false;
  // The client invites section (OS-021) needs its email-text row to render without an error.
  data.os_client_invite_template = [{ subject: "Hello", body: "Sign in", approved_at: null }];
  rpc.mockReset();
  rpc.mockImplementation((name: string) => Promise.resolve(name === "staff_reconciliation" ? { data: RECON, error: null } : { data: null, error: null }));
  data.app_users = [
    { id: "t-b", name: "Bea Builder", email: "b@example.test", role: "admin", active: true },
    { id: "t-old", name: "Old Hand", email: "o@example.test", role: "producer", active: false },
    { id: "t-e", name: "Eli Employee", email: "e@example.test", role: "producer", active: true },
  ];
  data.staff_role_mappings = [
    { dashboard_role: "admin", verdanote_role: "builder", note: "In the plan.", updated_at: "2026-11-10T00:00:00Z" },
    { dashboard_role: "producer", verdanote_role: "employee", note: "Default.", updated_at: "2026-11-10T00:00:00Z" },
    { dashboard_role: "viewer", verdanote_role: "client", note: "A viewer is a client.", updated_at: "2026-11-10T00:00:00Z" },
  ];
  data.staff_invites = [
    { id: "inv-1", team_member_id: "t-nl", email: "nl@example.test", name: "No Login", proposed_role: "employee", status: "prepared", prepared_at: "2026-11-10T00:00:00Z", cancelled_at: null, cancel_reason: null },
  ];
  data.staff_admin_events = [{ id: "ev-1", kind: "invite_prepared", subject: "nl@example.test", detail: {}, created_at: "2026-11-10T00:00:00Z" }];
});
afterEach(() => cleanup());

describe("TeamPage", () => {
  it("shows a skeleton while loading, then says the list could not load and can try again", async () => {
    h.failTeam = true;
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    expect(screen.getByRole("status", { name: "Loading the team" })).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The team list could not load.");
    h.failTeam = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect((await screen.findAllByTestId("team-member")).length).toBe(3);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an employee the team list and the mapping only, and never asks for the reconciliation", async () => {
    h.auth = { isBuilder: false, role: "employee" };
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    const members = await screen.findAllByTestId("team-member");
    expect(members.map((m) => m.textContent?.split(" ")[0])).toEqual(["Bea", "Eli", "Old"]);
    expect(members[2]).toHaveTextContent("Deactivated");
    const mappings = screen.getAllByTestId("mapping-row");
    expect(mappings).toHaveLength(3);
    expect(mappings[2]).toHaveTextContent("Viewer");
    expect(mappings[2]).toHaveTextContent("Client");
    expect(screen.queryByText(/waits on the owner/i)).toBeNull();
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
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findAllByTestId("team-member");
    // The only call an employee makes is the checklist counts (open to staff); no builder-only function.
    expect(rpc.mock.calls.map((c) => c[0]).filter((n) => n !== "client_setup_status")).toEqual([]);
  });

  it("shows a builder the staff list check with counts, issues and proposed changes", async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    expect(await screen.findByTestId("recon-summary")).toHaveTextContent("7 people, 1 lined up, 6 with something to settle.");
    const rows = screen.getAllByTestId("recon-row");
    expect(rows).toHaveLength(6);
    const byName = (n: string) => rows.find((r) => r.textContent?.includes(n))!;
    expect(byName("No Login")).toHaveTextContent("Proposed: Prepare an invite as Employee.");
    expect(byName("Sam Staff")).toHaveTextContent("Follow-ups cannot find them");
    expect(byName("Vee Viewer")).toHaveTextContent("Mapped: Client");
    expect(within(byName("Vee Viewer")).getByRole("button", { name: /Set role to Client/ })).toBeTruthy();
    expect(byName("Vee Viewer")).not.toHaveTextContent(/owner/i);
    expect(byName("Vic Viewer")).toHaveTextContent("No client linked yet");
    expect(within(byName("Vic Viewer")).getByTestId("no-client-linked-link").getAttribute("href")).toMatch(/\/clients$/);
    expect(within(byName("Vic Viewer")).queryByRole("button", { name: /Set role/ })).toBeNull();
    expect(within(byName("Client Mail")).queryByRole("button")).toBeNull();
    expect(byName("Client Mail")).toHaveTextContent("Check by hand who this login belongs to");
    expect(screen.getByText(/Nothing is sent until a builder presses Send invite by email/)).toBeTruthy();
  });

  it("runs each row action through its checked function, with a confirm for team list and role changes", async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    const rows = await screen.findAllByTestId("recon-row");
    const byName = (n: string) => rows.find((r) => r.textContent?.includes(n))!;
    fireEvent.click(within(byName("No Login")).getByRole("button", { name: "Prepare invite (not sent)" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("prepare_staff_invite", { p_team_member_id: "t-nl" }));
    fireEvent.click(within(byName("Sam Staff")).getByRole("button", { name: "Add to team list" }));
    expect(rpc).not.toHaveBeenCalledWith("add_login_to_team_list", expect.anything());
    expect(await confirmDialogText()).toContain("Add Sam Staff to the team list?");
    await acceptConfirm();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("add_login_to_team_list", { p_user_id: "u-s1", p_name: "Sam Staff" }));
    fireEvent.click(within(byName("No Role")).getByRole("button", { name: "Set role to Employee" }));
    expect(await confirmDialogText()).toContain("This changes what they can open.");
    await acceptConfirm();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_staff_role", { p_user_id: "u-n1", p_role: "employee" }));
  });

  it("does nothing when the builder declines the confirm", async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    const rows = await screen.findAllByTestId("recon-row");
    fireEvent.click(within(rows.find((r) => r.textContent?.includes("No Role"))!).getByRole("button", { name: "Set role to Employee" }));
    await declineConfirm();
    expect(rpc).not.toHaveBeenCalledWith("set_staff_role", expect.anything());
  });

  it("shows a refusal from the database in plain words", async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve(name === "staff_reconciliation" ? { data: RECON, error: null }
        : name === "list_user_invites" ? { data: [], error: null }
        : { data: null, error: { code: "42501", message: "only a builder can prepare invites" } }));
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    const rows = await screen.findAllByTestId("recon-row");
    fireEvent.click(within(rows.find((r) => r.textContent?.includes("No Login"))!).getByRole("button", { name: "Prepare invite (not sent)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed: only a builder can prepare invites");
  });

  it("edits a team member through update_team_member", async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    const group = await screen.findByRole("group", { name: "Edit Eli Employee" });
    fireEvent.change(within(group).getByLabelText("Name"), { target: { value: "  Eli E.  " } });
    fireEvent.change(within(group).getByLabelText("Dashboard role"), { target: { value: "admin" } });
    fireEvent.click(within(group).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("update_team_member", { p_team_member_id: "t-e", p_name: "Eli E.", p_dashboard_role: "admin", p_active: true }));
  });

  it("saves a mapping change with no owner flag", async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    expect(screen.queryByLabelText("Still waits on the owner")).toBeNull();
    const group = await screen.findByRole("group", { name: "Change the producer mapping" });
    fireEvent.click(within(group).getByRole("button", { name: "Save mapping" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("set_staff_role_mapping", {
        p_dashboard_role: "producer", p_verdanote_role: "employee", p_note: "Default.",
      }));
  });

  it("a prepared invite can be sent by email: it fills the invite form, and nothing is sent until the builder confirms", async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    const invite = await screen.findByTestId("invite-row");
    fireEvent.click(within(invite).getByRole("button", { name: "Send the invite to No Login" }));
    expect(await screen.findByLabelText("Invitee name")).toHaveValue("No Login");
    expect(screen.getByRole("button", { name: "Review invite" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Send invite" })).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith("cancel_staff_invite", expect.anything());
  });

  it("cancels a prepared invite only with a reason", async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
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
    expect(proposedChange(row({ issues: ["no_client_linked"], mapped_role: "client" }))).toMatch(/Setup tab/);
    expect(proposedChange(row({ issues: ["no_login"], mapped_role: "client", user_id: null }))).toMatch(/Setup tab/);
  });

  it("allows actions only where they are safe", () => {
    expect(canPrepareInvite(row({ issues: ["no_login"], user_id: null }))).toBe(true);
    expect(canPrepareInvite(row({ issues: ["no_login"], user_id: null, prepared_invite_id: "i" }))).toBe(false);
    expect(canAddToTeam(row({ issues: ["not_on_team_list"], team_member_id: null }))).toBe(true);
    expect(canAddToTeam(row({ issues: ["not_on_team_list"], has_client_role: true }))).toBe(false);
    expect(roleActionFor(row({ issues: ["role_differs"], mapped_role: "builder" }))).toBe("builder");
    expect(roleActionFor(row({ issues: ["no_staff_role"], mapped_role: "client" }))).toBe("client");
    expect(roleActionFor(row({ issues: ["role_differs"], mapped_role: "client" }))).toBeNull();
    expect(roleActionFor(row({ issues: ["no_client_linked"], mapped_role: "client", has_client_role: true }))).toBeNull();
    expect(canPrepareInvite(row({ issues: ["no_login"], user_id: null, mapped_role: "client" }))).toBe(false);
    expect(roleActionFor(row({ issues: ["no_staff_role"], has_client_role: true }))).toBeNull();
    expect(roleActionFor(row({ issues: ["inactive_with_staff_role"] }))).toBeNull();
  });

  it("sorts people with issues first and counts each issue", () => {
    const sorted = sortPeople([row({ team_name: "Zed" }), row({ team_name: "Amy" }), row({ team_name: "Max", issues: ["no_login"] })]);
    expect(sorted.map((r) => r.team_name)).toEqual(["Max", "Amy", "Zed"]);
    const s = summarize(RECON);
    expect([s.people, s.clean, s.counts.no_staff_role, s.counts.no_client_linked]).toEqual([7, 1, 2, 1]);
  });

  it("checks the forms", () => {
    expect(memberFormProblem({ name: " ", role: "admin", active: true })).toMatch(/name/);
    expect(memberFormProblem({ name: "A", role: "owner", active: true })).toMatch(/admin, producer or viewer/);
    expect(memberFormProblem({ name: "A", role: "viewer", active: false })).toBeNull();
    expect(mappingFormProblem({ dashboardRole: "producer", verdanoteRole: "client", note: "" })).toMatch(/builder or employee/);
    expect(mappingFormProblem({ dashboardRole: "viewer", verdanoteRole: "employee", note: "" })).toMatch(/viewer maps to client/i);
    expect(mappingFormProblem({ dashboardRole: "viewer", verdanoteRole: "client", note: "" })).toBeNull();
    expect(mappingFormProblem({ dashboardRole: "producer", verdanoteRole: "employee", note: "x".repeat(501) })).toMatch(/500/);
    expect(cancelReasonProblem("no")).toMatch(/3 characters/);
    expect(cancelReasonProblem("Joins later")).toBeNull();
  });
});
