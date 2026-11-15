export type AppRole = "builder" | "employee" | "client";

const KNOWN_ROLES: readonly AppRole[] = ["builder", "employee", "client"];

/** Accepts only a role the app knows. Anything else (unknown string, null, a number) becomes null, which lands on NoAccess. */
export function parseAppRole(value: unknown): AppRole | null {
  return typeof value === "string" && (KNOWN_ROLES as readonly string[]).includes(value) ? (value as AppRole) : null;
}
