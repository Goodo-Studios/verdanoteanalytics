// Maps roles from the old goodo-studios-dashboard (`app_users.role`) onto
// Verdanote's `app_role` values (`user_roles.role`).
//
//   admin    -> builder   (manages team and settings)
//   producer -> employee  (works on every staff page)
//   viewer   -> NOT mapped
//
// Verdanote has no read-only staff role, and a new role tier is a decision for
// Matthew (see companies/goodo-studios/projects/goodo-os-consolidation/research/
// role-mapping-and-client-wall.md, section 2). Mapping viewers to employee would
// give them write access they do not have today, so a viewer is refused here
// instead of being mapped silently.

export type VerdanoteStaffRole = "builder" | "employee";

export type DashboardRoleMapping =
  | { ok: true; role: VerdanoteStaffRole }
  | { ok: false; error: string };

export const DASHBOARD_ROLE_MAP: Readonly<Record<string, VerdanoteStaffRole>> = {
  admin: "builder",
  producer: "employee",
};

export function mapDashboardRole(dashboardRole: unknown): DashboardRoleMapping {
  const key = typeof dashboardRole === "string" ? dashboardRole.trim().toLowerCase() : "";
  if (key === "viewer") {
    return {
      ok: false,
      error:
        "The dashboard role 'viewer' has no Verdanote role. Verdanote has no read-only staff role; " +
        "decide how viewers get access before creating the account.",
    };
  }
  const role = DASHBOARD_ROLE_MAP[key];
  if (!role) {
    return { ok: false, error: `Unknown dashboard role '${String(dashboardRole)}'. Expected admin or producer.` };
  }
  return { ok: true, role };
}
