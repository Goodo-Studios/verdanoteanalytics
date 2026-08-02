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
  _resetProbeCache,
  bearerToken,
  isServiceRoleRequest,
  isTrustedInternalRequest,
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
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", REAL_KEY);
  Deno.env.delete("SUPABASE_URL"); // no probe possible → exact match only
  _resetProbeCache();
  try {
    assertEquals(await requireServiceRole(reqWith(`Bearer ${REAL_KEY}`)), null);
    const bad = await requireServiceRole(reqWith("Bearer sb_secret_x"));
    assertEquals(bad?.status, 401);
    assertEquals((await bad?.json())?.error, "Unauthorized");
  } finally {
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

// --- capability probe -----------------------------------------------------------
// pg_cron presents the key from vault.decrypted_secrets, a DIFFERENT store to the
// SUPABASE_SERVICE_ROLE_KEY function env var. If an operator rotates one without
// the other, exact-match alone silently 401s every cron job. The probe verifies the
// presented token by USING it against the service-role-only GoTrue admin API.

const VAULT_KEY = "sb_secret_a_different_but_real_service_key";

/** Stub fetch so the probe resolves without a network. Returns the call log. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function withProbeEnv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", REAL_KEY);
  Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
  _resetProbeCache();
  return fn().finally(() => {
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    Deno.env.delete("SUPABASE_URL");
  });
}

Deno.test("probe accepts a genuine service key that is NOT the env key (vault drift)", async () => {
  await withProbeEnv(async () => {
    const f = stubFetch((_u, init) => {
      const auth = new Headers(init?.headers).get("Authorization");
      // Only the real vault key is honored by the admin API.
      return new Response("{}", { status: auth === `Bearer ${VAULT_KEY}` ? 200 : 401 });
    });
    try {
      assertEquals(await isTrustedInternalRequest(reqWith(`Bearer ${VAULT_KEY}`)), true);
      assertEquals(f.calls.length, 1);
      assertEquals(f.calls[0].startsWith("https://proj.supabase.co/auth/v1/admin/users"), true);
    } finally {
      f.restore();
    }
  });
});

Deno.test("probe REJECTS an anon/publishable key (admin API 401s it)", async () => {
  await withProbeEnv(async () => {
    const f = stubFetch(() => new Response("{}", { status: 401 }));
    try {
      assertEquals(await isTrustedInternalRequest(reqWith("Bearer sb_publishable_abc")), false);
      // A JWT-shaped anon token is probed and rejected too.
      assertEquals(await isTrustedInternalRequest(reqWith(`Bearer ${forgedJwt({ role: "anon" })}`)), false);
    } finally {
      f.restore();
    }
  });
});

Deno.test("the exact env key short-circuits — no network probe is issued", async () => {
  await withProbeEnv(async () => {
    const f = stubFetch(() => new Response("{}", { status: 200 }));
    try {
      assertEquals(await isTrustedInternalRequest(reqWith(`Bearer ${REAL_KEY}`)), true);
      assertEquals(f.calls.length, 0);
    } finally {
      f.restore();
    }
  });
});

Deno.test("junk tokens are not probed at all (no outbound amplification)", async () => {
  await withProbeEnv(async () => {
    const f = stubFetch(() => new Response("{}", { status: 200 }));
    try {
      assertEquals(await isTrustedInternalRequest(reqWith("Bearer not-a-credential")), false);
      assertEquals(await isTrustedInternalRequest(reqWith("Bearer x")), false);
      assertEquals(f.calls.length, 0);
    } finally {
      f.restore();
    }
  });
});

Deno.test("probe results are memoized (one call per distinct token)", async () => {
  await withProbeEnv(async () => {
    const f = stubFetch(() => new Response("{}", { status: 200 }));
    try {
      await isTrustedInternalRequest(reqWith(`Bearer ${VAULT_KEY}`));
      await isTrustedInternalRequest(reqWith(`Bearer ${VAULT_KEY}`));
      await isTrustedInternalRequest(reqWith(`Bearer ${VAULT_KEY}`));
      assertEquals(f.calls.length, 1);
    } finally {
      f.restore();
    }
  });
});

Deno.test("probe fails CLOSED on network error or timeout", async () => {
  await withProbeEnv(async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
    try {
      assertEquals(await isTrustedInternalRequest(reqWith(`Bearer ${VAULT_KEY}`)), false);
    } finally {
      globalThis.fetch = original;
    }
  });
});

Deno.test("probe is skipped when SUPABASE_URL is unset (fails closed)", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", REAL_KEY);
  Deno.env.delete("SUPABASE_URL");
  _resetProbeCache();
  const f = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    assertEquals(await isTrustedInternalRequest(reqWith(`Bearer ${VAULT_KEY}`)), false);
    assertEquals(f.calls.length, 0);
  } finally {
    f.restore();
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
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
