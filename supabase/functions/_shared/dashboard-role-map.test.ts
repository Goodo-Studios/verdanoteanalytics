import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { mapDashboardRole, mapDashboardRoleWith } from "./dashboard-role-map.ts";

// Owner decision 2 (2026-11-11): staff are employees, clients are the viewer (role `client`).

Deno.test("dashboard admin maps to builder", () => {
  assertEquals(mapDashboardRole("admin"), { ok: true, role: "builder" });
});

Deno.test("dashboard producer maps to employee", () => {
  assertEquals(mapDashboardRole("producer"), { ok: true, role: "employee" });
});

Deno.test("dashboard viewer maps to client", () => {
  assertEquals(mapDashboardRole("viewer"), { ok: true, role: "client" });
});

Deno.test("editor and any other staff role map to employee", () => {
  for (const r of ["editor", "strategist", "owner", "Creator Manager"]) {
    assertEquals(mapDashboardRole(r), { ok: true, role: "employee" }, r);
  }
});

Deno.test("matching ignores case and surrounding spaces", () => {
  assertEquals(mapDashboardRole(" Admin "), { ok: true, role: "builder" });
  assertEquals(mapDashboardRole(" VIEWER"), { ok: true, role: "client" });
});

Deno.test("blank and non-string roles are refused", () => {
  assertEquals(mapDashboardRole("").ok, false);
  assertEquals(mapDashboardRole("   ").ok, false);
  assertEquals(mapDashboardRole(undefined).ok, false);
  assertEquals(mapDashboardRole(7).ok, false);
});

Deno.test("only the three existing role values can come out", () => {
  for (const r of ["admin", "producer", "viewer", "editor", "client", "x"]) {
    const m = mapDashboardRole(r);
    if (m.ok) assertEquals(["builder", "employee", "client"].includes(m.role), true);
  }
});

// The mapping read from public.staff_role_mappings.
const SEEDED = [
  { dashboard_role: "admin", verdanote_role: "builder" },
  { dashboard_role: "producer", verdanote_role: "employee" },
  { dashboard_role: "viewer", verdanote_role: "client" },
];

Deno.test("table mapping: the seeded rows give the same answers as the constant map", () => {
  for (const r of ["admin", "producer", "viewer", " Admin ", "editor", "owner", undefined, 7, ""]) {
    const a = mapDashboardRole(r);
    const b = mapDashboardRoleWith(SEEDED, r);
    assertEquals(b.ok, a.ok, String(r));
    if (a.ok && b.ok) assertEquals(b.role, a.role, String(r));
  }
});

Deno.test("table mapping: nothing waits on the owner, viewer is a client", () => {
  assertEquals(mapDashboardRoleWith(SEEDED, "viewer"), { ok: true, role: "client" });
});

Deno.test("table mapping: a role the table does not list is an employee", () => {
  assertEquals(mapDashboardRoleWith(SEEDED, "editor"), { ok: true, role: "employee" });
});

Deno.test("table mapping: the table is followed when a builder changes it", () => {
  const changed = SEEDED.map((r) => (r.dashboard_role === "admin" ? { ...r, verdanote_role: "employee" } : r));
  assertEquals(mapDashboardRoleWith(changed, "admin"), { ok: true, role: "employee" });
});

Deno.test("table mapping: a row with an unknown role value is refused", () => {
  const bad = [{ dashboard_role: "producer", verdanote_role: "owner" }];
  assertEquals(mapDashboardRoleWith(bad, "producer").ok, false);
});

Deno.test("table mapping: no rows means every role is refused", () => {
  assertEquals(mapDashboardRoleWith([], "admin").ok, false);
  assertEquals(mapDashboardRoleWith(null, "admin").ok, false);
});
