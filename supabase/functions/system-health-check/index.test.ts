// Tests for system-health-check (internal watchdog, called by cron with the service-role key).
//
// No database and no network: the Supabase client is a fake and fetch is stubbed. Covered:
//   * the gate: the gateway does not authenticate this function, so the handler is the only
//     gate. No header, a signed-in user's token, the anon key, junk, and a forged JWT that only
//     claims role service_role are all 401, and none of them reaches the database
//   * the exact service-role key is accepted
//   * a clean system is "pass"; a stuck sync is "fail"; the result is stored
//   * an edge function that does not answer the spot check is a "fail" finding
//   * a database error inside a check becomes a "fail" finding, not a crash
//   * Slack: nothing is posted when the webhook is not set; a change to fail posts once; a
//     repeated fail does not post again; a Slack outage does not break the check
//
//   deno test -A supabase/functions/system-health-check/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeCreateClient, fakeSupabase, type FakeConfig, withEnv, withFetch } from "../_shared/fake-supabase.ts";
import { _resetProbeCache } from "../_shared/internal-auth.ts";

Deno.env.set("SYSTEM_HEALTH_CHECK_NO_SERVE", "1");
const { handler } = await import("./index.ts");

const KEY = "service-key-for-tests";
const ENV = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_ANON_KEY: "anon-key-for-tests",
  SUPABASE_SERVICE_ROLE_KEY: KEY,
  SLACK_WEBHOOK_URL: undefined as string | undefined,
};

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "");
const jwtWithRole = (role: string) => [b64({ alg: "none" }), b64({ role }), "unsigned"].join(".");

/** Answer the spot check of the core functions and Slack posts; refuse the admin probe. */
function outside(over: { functionStatus?: number; slackFails?: boolean } = {}) {
  return (url: string): Response => {
    if (url.includes("/auth/v1/admin/users")) return new Response("{}", { status: 401 });
    if (url.includes("/functions/v1/")) return new Response(null, { status: over.functionStatus ?? 204 });
    if (url.startsWith("https://hooks.slack.test")) {
      if (over.slackFails) throw new Error("slack is down");
      return new Response("ok", { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
}

async function call(
  opts: {
    auth?: string | null;
    cfg?: FakeConfig;
    slack?: string;
    stub?: ReturnType<typeof outside>;
    prepare?: (db: ReturnType<typeof fakeSupabase>) => void;
  } = {},
) {
  _resetProbeCache();
  const db = fakeSupabase(opts.cfg ?? {});
  opts.prepare?.(db);
  const { createClient, calls: clientCalls } = fakeCreateClient(db);
  const headers: Record<string, string> = {};
  if (opts.auth !== null) headers.authorization = opts.auth ?? `Bearer ${KEY}`;
  const req = new Request("http://x/system-health-check", { method: "POST", headers });
  let res!: Response;
  let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  await withEnv({ ...ENV, SLACK_WEBHOOK_URL: opts.slack }, () =>
    withFetch(opts.stub ?? outside(), async (calls) => {
      res = await handler(req, { createClient });
      fetchCalls = calls;
    }));
  return { res, db, clientCalls, fetchCalls };
}

const slackPosts = (calls: Array<{ url: string }>) => calls.filter((c) => c.url.startsWith("https://hooks.slack.test"));

Deno.test("OPTIONS is the CORS preflight and needs no key", async () => {
  const res = await handler(new Request("http://x", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});

for (
  const [label, auth] of [
    ["no header", null],
    ["a bare scheme", "Bearer"],
    ["the anon key", `Bearer ${ENV.SUPABASE_ANON_KEY}`],
    ["a signed-in user's token", `Bearer ${jwtWithRole("authenticated")}`],
    ["junk", "Bearer not-a-key"],
    ["a prefix of the real key", `Bearer ${KEY.slice(0, -1)}`],
  ] as const
) {
  Deno.test(`${label} is 401 and the database is never touched`, async () => {
    const { res, db, clientCalls, fetchCalls } = await call({ auth });
    assertEquals(res.status, 401);
    assertEquals(clientCalls.length, 0);
    assertEquals(db.ops.length, 0);
    // The shape filter keeps junk from causing even an outside probe.
    assertEquals(fetchCalls.length, 0);
  });
}

Deno.test("a forged JWT that only claims service_role is 401 once the admin probe refuses it", async () => {
  const { res, db, clientCalls, fetchCalls } = await call({ auth: `Bearer ${jwtWithRole("service_role")}` });
  assertEquals(res.status, 401);
  assertEquals(clientCalls.length, 0);
  assertEquals(db.ops.length, 0);
  assertEquals(fetchCalls.length, 1);
  assert(fetchCalls[0].url.includes("/auth/v1/admin/users"));
});

Deno.test("a clean system is pass, stored once, and answers the full report", async () => {
  const { res, db } = await call();
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "pass");
  assertEquals(body.summary.fail, 0);
  assertEquals(body.summary.warn, 0);
  assert(body.findings.some((f: { category: string }) => f.category === "functions"));
  const stored = db.writes().filter((w) => w.table === "health_checks" && w.verb === "insert");
  assertEquals(stored.length, 1);
  assertEquals((stored[0].payload as { status: string }).status, "pass");
});

Deno.test("a sync stuck for more than 30 minutes makes the result fail", async () => {
  const { res } = await call({
    cfg: {
      tables: {
        sync_logs: (op) =>
          op.filters.some(([, c, v]) => c === "status" && v === "running")
            ? [{ id: "s1", account_id: "a1", started_at: "2026-11-10T00:00:00Z", current_phase: "ads" }]
            : [],
      },
    },
  });
  const body = await res.json();
  assertEquals(body.status, "fail");
  assert(body.findings.some((f: { severity: string; category: string }) => f.severity === "fail" && f.category === "sync"));
});

Deno.test("a scheduled account that has not synced for days makes the result fail", async () => {
  const old = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  const { res } = await call({
    cfg: { tables: { ad_accounts: [{ id: "a1", name: "Old", last_synced_at: old, sync_frequency: "daily" }] } },
  });
  const body = await res.json();
  assertEquals(body.status, "fail");
  assert(body.findings.some((f: { category: string; severity: string }) => f.category === "freshness" && f.severity === "fail"));
});

Deno.test("a core function that does not answer the spot check is a fail finding", async () => {
  const { res } = await call({ stub: outside({ functionStatus: 500 }) });
  const body = await res.json();
  assertEquals(body.status, "fail");
  assert(body.findings.some((f: { category: string; severity: string }) => f.category === "functions" && f.severity === "fail"));
});

Deno.test("a database error inside a check becomes a fail finding and the result is still stored", async () => {
  const { res, db } = await call({
    prepare: (db) => {
      const original = db.client.from;
      db.client.from = (table: string) => {
        if (table === "sync_logs") throw new Error("connection refused");
        return original(table);
      };
    },
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "fail");
  assert(body.findings.some((f: { category: string; severity: string }) => f.category === "system" && f.severity === "fail"));
  assertEquals(db.writes().filter((w) => w.table === "health_checks" && w.verb === "insert").length, 1);
});

Deno.test("no SLACK_WEBHOOK_URL: nothing is posted even on a fail", async () => {
  const { fetchCalls } = await call({ stub: outside({ functionStatus: 500 }) });
  assertEquals(slackPosts(fetchCalls).length, 0);
});

Deno.test("a change from pass to fail posts to Slack once", async () => {
  const { fetchCalls } = await call({
    slack: "https://hooks.slack.test/T/B/x",
    stub: outside({ functionStatus: 500 }),
    cfg: { tables: { health_checks: [{ status: "pass" }] } },
  });
  assertEquals(slackPosts(fetchCalls).length, 1);
});

Deno.test("a fail that follows a fail does not post again", async () => {
  const { fetchCalls } = await call({
    slack: "https://hooks.slack.test/T/B/x",
    stub: outside({ functionStatus: 500 }),
    cfg: { tables: { health_checks: [{ status: "fail" }] } },
  });
  assertEquals(slackPosts(fetchCalls).length, 0);
});

Deno.test("a recovery from fail to pass posts to Slack once", async () => {
  const { fetchCalls } = await call({
    slack: "https://hooks.slack.test/T/B/x",
    cfg: { tables: { health_checks: [{ status: "fail" }] } },
  });
  assertEquals(slackPosts(fetchCalls).length, 1);
});

Deno.test("a Slack outage does not break the check", async () => {
  const { res } = await call({
    slack: "https://hooks.slack.test/T/B/x",
    stub: outside({ functionStatus: 500, slackFails: true }),
    cfg: { tables: { health_checks: [{ status: "pass" }] } },
  });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "fail");
});
