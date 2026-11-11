// Tests for user-management (builder only: list, create, update and delete logins).
//
// No database and no network: the Supabase client is a fake. Covered:
//   * the gate: no header or an unknown token is 401, a client, an employee or a login with no
//     role is 403, and a refused caller causes no read of other users and no write at all
//   * a login holding more than one role, builder among them, is let in
//   * a builder lists users with their role and account ids, and creates, updates and deletes
//   * create needs email, password and role; a dashboard role goes through staff_role_mappings
//     and a row still waiting on the owner is refused
//
//   deno test -A supabase/functions/user-management/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeCreateClient, fakeSupabase, type FakeConfig, withEnv } from "../_shared/fake-supabase.ts";

Deno.env.set("USER_MANAGEMENT_NO_SERVE", "1");
const { handler } = await import("./index.ts");

const ENV = { SUPABASE_URL: "http://localhost", SUPABASE_SERVICE_ROLE_KEY: "service-key-for-tests" };

function rolesFor(callerRoles: string[], all: Array<{ user_id: string; role: string }> = []) {
  return (op: { filters: Array<[string, string, unknown]> }) =>
    op.filters.some(([, col, v]) => col === "user_id" && v === "caller")
      ? callerRoles.map((role) => ({ role }))
      : all;
}

async function call(
  method: string,
  path: string,
  opts: { auth?: string | null; body?: unknown; cfg?: FakeConfig } = {},
) {
  const db = fakeSupabase({ user: { id: "caller" }, ...opts.cfg });
  const { createClient } = fakeCreateClient(db);
  const headers: Record<string, string> = {};
  if (opts.auth !== null) headers.authorization = opts.auth ?? "Bearer token";
  const req = new Request(`http://x/user-management${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let res!: Response;
  await withEnv(ENV, async () => {
    res = await handler(req, { createClient });
  });
  return { res, db };
}

Deno.test("OPTIONS is the CORS preflight and touches nothing", async () => {
  const { res, db } = await call("OPTIONS", "");
  assertEquals(res.status, 200);
  assert(res.headers.get("Access-Control-Allow-Origin"));
  assertEquals(db.ops.length, 0);
});

Deno.test("no authorization header is 401 and nothing is read", async () => {
  const { res, db } = await call("GET", "", { auth: null });
  assertEquals(res.status, 401);
  assertEquals(db.ops.length, 0);
});

Deno.test("a token that does not resolve to a user is 401 and the role table is not read", async () => {
  const { res, db } = await call("GET", "", { cfg: { user: null } });
  assertEquals(res.status, 401);
  assertEquals(db.ops.length, 0);
});

for (const [label, roles] of [["client", ["client"]], ["employee", ["employee"]], ["login with no role", []]] as const) {
  for (const [method, path, body] of [
    ["GET", "", undefined],
    ["POST", "", { email: "a@b.test", password: "pw", role: "builder" }],
    ["PUT", "/victim", { role: "builder" }],
    ["DELETE", "/victim", undefined],
  ] as const) {
    Deno.test(`${label} gets 403 on ${method} ${path || "/"} and nothing is changed`, async () => {
      const { res, db } = await call(method, path, {
        body,
        cfg: { tables: { user_roles: rolesFor([...roles]) } },
      });
      assertEquals(res.status, 403);
      assertEquals((await res.json()).error, "Forbidden: builder only");
      assertEquals(db.untouched(), true);
      // Only the caller's own role row was read: no profiles, no accounts.
      assertEquals(db.ops.map((o) => o.table), ["user_roles"]);
    });
  }
}

Deno.test("a login with several roles, builder among them, is let in", async () => {
  const { res } = await call("GET", "", { cfg: { tables: { user_roles: rolesFor(["employee", "builder"]) } } });
  assertEquals(res.status, 200);
});

Deno.test("GET lists every login with its role and account ids", async () => {
  const { res } = await call("GET", "", {
    cfg: {
      tables: {
        user_roles: rolesFor(["builder"], [{ user_id: "u1", role: "client" }]),
        profiles: [{ user_id: "u1", email: "c@x.test" }, { user_id: "u2", email: "n@x.test" }],
        user_accounts: [{ user_id: "u1", account_id: "act_1" }, { user_id: "u1", account_id: "act_2" }],
      },
    },
  });
  assertEquals(res.status, 200);
  const users = await res.json();
  assertEquals(users.length, 2);
  assertEquals(users[0].role, "client");
  assertEquals(users[0].account_ids, ["act_1", "act_2"]);
  assertEquals(users[1].role, null);
  assertEquals(users[1].account_ids, []);
});

Deno.test("POST without email, password and role is 400 and creates nothing", async () => {
  const { res, db } = await call("POST", "", {
    body: { email: "a@b.test", role: "employee" },
    cfg: { tables: { user_roles: rolesFor(["builder"]) } },
  });
  assertEquals(res.status, 400);
  assertEquals(db.admin.created.length, 0);
  assertEquals(db.writes().length, 0);
});

Deno.test("POST creates the login, sets its role and links its accounts", async () => {
  const { res, db } = await call("POST", "", {
    body: { email: "a@b.test", password: "pw", role: "client", display_name: "A", account_ids: ["act_1"] },
    cfg: { tables: { user_roles: rolesFor(["builder"]) } },
  });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).user_id, "new-user-id");
  assertEquals(db.admin.created.length, 1);
  const writes = db.writes().map((w) => `${w.verb}:${w.table}`);
  assertEquals(writes, ["update:profiles", "insert:user_roles", "insert:user_accounts"]);
  assertEquals(db.writes()[1].payload, { user_id: "new-user-id", role: "client" });
});

Deno.test("POST with a dashboard role uses the mapping table", async () => {
  const { res, db } = await call("POST", "", {
    body: { email: "p@b.test", password: "pw", dashboard_role: "producer" },
    cfg: {
      tables: {
        user_roles: rolesFor(["builder"]),
        staff_role_mappings: [{ dashboard_role: "producer", verdanote_role: "employee" }],
      },
    },
  });
  assertEquals(res.status, 200);
  const roleWrite = db.writes().find((w) => w.table === "user_roles");
  assertEquals(roleWrite?.payload, { user_id: "new-user-id", role: "employee" });
});

Deno.test("POST with the dashboard role viewer creates a client login", async () => {
  const { res, db } = await call("POST", "", {
    body: { email: "v@b.test", password: "[REDACTED]", dashboard_role: "viewer", account_ids: ["act_1"] },
    cfg: {
      tables: {
        user_roles: rolesFor(["builder"]),
        staff_role_mappings: [{ dashboard_role: "viewer", verdanote_role: "client" }],
      },
    },
  });
  assertEquals(res.status, 200);
  const roleWrite = db.writes().find((w) => w.table === "user_roles");
  assertEquals(roleWrite?.payload, { user_id: "new-user-id", role: "client" });
});

Deno.test("POST with another staff role such as editor creates an employee", async () => {
  const { res, db } = await call("POST", "", {
    body: { email: "e@b.test", password: "[REDACTED]", dashboard_role: "editor" },
    cfg: {
      tables: {
        user_roles: rolesFor(["builder"]),
        staff_role_mappings: [
          { dashboard_role: "admin", verdanote_role: "builder" },
          { dashboard_role: "viewer", verdanote_role: "client" },
        ],
      },
    },
  });
  assertEquals(res.status, 200);
  assertEquals(db.writes().find((w) => w.table === "user_roles")?.payload, { user_id: "new-user-id", role: "employee" });
});

Deno.test("POST with an unreadable mapping table fails closed", async () => {
  const { res, db } = await call("POST", "", {
    body: { email: "p@b.test", password: "pw", dashboard_role: "producer" },
    cfg: {
      tables: {
        user_roles: rolesFor(["builder"]),
        staff_role_mappings: { data: null, error: { message: "boom" } },
      },
    },
  });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "The role mapping could not be read.");
  assertEquals(db.admin.created.length, 0);
});

Deno.test("an auth error while creating the login is a 500 and no role is written", async () => {
  const { res, db } = await call("POST", "", {
    body: { email: "a@b.test", password: "pw", role: "employee" },
    cfg: { tables: { user_roles: rolesFor(["builder"]) }, createUserError: { message: "already registered" } },
  });
  assertEquals(res.status, 500);
  assertEquals(db.writes().length, 0);
});

Deno.test("PUT replaces the role and the account links", async () => {
  const { res, db } = await call("PUT", "/victim", {
    body: { role: "employee", account_ids: ["act_9"], display_name: "New" },
    cfg: { tables: { user_roles: rolesFor(["builder"]) } },
  });
  assertEquals(res.status, 200);
  assertEquals(db.writes().map((w) => `${w.verb}:${w.table}`), [
    "update:profiles",
    "delete:user_roles",
    "insert:user_roles",
    "delete:user_accounts",
    "insert:user_accounts",
  ]);
});

Deno.test("DELETE removes the login for a builder", async () => {
  const { res, db } = await call("DELETE", "/victim", { cfg: { tables: { user_roles: rolesFor(["builder"]) } } });
  assertEquals(res.status, 200);
  assertEquals(db.admin.deleted, ["victim"]);
});

Deno.test("an unknown route is 404", async () => {
  const { res } = await call("PATCH", "", { cfg: { tables: { user_roles: rolesFor(["builder"]) } } });
  assertEquals(res.status, 404);
});
