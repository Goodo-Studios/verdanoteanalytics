// Tests for the read-only api router (US-004), focused on the GET /angles route.
//
// Covers:
//   * permission gate — a key without "read" scope is 403'd before any DB work.
//   * account_id is required (400) and gated by verifyAccountOwnership (403).
//   * the happy path issues a read-only, account-scoped, ranked select on
//     angle_clusters and echoes { data, total, account_id }.
//   * the limit query param is clamped to 500.
//   * an unknown resource 404s and advertises /angles.
//
// API_NO_SERVE is set before import so the module-level Deno.serve never binds.
// handleApi(req, supabase, ctx) is exercised directly against a recording mock
// client — withApiAuth (key validation + rate limiting) is upstream and not
// re-tested here.
//   deno test -A supabase/functions/api/index.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("API_NO_SERVE", "1");
// Read with `!` at serve-time only; irrelevant because tests inject a mock client.
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const mod = await import("./index.ts");

// ---- Recording mock client -------------------------------------------------

interface Call {
  method: string;
  args: unknown[];
}

/**
 * Chainable Supabase query-builder stand-in. Every modifier records its call
 * (tagged with the table from the preceding .from()) and returns `this`.
 * Awaiting the builder resolves to a small fixed result set so `count` and
 * `data.length` are realized. `.rpc()` answers the role lookup; `.maybeSingle()`
 * answers the user_accounts link check. Only read verbs are modelled — there is
 * no insert/update/delete/upsert, matching the read-only contract under test.
 */
function makeRecorder(opts: { role?: string; linked?: boolean; rows?: unknown[] } = {}) {
  const calls: Call[] = [];
  let currentTable = "";
  const builder: Record<string, unknown> = {};
  const chainMethods = ["select", "eq", "in", "order", "limit", "range", "gte"];
  for (const m of chainMethods) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args: [currentTable, ...args] });
      return builder;
    };
  }
  builder.maybeSingle = () =>
    Promise.resolve({
      data: opts.linked ? { "1": 1 } : null,
      error: null,
    });
  // Awaiting the builder (terminal, no .single/.maybeSingle) yields the
  // configured rows (default: one angle row).
  const rows = opts.rows ?? [{ id: "angle-1" }];
  builder.then = (resolve: (v: unknown) => void) =>
    resolve({ data: rows, error: null, count: rows.length });

  const supabase = {
    from: (table: string, ...rest: unknown[]) => {
      currentTable = table;
      calls.push({ method: "from", args: [table, ...rest] });
      return builder;
    },
    rpc: (fn: string, ...rest: unknown[]) => {
      calls.push({ method: "rpc", args: [fn, ...rest] });
      return Promise.resolve({ data: opts.role ?? "builder", error: null });
    },
  };
  return { supabase, calls };
}

function callsForTable(calls: Call[], table: string): Call[] {
  return calls.filter((c) => c.args[0] === table);
}

function hasCall(calls: Call[], method: string, table: string, arg1: unknown, arg2: unknown): boolean {
  return calls.some(
    (c) => c.method === method && c.args[0] === table && c.args[1] === arg1 && c.args[2] === arg2,
  );
}

function getReq(path: string): Request {
  return new Request(`https://fn.local${path}`, { method: "GET" });
}

const READ = { userId: "user_1", permissions: ["read"] };

// ---- Permission + auth gates -----------------------------------------------

Deno.test("handleApi 403s a key without the read scope before touching the DB", async () => {
  const { supabase, calls } = makeRecorder();
  const res = await mod.handleApi(getReq("/api/angles?account_id=act_1"), supabase, {
    userId: "user_1",
    permissions: ["sync"],
  });
  assertEquals(res.status, 403);
  assertEquals(calls.length, 0);
});

Deno.test("GET /angles requires account_id (400, no DB work)", async () => {
  const { supabase, calls } = makeRecorder();
  const res = await mod.handleApi(getReq("/api/angles"), supabase, READ);
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error, "account_id is required");
  assertEquals(callsForTable(calls, "angle_clusters").length, 0);
});

Deno.test("GET /angles denies an unlinked client (403)", async () => {
  // Non-builder/employee role with no user_accounts link.
  const { supabase, calls } = makeRecorder({ role: "client", linked: false });
  const res = await mod.handleApi(getReq("/api/angles?account_id=act_1"), supabase, READ);
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.error, "Access denied");
  // Ownership was checked; the angle_clusters table was never queried.
  assert(calls.some((c) => c.method === "rpc" && c.args[0] === "get_user_role"));
  assertEquals(callsForTable(calls, "angle_clusters").length, 0);
});

// ---- Happy path: read-only, account-scoped, ranked select ------------------

Deno.test("GET /angles selects angle_clusters scoped to account_id and echoes the shape", async () => {
  const { supabase, calls } = makeRecorder({ role: "builder" });
  const res = await mod.handleApi(getReq("/api/angles?account_id=act_1"), supabase, READ);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.account_id, "act_1");
  assertEquals(json.total, 1);
  assertEquals(json.data, [{ id: "angle-1" }]);

  const tableCalls = callsForTable(calls, "angle_clusters");
  // Read-only: only select/eq/order/limit are issued — never insert/update/delete.
  assert(tableCalls.some((c) => c.method === "select"), "must select angle_clusters");
  assert(hasCall(calls, "eq", "angle_clusters", "account_id", "act_1"), "scoped to account_id");
  assert(tableCalls.some((c) => c.method === "order"), "results are ordered");
  assert(
    tableCalls.every((c) => ["from", "select", "eq", "order", "limit"].includes(c.method)),
    "no mutating verbs on angle_clusters",
  );

  // The selected columns include the VOC fields the brief synthesizer consumes.
  const selectCall = tableCalls.find((c) => c.method === "select");
  const cols = String(selectCall!.args[1]);
  for (const col of ["pains", "desires", "objections", "customer_language", "score"]) {
    assert(cols.includes(col), `select must include ${col}`);
  }
});

Deno.test("GET /angles clamps limit to 500", async () => {
  const { supabase, calls } = makeRecorder({ role: "builder" });
  const res = await mod.handleApi(getReq("/api/angles?account_id=act_1&limit=9999"), supabase, READ);
  assertEquals(res.status, 200);
  const limitCall = callsForTable(calls, "angle_clusters").find((c) => c.method === "limit");
  assertEquals(limitCall!.args[1], 500);
});

Deno.test("GET /angles applies an optional theme filter", async () => {
  const { supabase, calls } = makeRecorder({ role: "builder" });
  const res = await mod.handleApi(getReq("/api/angles?account_id=act_1&theme=value"), supabase, READ);
  assertEquals(res.status, 200);
  assert(hasCall(calls, "eq", "angle_clusters", "theme", "value"), "theme filter applied");
});

// ---- GET /accounts is scoped to the key's user (regression) -----------------
// Previously this route returned EVERY ad_accounts row to any API-key holder.

Deno.test("GET /accounts lets staff (builder) list every account", async () => {
  const { supabase, calls } = makeRecorder({ role: "builder" });
  const res = await mod.handleApi(getReq("/api/accounts"), supabase, READ);
  assertEquals(res.status, 200);
  // Role was resolved, the full table was selected, and no user_accounts
  // scoping was applied.
  assert(calls.some((c) => c.method === "rpc" && c.args[0] === "get_user_role"));
  assert(callsForTable(calls, "ad_accounts").some((c) => c.method === "select"));
  assertEquals(callsForTable(calls, "user_accounts").length, 0);
  assertEquals(callsForTable(calls, "ad_accounts").filter((c) => c.method === "in").length, 0);
});

Deno.test("GET /accounts returns [] for a client with no linked accounts", async () => {
  // Non-staff role; the awaited user_accounts query resolves zero links.
  const { supabase, calls } = makeRecorder({ role: "client", rows: [] });
  const res = await mod.handleApi(getReq("/api/accounts"), supabase, READ);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.data, []);
  // Links were consulted, and the ad_accounts query was never executed with
  // an unscoped await (no .in call, early return).
  assert(callsForTable(calls, "user_accounts").some((c) => c.method === "select"));
  assertEquals(callsForTable(calls, "ad_accounts").filter((c) => c.method === "in").length, 0);
});

Deno.test("GET /accounts scopes a linked client to their user_accounts ids", async () => {
  const { supabase, calls } = makeRecorder({ role: "client", rows: [{ account_id: "act_1" }] });
  const res = await mod.handleApi(getReq("/api/accounts"), supabase, READ);
  assertEquals(res.status, 200);
  // The links lookup is keyed to the API key's user...
  assert(hasCall(calls, "eq", "user_accounts", "user_id", "user_1"), "links keyed to userId");
  // ...and the ad_accounts select is restricted to those ids.
  const inCall = callsForTable(calls, "ad_accounts").find((c) => c.method === "in");
  assert(inCall, "ad_accounts query must be scoped with .in");
  assertEquals(inCall!.args[1], "id");
  assertEquals(inCall!.args[2], ["act_1"]);
});

// ---- POST /sync body validation (regression) --------------------------------

Deno.test("POST /sync 400s on a malformed JSON body", async () => {
  const { supabase } = makeRecorder({ role: "builder" });
  const req = new Request("https://fn.local/api/sync", { method: "POST", body: "{not json" });
  const res = await mod.handleApi(req, supabase, {
    userId: "user_1",
    permissions: ["read", "sync"],
  });
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error, "Invalid JSON body");
});

// ---- Routing ---------------------------------------------------------------

Deno.test("unknown resource 404s and advertises /angles", async () => {
  const { supabase } = makeRecorder({ role: "builder" });
  const res = await mod.handleApi(getReq("/api/nope"), supabase, READ);
  assertEquals(res.status, 404);
  const json = await res.json();
  assert((json.available_endpoints as string[]).includes("/angles"));
});
