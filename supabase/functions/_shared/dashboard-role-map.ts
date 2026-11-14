// Maps roles from the old goodo-studios-dashboard (`app_users.role`) onto Verdanote's
// `app_role` values (`user_roles.role`).
//
// Owner decision 2 (Matthew, 2026-11-11): there are two kinds of people. Anyone who works at
// Goodo Studios is an employee, and anyone who is a client is the viewer, which Verdanote calls
// `client`.
//
//   admin    -> builder   (manages team and settings)
//   viewer   -> client    (a client login; it is linked to its client on the client Setup tab)
//   anything else that names a staff role (producer, editor and similar) -> employee
//
// No new role value is created. A blank or non-string role is refused.

export type VerdanoteRole = "builder" | "employee" | "client";

export type DashboardRoleMapping =
  | { ok: true; role: VerdanoteRole }
  | { ok: false; error: string };

export const DASHBOARD_ROLE_MAP: Readonly<Record<string, VerdanoteRole>> = {
  admin: "builder",
  producer: "employee",
  viewer: "client",
};

function roleKey(dashboardRole: unknown): string {
  return typeof dashboardRole === "string" ? dashboardRole.trim().toLowerCase() : "";
}

export function mapDashboardRole(dashboardRole: unknown): DashboardRoleMapping {
  const key = roleKey(dashboardRole);
  if (!key) return { ok: false, error: `Unknown dashboard role '${String(dashboardRole)}'.` };
  return { ok: true, role: DASHBOARD_ROLE_MAP[key] ?? "employee" };
}

// The mapping is data (public.staff_role_mappings, shown on the Team page). The table decides
// for the roles it lists; any other staff role is an employee, the same as in the database.
export interface RoleMappingRow {
  dashboard_role: string;
  verdanote_role: string;
}

export function mapDashboardRoleWith(
  rows: readonly RoleMappingRow[] | null | undefined,
  dashboardRole: unknown,
): DashboardRoleMapping {
  const key = roleKey(dashboardRole);
  if (!key || !rows || rows.length === 0) {
    return { ok: false, error: `Unknown dashboard role '${String(dashboardRole)}'.` };
  }
  const row = rows.find((r) => r.dashboard_role === key);
  if (!row) return { ok: true, role: "employee" };
  if (row.verdanote_role !== "builder" && row.verdanote_role !== "employee" && row.verdanote_role !== "client") {
    return { ok: false, error: `The mapping for '${key}' does not give a Verdanote role.` };
  }
  return { ok: true, role: row.verdanote_role };
}
