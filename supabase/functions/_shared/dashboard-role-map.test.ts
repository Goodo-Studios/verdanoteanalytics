import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { mapDashboardRole, mapDashboardRoleWith } from "./dashboard-role-map.ts";

Deno.test("dashboard admin maps to builder", () => {
  assertEquals(mapDashboardRole("admin"), { ok: true, role: "builder" });
});

Deno.test("dashboard producer maps to employee", () => {
  assertEquals(mapDashboardRole("producer"), { ok: true, role: "employee" });
});

Deno.test("matching ignores case and surrounding spaces", () => {
  assertEquals(mapDashboardRole(" Admin "), { ok: true, role: "builder" });
});

Deno.test("viewer is refused, not mapped to employee", () => {
  const result = mapDashboardRole("viewer");
  assertEquals(result.ok, false);
});

Deno.test("unknown and non-string roles are refused", () => {
  assertEquals(mapDashboardRole("owner").ok, false);
  assertEquals(mapDashboardRole(undefined).ok, false);
  assertEquals(mapDashboardRole(7).ok, false);
});

Deno.test("a dashboard role can never produce the client role", () => {
  for (const r of ["admin", "producer", "viewer", "client", ""]) {
    const m = mapDashboardRole(r);
    if (m.ok) assertEquals(m.role === "builder" || m.role === "employee", true);
  }
});

// Step 5d: the mapping read from public.staff_role_mappings.
const SEEDED = [
  { dashboard_role: "admin", verdanote_role: "builder", needs_owner_decision: false },
  { dashboard_role: "producer", verdanote_role: "employee", needs_owner_decision: false },
  { dashboard_role: "viewer", verdanote_role: "employee", needs_owner_decision: true },
];

Deno.test("table mapping: the seeded rows give the same answers as the constant map", () => {
  for (const r of ["admin", "producer", "viewer", " Admin ", "owner", undefined, 7]) {
    const a = mapDashboardRole(r);
    const b = mapDashboardRoleWith(SEEDED, r);
    assertEquals(b.ok, a.ok, String(r));
    if (a.ok && b.ok) assertEquals(b.role, a.role);
  }
});

Deno.test("table mapping: a flagged row is refused and says it waits on the owner", () => {
  const m = mapDashboardRoleWith(SEEDED, "viewer");
  assertEquals(m.ok, false);
  if (!m.ok) assertEquals(m.error.includes("owner"), true);
});

Deno.test("table mapping: once the owner decides, the row is followed", () => {
  const decided = SEEDED.map((r) => (r.dashboard_role === "viewer" ? { ...r, needs_owner_decision: false } : r));
  assertEquals(mapDashboardRoleWith(decided, "viewer"), { ok: true, role: "employee" });
});

Deno.test("table mapping: a row that would give the client role is refused", () => {
  const bad = [{ dashboard_role: "producer", verdanote_role: "client", needs_owner_decision: false }];
  assertEquals(mapDashboardRoleWith(bad, "producer").ok, false);
});

Deno.test("table mapping: no rows means every role is refused", () => {
  assertEquals(mapDashboardRoleWith([], "admin").ok, false);
  assertEquals(mapDashboardRoleWith(null, "admin").ok, false);
});
