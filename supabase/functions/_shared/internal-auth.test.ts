// Regression coverage for the edge-function auth gate.
//
// Root bug: sync/index.ts trusted (a) an UNVERIFIED `atob()` decode of the JWT
// payload — `role === "anon" | "service_role"` — and (b) bare `sb_publishable_` /
// `sb_secret_` string PREFIXES. Since every function is `verify_jwt = false`, the
// gateway validates nothing, so `Authorization: Bearer sb_secret_x` or any unsigned
// JWT claiming service_role bypassed the builder/employee check entirely.
// These tests pin the exact-comparison behavior so the forgeable checks can't return.

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  bearerToken,
  isServiceRoleRequest,
  requireServiceRole,
  requireStaffOrServiceRole,
} from "./internal-auth.ts";

const REAL_KEY = "real-service-role-key-value";

function withKey<T>(fn: () => T): T {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", REAL_KEY);
  try {
    return fn();
  } finally {
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
}

const reqWith = (auth?: string) =>
  new Request("https://example.test/fn", auth ? { headers: { Authorization: auth } } : undefined);

/** Unsigned JWT whose payload base64-decodes to the given claims (the old exploit). */
function forgedJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64(claims)}.signature-not-checked`;
}

Deno.test("bearerToken strips the scheme and tolerates casing/whitespace", () => {
  assertEquals(bearerToken(reqWith("Bearer abc")), "abc");
  assertEquals(bearerToken(reqWith("bearer   abc")), "abc");
  assertEquals(bearerToken(reqWith("abc")), "abc");
  assertEquals(bearerToken(reqWith()), null);
  assertEquals(bearerToken(reqWith("Bearer   ")), null);
});

Deno.test("isServiceRoleRequest accepts ONLY the exact configured key", () => {
  withKey(() => {
    assertEquals(isServiceRoleRequest(reqWith(`Bearer ${REAL_KEY}`)), true);
    assertEquals(isServiceRoleRequest(reqWith(REAL_KEY)), true);
    assertEquals(isServiceRoleRequest(reqWith("Bearer wrong-key")), false);
    assertEquals(isServiceRoleRequest(reqWith()), false);
    // Prefix of the real key must not pass.
    assertEquals(isServiceRoleRequest(reqWith(`Bearer ${REAL_KEY.slice(0, -1)}`)), false);
  });
});

Deno.test("a bare sb_secret_ / sb_publishable_ prefix is REJECTED (the old bypass)", () => {
  withKey(() => {
    assertEquals(isServiceRoleRequest(reqWith("Bearer sb_secret_x")), false);
    assertEquals(isServiceRoleRequest(reqWith("Bearer sb_secret_anything_at_all")), false);
    assertEquals(isServiceRoleRequest(reqWith("Bearer sb_publishable_x")), false);
  });
});

Deno.test("a forged unsigned JWT claiming service_role/anon is REJECTED (the old bypass)", () => {
  withKey(() => {
    assertEquals(isServiceRoleRequest(reqWith(`Bearer ${forgedJwt({ role: "service_role" })}`)), false);
    assertEquals(isServiceRoleRequest(reqWith(`Bearer ${forgedJwt({ role: "anon" })}`)), false);
  });
});

Deno.test("isServiceRoleRequest fails closed when the key env var is unset", () => {
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  assertEquals(isServiceRoleRequest(reqWith("Bearer anything")), false);
  // An empty presented token must not match an empty/absent secret.
  assertEquals(isServiceRoleRequest(reqWith()), false);
});

Deno.test("requireServiceRole returns null when trusted, 401 otherwise", async () => {
  const res = withKey(() => ({
    ok: requireServiceRole(reqWith(`Bearer ${REAL_KEY}`)),
    bad: requireServiceRole(reqWith("Bearer sb_secret_x")),
  }));
  assertEquals(res.ok, null);
  assertEquals(res.bad?.status, 401);
  assertEquals((await res.bad?.json())?.error, "Unauthorized");
});

// --- requireStaffOrServiceRole -------------------------------------------------

function mockSupabase(user: { id: string } | null, roles: string[]) {
  return {
    auth: {
      getUser: (_t: string) =>
        Promise.resolve({ data: { user }, error: user ? null : { message: "bad token" } }),
    },
    from: (_table: string) => ({
      select: (_c: string) => ({
        eq: (_col: string, _val: string) =>
          Promise.resolve({ data: roles.map((role) => ({ role })), error: null }),
      }),
    }),
  };
}

Deno.test("requireStaffOrServiceRole: the real service-role key short-circuits", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", REAL_KEY);
  try {
    // A client that would throw if touched — proves the user lookup is skipped.
    const exploding = { auth: { getUser: () => {
      throw new Error("must not reach the user lookup");
    } } };
    assertEquals(await requireStaffOrServiceRole(reqWith(`Bearer ${REAL_KEY}`), exploding), null);
  } finally {
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("requireStaffOrServiceRole: builder and employee pass, client is 403", async () => {
  assertEquals(
    await requireStaffOrServiceRole(reqWith("Bearer user-jwt"), mockSupabase({ id: "u1" }, ["builder"])),
    null,
  );
  assertEquals(
    await requireStaffOrServiceRole(reqWith("Bearer user-jwt"), mockSupabase({ id: "u1" }, ["employee"])),
    null,
  );
  // Multi-role users resolve tolerantly (a builder who is also a client still passes).
  assertEquals(
    await requireStaffOrServiceRole(reqWith("Bearer user-jwt"), mockSupabase({ id: "u1" }, ["client", "builder"])),
    null,
  );

  const denied = await requireStaffOrServiceRole(
    reqWith("Bearer user-jwt"), mockSupabase({ id: "u1" }, ["client"]),
  );
  assertEquals(denied?.status, 403);
});

Deno.test("requireStaffOrServiceRole: missing or invalid token is 401", async () => {
  const noHeader = await requireStaffOrServiceRole(reqWith(), mockSupabase({ id: "u1" }, ["builder"]));
  assertEquals(noHeader?.status, 401);

  const badToken = await requireStaffOrServiceRole(reqWith("Bearer nope"), mockSupabase(null, []));
  assertEquals(badToken?.status, 401);
});

Deno.test("requireStaffOrServiceRole: forged service_role JWT falls through to user auth", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", REAL_KEY);
  try {
    // The forged token must NOT short-circuit; it is then rejected as a user token.
    const res = await requireStaffOrServiceRole(
      reqWith(`Bearer ${forgedJwt({ role: "service_role" })}`),
      mockSupabase(null, []),
    );
    assertEquals(res?.status, 401);
  } finally {
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});
