import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { mapDashboardRole } from "./dashboard-role-map.ts";

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
