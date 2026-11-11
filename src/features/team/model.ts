// Team and settings (consolidation step 5d): pure helpers for the staff page. The data comes
// from migration 20261111040001: the team list (app_users), the role mapping
// (staff_role_mappings), staff_reconciliation() (builder only), prepared invites and the
// audit record. Nothing here talks to the network.

export type DashboardRole = "admin" | "producer" | "viewer";
export type StaffRole = "builder" | "employee";
/** What a dashboard role maps to. Two kinds of people: employees (and builders) and clients (the viewer). */
export type MappedRole = StaffRole | "client";

export const DASHBOARD_ROLES: readonly DashboardRole[] = ["admin", "producer", "viewer"];
export const STAFF_ROLES: readonly StaffRole[] = ["builder", "employee"];

export const TEAM_SELECT = "id, name, email, role, active";
export const MAPPING_SELECT = "dashboard_role, verdanote_role, note, updated_at";
export const INVITE_SELECT = "id, team_member_id, email, name, proposed_role, status, prepared_at, cancelled_at, cancel_reason";
export const EVENT_SELECT = "id, kind, subject, detail, created_at";

export const NO_SEND_NOTE =
  "A prepared invite is a note that someone should be invited. Nothing is sent until a builder presses Send invite by email and confirms.";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: DashboardRole;
  active: boolean;
}

export interface RoleMapping {
  dashboard_role: DashboardRole;
  verdanote_role: MappedRole;
  note: string;
  updated_at: string;
}

export interface StaffInvite {
  id: string;
  team_member_id: string;
  email: string;
  name: string;
  proposed_role: StaffRole;
  status: "prepared" | "cancelled";
  prepared_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export interface StaffEvent {
  id: string;
  kind: string;
  subject: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export type Issue =
  | "no_login"
  | "client_login"
  | "no_staff_role"
  | "role_differs"
  | "no_client_linked"
  | "inactive_with_staff_role"
  | "not_on_team_list"
  | "possible_name_match";

export interface ReconRow {
  email: string;
  team_member_id: string | null;
  team_name: string | null;
  team_role: DashboardRole | null;
  team_active: boolean | null;
  user_id: string | null;
  login_name: string | null;
  staff_roles: string[];
  has_client_role: boolean;
  client_linked: boolean;
  mapped_role: MappedRole | null;
  prepared_invite_id: string | null;
  possible_match: string | null;
  issues: Issue[];
}

export const ISSUE_ORDER: readonly Issue[] = [
  "no_login",
  "client_login",
  "no_staff_role",
  "role_differs",
  "no_client_linked",
  "inactive_with_staff_role",
  "not_on_team_list",
  "possible_name_match",
];

/** What each issue is and what it breaks today, in plain words. */
export const ISSUE_INFO: Record<Issue, { label: string; effect: string }> = {
  no_login: {
    label: "No Verdanote login",
    effect: "Listed in owner dropdowns but cannot sign in to Verdanote.",
  },
  client_login: {
    label: "Login is a client login",
    effect: "The email on the team list belongs to a client login. Check who it is by hand; nothing is changed.",
  },
  no_staff_role: {
    label: "Login has no role",
    effect: "Can sign in but sees no staff page.",
  },
  role_differs: {
    label: "Role differs from the mapping",
    effect: "The Verdanote role is not the one the mapping gives for the dashboard role.",
  },
  no_client_linked: {
    label: "No client linked yet",
    effect: "A viewer is a client login. This one is not linked to a client, so it sees nothing yet. Link it on the client's Setup tab.",
  },
  inactive_with_staff_role: {
    label: "Deactivated but still staff",
    effect: "Off the team list but the login still opens staff pages.",
  },
  not_on_team_list: {
    label: "Not on the team list",
    effect: "Missing from owner dropdowns; Follow-ups cannot find them and shows everyone.",
  },
  possible_name_match: {
    label: "Same name, different email",
    effect: "May be the same person under two emails. Nothing is merged; check by hand.",
  },
};

export const roleLabel = (r: string | null | undefined): string =>
  r ? r.charAt(0).toUpperCase() + r.slice(1) : "None";

/** The proposed change for one person, as text. Proposals are never applied on their own. */
export function proposedChange(row: ReconRow): string | null {
  const issues = new Set(row.issues);
  const mapped = row.mapped_role ? roleLabel(row.mapped_role) : null;
  const isClient = row.mapped_role === "client";
  if (issues.has("client_login")) return "Check by hand who this login belongs to. No change is proposed.";
  if (issues.has("no_login")) {
    if (isClient) return "Make the client login from the client's Setup tab.";
    if (row.prepared_invite_id) return `Invite prepared as ${mapped ?? "staff"}, not sent.`;
    return `Prepare an invite as ${mapped ?? "staff"}.`;
  }
  if (issues.has("no_staff_role")) return `Give the login the ${mapped ?? "mapped"} role.`;
  if (issues.has("role_differs")) {
    if (isClient) return "This viewer's login holds a staff role. Change it by hand if they should be a client.";
    return `Change the role to ${mapped}.`;
  }
  if (issues.has("no_client_linked")) return "Link the login to its client on the client's Setup tab.";
  if (issues.has("inactive_with_staff_role")) return "Remove the staff role, or reactivate them on the team list.";
  if (issues.has("not_on_team_list")) return "Add the login to the team list.";
  if (issues.has("possible_name_match")) return "Check by hand whether these are the same person.";
  return null;
}

/** True when the builder may prepare an invite from this row. */
export function canPrepareInvite(row: ReconRow): boolean {
  return row.issues.includes("no_login") && !!row.team_member_id && !row.prepared_invite_id && row.mapped_role !== "client";
}

/** True when the builder may put this login on the team list. */
export function canAddToTeam(row: ReconRow): boolean {
  return row.issues.includes("not_on_team_list") && !!row.user_id && !row.has_client_role;
}

/**
 * The role a builder may set from this row with one click: a login with no role gets the mapped
 * role (client for a viewer); a staff login with a differing staff role gets the mapped staff
 * role. Never a client login, never a staff login that should become a client.
 */
export function roleActionFor(row: ReconRow): MappedRole | null {
  if (!row.user_id || row.has_client_role || !row.mapped_role) return null;
  if (row.issues.includes("no_staff_role")) return row.mapped_role;
  if (row.issues.includes("role_differs") && row.mapped_role !== "client") return row.mapped_role;
  return null;
}

/** People with issues first, then by name. */
export function sortPeople(rows: ReconRow[]): ReconRow[] {
  const name = (r: ReconRow) => (r.team_name ?? r.login_name ?? r.email).toLowerCase();
  return [...rows].sort((a, b) => {
    const ai = a.issues.length > 0 ? 0 : 1;
    const bi = b.issues.length > 0 ? 0 : 1;
    if (ai !== bi) return ai - bi;
    return name(a).localeCompare(name(b));
  });
}

export interface IssueSummary {
  people: number;
  clean: number;
  counts: Record<Issue, number>;
}

export function summarize(rows: ReconRow[]): IssueSummary {
  const counts = Object.fromEntries(ISSUE_ORDER.map((i) => [i, 0])) as Record<Issue, number>;
  let clean = 0;
  for (const r of rows) {
    if (r.issues.length === 0) clean++;
    for (const i of r.issues) if (i in counts) counts[i]++;
  }
  return { people: rows.length, clean, counts };
}

/** Team list order of the old dashboard: active first, then by name. */
export function sortTeam(members: TeamMember[]): TeamMember[] {
  return [...members].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export interface MemberForm {
  name: string;
  role: string;
  active: boolean;
}

export function memberFormProblem(form: MemberForm): string | null {
  const name = form.name.trim();
  if (!name) return "A name is required.";
  if (name.length > 120) return "The name is longer than 120 characters.";
  if (!DASHBOARD_ROLES.includes(form.role as DashboardRole)) return "Choose admin, producer or viewer.";
  return null;
}

export interface MappingForm {
  dashboardRole: string;
  verdanoteRole: string;
  note: string;
}

export function mappingFormProblem(form: MappingForm): string | null {
  if (form.dashboardRole === "viewer") {
    if (form.verdanoteRole !== "client") return "A viewer maps to client.";
  } else if (!STAFF_ROLES.includes(form.verdanoteRole as StaffRole)) {
    return "A staff role maps to builder or employee.";
  }
  if (form.note.trim().length > 500) return "The note is longer than 500 characters.";
  return null;
}

export function cancelReasonProblem(reason: string): string | null {
  const r = reason.trim();
  if (r.length < 3) return "Give a reason of at least 3 characters.";
  if (r.length > 500) return "The reason is longer than 500 characters.";
  return null;
}

/** Plain text for a database refusal. */
export function errorText(error: { code?: string; message: string } | null | undefined): string {
  if (!error) return "Something went wrong.";
  if (error.code === "42501") return `Not allowed: ${error.message}`;
  return error.message;
}

export const EVENT_LABEL: Record<string, string> = {
  mapping_changed: "Mapping changed",
  invite_prepared: "Invite prepared",
  invite_cancelled: "Invite cancelled",
  team_member_added: "Added to the team list",
  team_member_updated: "Team list entry changed",
  staff_role_set: "Staff role set",
};
