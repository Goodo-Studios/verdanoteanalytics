// Tests for the integration-health edge function and _shared/integration-health.ts.
//
// No database and no network: the snapshot loader is injected. Covered:
//   * the gate: no login 401, client / no role / service role 403, builder and
//     employee 200; the loader is never called for a refused caller
//   * GET and POST answer, other methods 405, OPTIONS preflight with CORS
//   * secrets are reported as true/false only and never echoed
//   * ClickUp unconfirmed / stale / fresh, Slack notes vs problems, Meta sync
//     stuck / failed / behind accounts, queue overdue / expired / recovery
//   * owner alert text is cut, the list is capped, a loader failure is a 500
//     that does not leak the error text
//   * alerts (step 4d): active exceptions suppress matching problems; the
//     evaluate action is builder only, queues nothing outside production and
//     queues one owner alert per open problem in production
//
//   deno test -A supabase/functions/integration-health/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AlertException,
  ALERT_TEXT_MAX,
  CLICKUP_FRESHNESS_HOURS,
  environmentOf,
  evaluateIntegrationHealth,
  type HealthSnapshot,
  OWNER_ALERT_LIMIT,
  ownerAlertsFor,
} from "../_shared/integration-health.ts";
import type { Caller } from "../_shared/internal-auth.ts";

Deno.env.set("INTEGRATION_HEALTH_NO_SERVE", "1");
const { handler, loadSnapshotFromDatabase } = await import("./index.ts");
type SupabaseLike = Parameters<typeof loadSnapshotFromDatabase>[2] extends ((u: string, k: string) => infer C) | undefined ? C : never;

const NOW = new Date("2026-11-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function snapshot(over: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    environment: "other",
    secrets: { clickup: true, fireflies: true, slack: true },
    clickup: { lastSyncedAt: hoursAgo(1), rows: 12 },
    slack: { sendsEnabled: false, ownerAlertDestinations: 0 },
    adSync: { runningStartedAt: [], lastCompletedAt: hoursAgo(2), failedLast24h: 0, activeAccounts: 2, accountLastSynced: [hoursAgo(3), hoursAgo(5)] },
    queue: { overdueQueued: 0, expiredLeases: 0, recovery: 0, pending: 0 },
    ownerAlerts: [],
    exceptions: [],
    ...over,
  };
}

const user = (roles: string[]): Caller => ({ kind: "user", isStaff: roles.includes("builder") || roles.includes("employee"), userId: "u1", roles });
const service: Caller = { kind: "service", isStaff: true, userId: null };

function run(caller: Caller | Response, opts: { method?: string; snap?: HealthSnapshot; fail?: boolean } = {}) {
  let loads = 0;
  const res = handler(new Request("http://x/integration-health", { method: opts.method ?? "GET" }), {
    resolveCaller: () => Promise.resolve(caller),
    env: () => undefined,
    now: () => NOW,
    loadSnapshot: () => {
      loads++;
      if (opts.fail) return Promise.reject(new Error("relation sync_logs secret detail"));
      return Promise.resolve(opts.snap ?? snapshot());
    },
  });
  return { res, loads: () => loads };
}

const byKey = (o: ReturnType<typeof evaluateIntegrationHealth>, key: string) => o.connectors.find((c) => c.key === key)!;

Deno.test("no login is refused with the resolver's 401 and nothing is read", async () => {
  const r = run(new Response("{}", { status: 401 }));
  assertEquals((await r.res).status, 401);
  assertEquals(r.loads(), 0);
});

for (const [label, caller] of [["client", user(["client"])], ["no role", user([])], ["service role", service]] as const) {
  Deno.test(`${label} is refused with 403 and nothing is read`, async () => {
    const r = run(caller);
    const res = await r.res;
    assertEquals(res.status, 403);
    assertEquals(r.loads(), 0);
  });
}

for (const role of ["builder", "employee"]) {
  Deno.test(`${role} gets the overview`, async () => {
    const r = run(user([role]));
    const res = await r.res;
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
    assertEquals(res.headers.get("Cache-Control"), "private, no-store");
    const body = await res.json();
    assertEquals(body.connectors.map((c: { key: string }) => c.key), ["clickup", "fireflies", "slack", "verdanote_data"]);
    assertEquals(body.checkedAt, NOW.toISOString());
  });
}

Deno.test("POST works like GET; other methods get 405; OPTIONS is the CORS preflight", async () => {
  assertEquals((await run(user(["employee"]), { method: "POST" }).res).status, 200);
  assertEquals((await run(user(["employee"]), { method: "DELETE" }).res).status, 405);
  const pre = await handler(new Request("http://x", { method: "OPTIONS" }));
  assertEquals(pre.status, 200);
  assert(pre.headers.get("Access-Control-Allow-Headers")?.includes("authorization"));
});

Deno.test("a loader failure is a 500 without the error text", async () => {
  const res = await run(user(["builder"]), { fail: true }).res;
  assertEquals(res.status, 500);
  const text = await res.text();
  assert(!text.includes("secret detail"));
});

// A fake Supabase client: records each query's table, columns and filters, and
// answers from canned results keyed by "table|first filter" or by table name.
function fakeClient(answers: Record<string, { data?: unknown; count?: number; error?: { message: string } }>) {
  const seen: Array<{ table: string; select: string; ops: string[] }> = [];
  const from = (table: string) => {
    const q = { table, select: "", ops: [] as string[] };
    seen.push(q);
    const answer = () => answers[`${table}|${q.ops[0] ?? ""}`] ?? answers[table] ?? { data: [], count: 0 };
    const chain: Record<string, (...args: never[]) => unknown> = {
      select(cols: string) {
        q.select = cols;
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({ error: null, ...answer() });
      },
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        return Promise.resolve({ error: null, ...answer() }).then(ok, bad);
      },
    };
    for (const op of ["eq", "in", "lt", "gt", "gte", "not", "order", "limit"]) {
      chain[op] = (...args: unknown[]) => {
        q.ops.push(`${op}:${args.map((a) => JSON.stringify(a)).join(",")}`);
        return chain;
      };
    }
    return chain;
  };
  return { client: { from } as unknown as SupabaseLike, seen };
}

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://mnvcksbhbvypuiwozvct.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-not-real",
  CLICKUP_API_TOKEN: "clickup-token-not-real",
  FIREFLIES_API_KEY: "   ",
};

Deno.test("loadSnapshotFromDatabase reads the tables and reports secrets as true/false only", async () => {
  const { client, seen } = fakeClient({
    pipeline_tasks: { data: [{ synced_at: hoursAgo(2) }], count: 7 },
    outbound_switches: { data: { enabled: true } },
    slack_destinations: { count: 1 },
    'sync_logs|eq:"status","running"': { data: [{ started_at: minutesAgo(40) }] },
    'sync_logs|in:"status",["completed","completed_with_errors"]': { data: [{ completed_at: hoursAgo(1) }] },
    'sync_logs|eq:"status","failed"': { count: 2 },
    ad_accounts: { data: [{ last_synced_at: hoursAgo(1) }, { last_synced_at: null }] },
    'durable_jobs|eq:"state","queued"': { count: 1 },
    'durable_jobs|eq:"state","leased"': { count: 0 },
    'durable_jobs|eq:"state","recovery"': { count: 3 },
    'durable_jobs|in:"state",["queued","leased"]': { count: 4 },
    'durable_jobs|eq:"kind","slack.owner_alert"': {
      data: [{ id: "j1", state: "recovery", created_at: hoursAgo(1), updated_at: hoursAgo(1), payload: { body: "Sync stuck", channel_id: "C1" } }],
    },
    alert_exceptions: { data: [{ id: "x1", connector: "clickup", pattern: "connector.stale", kind: "idle_testing", reason: "Testing", expires_at: hoursAgo(-3) }] },
  });
  let made: string[] = [];
  const snap = await loadSnapshotFromDatabase((n) => ENV[n], NOW, (url: string, key: string) => {
    made = [url, key];
    return client;
  });
  assertEquals(made, [ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY]);
  assertEquals(snap.environment, "other");
  assertEquals(snap.secrets, { clickup: true, fireflies: false, slack: false });
  assertEquals(snap.clickup, { lastSyncedAt: hoursAgo(2), rows: 7 });
  assertEquals(snap.slack, { sendsEnabled: true, ownerAlertDestinations: 1 });
  assertEquals(snap.adSync.runningStartedAt, [minutesAgo(40)]);
  assertEquals(snap.adSync.lastCompletedAt, hoursAgo(1));
  assertEquals(snap.adSync.failedLast24h, 2);
  assertEquals(snap.adSync.accountLastSynced, [hoursAgo(1), null]);
  assertEquals(snap.queue, { overdueQueued: 1, expiredLeases: 0, recovery: 3, pending: 4 });
  assertEquals(snap.ownerAlerts, [{ id: "j1", state: "recovery", createdAt: hoursAgo(1), updatedAt: hoursAgo(1), text: "Sync stuck" }]);
  assertEquals(snap.exceptions, [{ id: "x1", connector: "clickup", pattern: "connector.stale", kind: "idle_testing", reason: "Testing", expiresAt: hoursAgo(-3) }]);
  assert(seen.some((q) => q.table === "alert_exceptions" && q.ops.includes(`gt:"expires_at","${NOW.toISOString()}"`)), "only active exceptions are read");
  assert(seen.every((q) => q.select !== "*"), "no query selects every column");
  // The overview built from it carries no secret value.
  const text = JSON.stringify(evaluateIntegrationHealth(snap, NOW));
  for (const value of Object.values(ENV)) if (value.trim()) assert(!text.includes(value), `leaked ${value}`);
  // Overdue means 15 minutes past due; failed syncs are counted over 24 hours.
  assert(seen.some((q) => q.ops.includes(`lt:"available_at","${minutesAgo(15)}"`)));
  assert(seen.some((q) => q.ops.includes(`gte:"started_at","${hoursAgo(24)}"`)));
});

Deno.test("loadSnapshotFromDatabase fails on a read error and without the service key", async () => {
  const { client } = fakeClient({ sync_logs: { error: { message: "boom" } } });
  let err = "";
  try {
    await loadSnapshotFromDatabase((n) => ENV[n], NOW, () => client);
  } catch (e) {
    err = (e as Error).message;
  }
  assert(err.startsWith("sync_logs"), err);
  err = "";
  try {
    await loadSnapshotFromDatabase((n) => (n === "SUPABASE_URL" ? ENV.SUPABASE_URL : undefined), NOW, () => client);
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(err, "Server misconfigured");
});

Deno.test("ClickUp: no token is not connected, with a note and no problem", () => {
  const c = byKey(evaluateIntegrationHealth(snapshot({ secrets: { clickup: false, fireflies: false, slack: false } }), NOW), "clickup");
  assertEquals(c.state, "not_connected");
  assertEquals(c.patterns, []);
  assertEquals(c.notes, ["clickup.no_token"]);
});

Deno.test("ClickUp: token but no synced row is unconfirmed", () => {
  const c = byKey(evaluateIntegrationHealth(snapshot({ clickup: { lastSyncedAt: null, rows: 0 } }), NOW), "clickup");
  assertEquals(c.state, "needs_attention");
  assertEquals(c.patterns, ["connector.unconfirmed"]);
});

Deno.test("ClickUp: stale only after the freshness window", () => {
  const fresh = byKey(evaluateIntegrationHealth(snapshot({ clickup: { lastSyncedAt: hoursAgo(CLICKUP_FRESHNESS_HOURS - 0.1), rows: 3 } }), NOW), "clickup");
  assertEquals(fresh.state, "healthy");
  const stale = byKey(evaluateIntegrationHealth(snapshot({ clickup: { lastSyncedAt: hoursAgo(CLICKUP_FRESHNESS_HOURS + 0.1), rows: 3 } }), NOW), "clickup");
  assertEquals(stale.patterns, ["connector.stale"]);
  assertEquals(stale.lastConfirmedAt, hoursAgo(CLICKUP_FRESHNESS_HOURS + 0.1));
  assertEquals(stale.details.boardRows, 3);
});

Deno.test("Fireflies: on demand when connected, not connected without a key", () => {
  assertEquals(byKey(evaluateIntegrationHealth(snapshot(), NOW), "fireflies").notes, ["fireflies.on_demand"]);
  const off = byKey(evaluateIntegrationHealth(snapshot({ secrets: { clickup: true, fireflies: false, slack: true } }), NOW), "fireflies");
  assertEquals(off.state, "not_connected");
  assertEquals(off.notes, ["fireflies.no_key"]);
});

Deno.test("Slack outside production: sends off and not production are notes, not problems", () => {
  const s = byKey(evaluateIntegrationHealth(snapshot(), NOW), "slack");
  assertEquals(s.state, "healthy");
  assertEquals(s.notes, ["slack.not_production", "slack.sends_off"]);
});

Deno.test("Slack in production with sends on and no confirmed owner destination needs attention", () => {
  const s = byKey(evaluateIntegrationHealth(snapshot({ environment: "production", slack: { sendsEnabled: true, ownerAlertDestinations: 0 } }), NOW), "slack");
  assertEquals(s.patterns, ["slack.no_owner_destination"]);
  const ok = byKey(evaluateIntegrationHealth(snapshot({ environment: "production", slack: { sendsEnabled: true, ownerAlertDestinations: 1 } }), NOW), "slack");
  assertEquals(ok.state, "healthy");
  assertEquals(ok.notes, []);
});

Deno.test("Meta sync: stuck, failed and behind accounts", () => {
  const d = byKey(evaluateIntegrationHealth(snapshot({
    adSync: {
      runningStartedAt: [minutesAgo(45), minutesAgo(5)],
      lastCompletedAt: hoursAgo(1),
      failedLast24h: 2,
      activeAccounts: 3,
      accountLastSynced: [hoursAgo(1), hoursAgo(72), null],
    },
  }), NOW), "verdanote_data");
  assertEquals(d.connected, true);
  assertEquals(d.patterns, ["sync.stuck:1", "sync.failed:2", "sync.accounts_behind:2"]);
  assertEquals(d.details.runningSyncs, 2);
});

Deno.test("Meta sync: no active accounts is a note", () => {
  const d = byKey(evaluateIntegrationHealth(snapshot({ adSync: { runningStartedAt: [], lastCompletedAt: null, failedLast24h: 0, activeAccounts: 0, accountLastSynced: [] } }), NOW), "verdanote_data");
  assertEquals(d.state, "healthy");
  assertEquals(d.notes, ["sync.no_active_accounts"]);
});

Deno.test("queue: overdue, expired leases and recovery", () => {
  const o = evaluateIntegrationHealth(snapshot({ queue: { overdueQueued: 1, expiredLeases: 2, recovery: 3, pending: 4 } }), NOW);
  assertEquals(o.queue, { state: "needs_attention", patterns: ["queue.overdue:1", "queue.lease_expired:2", "queue.recovery:3"], suppressed: [], pending: 4 });
  assertEquals(evaluateIntegrationHealth(snapshot(), NOW).queue.state, "healthy");
});

Deno.test("owner alerts: text cut and list capped", () => {
  const long = "x".repeat(ALERT_TEXT_MAX + 50);
  const alerts = Array.from({ length: OWNER_ALERT_LIMIT + 3 }, (_, i) => ({ id: `j${i}`, state: "queued", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), text: i === 0 ? long : null }));
  const o = evaluateIntegrationHealth(snapshot({ ownerAlerts: alerts }), NOW);
  assertEquals(o.ownerAlerts.length, OWNER_ALERT_LIMIT);
  assertEquals(o.ownerAlerts[0].text!.length, ALERT_TEXT_MAX);
  assertEquals(o.ownerAlerts[1].text, null);
});

Deno.test("environmentOf knows only the production project", () => {
  assertEquals(environmentOf("https://gwyxaqoaldnaavkjqquv.supabase.co"), "production");
  assertEquals(environmentOf("https://mnvcksbhbvypuiwozvct.supabase.co"), "other");
  assertEquals(environmentOf(undefined), "other");
  assertEquals(environmentOf("not a url"), "other");
});

// ---------------------------------------------------------------- alerts (step 4d)

const exception = (connector: AlertException["connector"], pattern: string): AlertException => ({
  id: `x-${connector}-${pattern}`, connector, pattern, kind: "false_positive", reason: "Known", expiresAt: hoursAgo(-2),
});
const problems = () => snapshot({
  clickup: { lastSyncedAt: hoursAgo(CLICKUP_FRESHNESS_HOURS + 1), rows: 3 },
  adSync: { runningStartedAt: [minutesAgo(45)], lastCompletedAt: hoursAgo(1), failedLast24h: 1, activeAccounts: 1, accountLastSynced: [hoursAgo(1)] },
  queue: { overdueQueued: 0, expiredLeases: 0, recovery: 2, pending: 2 },
});

Deno.test("alerts: an active exception moves a problem to suppressed and out of the state", () => {
  const o = evaluateIntegrationHealth({ ...problems(), exceptions: [exception("clickup", "connector.stale"), exception("verdanote_data", "sync.stuck"), exception("queue", "queue.recovery")] }, NOW);
  const clickup = byKey(o, "clickup");
  assertEquals(clickup.patterns, []);
  assertEquals(clickup.suppressed, ["connector.stale"]);
  assertEquals(clickup.state, "healthy");
  assertEquals(byKey(o, "verdanote_data").patterns, ["sync.failed:1"]);
  assertEquals(byKey(o, "verdanote_data").suppressed, ["sync.stuck:1"]);
  assertEquals(o.queue.state, "healthy");
  assertEquals(o.queue.suppressed, ["queue.recovery:2"]);
  assertEquals(o.exceptions.length, 3);
});

Deno.test("alerts: an exception for another connector suppresses nothing", () => {
  const o = evaluateIntegrationHealth({ ...problems(), exceptions: [exception("slack", "connector.stale")] }, NOW);
  assertEquals(byKey(o, "clickup").patterns, ["connector.stale"]);
});

Deno.test("alerts: ownerAlertsFor plans one alert per open problem per day", () => {
  const planned = ownerAlertsFor(evaluateIntegrationHealth({ ...problems(), exceptions: [exception("verdanote_data", "sync.stuck")] }, NOW), NOW);
  assertEquals(planned.map((a) => a.key), [
    "health:clickup:connector.stale:2026-11-10",
    "health:verdanote_data:sync.failed:2026-11-10",
    "health:queue:queue.recovery:2026-11-10",
  ]);
  assert(planned[0].text.includes("ClickUp needs attention"));
});

function evaluate(caller: Caller, opts: { body?: string; snap?: HealthSnapshot } = {}) {
  const queued: Array<[string, string]> = [];
  const res = handler(new Request("http://x/integration-health", { method: "POST", body: opts.body ?? JSON.stringify({ action: "evaluate" }) }), {
    resolveCaller: () => Promise.resolve(caller),
    env: () => undefined,
    now: () => NOW,
    loadSnapshot: () => Promise.resolve(opts.snap ?? problems()),
    enqueueOwnerAlert: (_env, key, text) => {
      queued.push([key, text]);
      return Promise.resolve(key.includes("queue") ? null : `job-${queued.length}`);
    },
  });
  return { res, queued };
}

Deno.test("alerts: evaluate is builder only", async () => {
  for (const roles of [["employee"], ["client"]]) {
    const r = evaluate(user(roles));
    assertEquals((await r.res).status, 403);
    assertEquals(r.queued.length, 0);
  }
});

Deno.test("alerts: outside production evaluate queues nothing and says why", async () => {
  const r = evaluate(user(["builder"]));
  const res = await r.res;
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.environment, "other");
  assertEquals(body.alerts.length, 4);
  assert(body.alerts.every((a: { enqueued: boolean; reason: string }) => !a.enqueued && a.reason === "not_production"));
  assertEquals(r.queued.length, 0);
});

Deno.test("alerts: in production evaluate queues each open problem and reports a missing owner channel", async () => {
  const r = evaluate(user(["builder"]), { snap: { ...problems(), environment: "production", exceptions: [exception("verdanote_data", "sync.stuck")] } });
  const body = await (await r.res).json();
  assertEquals(r.queued.map(([k]) => k), [
    "health:clickup:connector.stale:2026-11-10",
    "health:verdanote_data:sync.failed:2026-11-10",
    "health:queue:queue.recovery:2026-11-10",
  ]);
  assertEquals(body.alerts.map((a: { enqueued: boolean; reason: string | null }) => [a.enqueued, a.reason]), [[true, null], [true, null], [false, "no_owner_destination"]]);
});

Deno.test("alerts: an empty POST body still reads; a bad body or unknown action is a 400", async () => {
  const ok = evaluate(user(["employee"]), { body: "" });
  const okRes = await ok.res;
  assertEquals(okRes.status, 200);
  assert(Array.isArray((await okRes.json()).connectors));
  assertEquals((await evaluate(user(["employee"]), { body: "{}" }).res).status, 200);
  assertEquals((await evaluate(user(["builder"]), { body: "not json" }).res).status, 400);
  assertEquals((await evaluate(user(["builder"]), { body: JSON.stringify({ action: "send" }) }).res).status, 400);
  assertEquals((await evaluate(user(["builder"]), { body: "[]" }).res).status, 400);
});

Deno.test("alerts: enqueueOwnerAlertInDatabase calls enqueue_owner_alert with the service role", async () => {
  const { enqueueOwnerAlertInDatabase } = await import("./index.ts");
  const calls: unknown[] = [];
  const make = (u: string, k: string) => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push([u, k, name, args]);
      return Promise.resolve({ data: "job-1", error: null });
    },
  });
  const id = await enqueueOwnerAlertInDatabase((n) => ENV[n], "health:queue:queue.recovery:2026-11-10", "text", make);
  assertEquals(id, "job-1");
  assertEquals(calls, [[ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, "enqueue_owner_alert", { p_key: "health:queue:queue.recovery:2026-11-10", p_text: "text" }]]);
  const none = await enqueueOwnerAlertInDatabase((n) => ENV[n], "k", "t", () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }));
  assertEquals(none, null);
});
