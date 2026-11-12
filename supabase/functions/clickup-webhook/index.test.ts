// Tests for clickup-webhook (OS-007), with an in-memory Supabase and a recorded ClickUp.
//
// Covered: signature (good, bad, missing header, missing secret, constant-time helper); task
// events upsert the task with its client; comment events store comments; stuck keeps the app
// status; taskDeleted removes the row unless it is read-only; tasks outside the three spaces
// and unknown events are ignored; every handled event is recorded as a webhook run; ClickUp
// only receives GET.
//
//   deno test -A supabase/functions/clickup-webhook/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("CLICKUP_WEBHOOK_NO_SERVE", "1");
Deno.env.set("CLICKUP_API_TOKEN", "fake-clickup-token");
Deno.env.set("CLICKUP_WEBHOOK_SECRET", "test-webhook-secret");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

import { fakeClickUp, fakeDb } from "../_shared/testing/os-sync-fakes.ts";

const mod = await import("./index.ts");

const CLIENT_SPACE = "90146671303";
const OLD = "2026-11-01T00:00:00.000Z";

function seed() {
  return {
    clients: [{ slug: "bearaby", name: "Bearaby", active: true }, { slug: "royo", name: "Royo", active: false }],
    client_ad_accounts: [],
    ad_accounts: [],
    source_mappings: [],
    os_task_statuses: [
      { status: "assigned", position: 10, stage: "Preparing Content" },
      { status: "editing", position: 90, stage: "Editing" },
      { status: "internal review", position: 100, stage: "Editing" },
    ],
    os_tasks: [
      { id: "app-t2", clickup_task_id: "t2", title: "November Asset 2", status: "internal review", client_slug: "bearaby", read_only: false, last_synced_at: OLD },
      { id: "app-r1", clickup_task_id: "r1", title: "September Asset 1", status: "editing", client_slug: "royo", read_only: true, last_synced_at: OLD },
    ],
  };
}

const bearabyTask = (id: string, status: string) => ({
  id,
  name: `November Asset ${id}`,
  status: { status },
  space: { id: CLIENT_SPACE },
  folder: { id: "f-bearaby", name: "Bearaby", hidden: false },
  list: { id: "l-bpv", name: "Bearaby Project View" },
  custom_fields: [],
});

const ROUTES = {
  "/task/t1": bearabyTask("t1", "editing"),
  "/task/t2": bearabyTask("t2", "stuck"),
  "/task/t9": bearabyTask("t9", "stuck"),
  "/list/l-bpv": { statuses: [{ status: "brief creation", orderindex: 0 }] },
  "/task/x1": { ...bearabyTask("x1", "editing"), space: { id: "999" } },
  "/task/t1/comment": { comments: [{ id: "cm1", comment_text: "Ship it", user: { id: 1, username: "Sam", email: "sam@goodo.test" }, date: "1762900000000" }] },
};

async function sign(body: string, secret = "test-webhook-secret") {
  return await mod.hmacHex(secret, body);
}

async function post(payload: unknown, opts: { signature?: string | null; raw?: string } = {}) {
  const db = fakeDb({ tables: seed() });
  const cu = fakeClickUp(ROUTES);
  const body = opts.raw ?? JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sig = opts.signature === undefined ? await sign(body) : opts.signature;
  if (sig !== null) headers["X-Signature"] = sig;
  const res = await mod.handler(new Request("https://fn.local/clickup-webhook", { method: "POST", headers, body }), {
    supabase: db.supabase,
    fetch: cu.fetch,
    background: false,
  });
  const json = await res.json();
  const tasks = new Map(db.table("os_tasks").map((r) => [String(r.clickup_task_id), r]));
  return { res, json, db, cu, tasks };
}

Deno.test("hmac and constant-time compare", async () => {
  assertEquals(await mod.hmacHex("key", "The quick brown fox jumps over the lazy dog"),
    "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  assert(mod.safeEqual("abc", "abc"));
  assert(!mod.safeEqual("abc", "abd"));
  assert(!mod.safeEqual("abc", "abcd"));
  assert(!(await mod.verifySignature(undefined, "x", "y")));
  assert(!(await mod.verifySignature("s", "x", null)));
});

Deno.test("a bad signature is refused before anything is read", async () => {
  const { res, db, cu } = await post({ event: "taskUpdated", task_id: "t1" }, { signature: "deadbeef" });
  assertEquals(res.status, 401);
  assertEquals(cu.calls.length, 0);
  assertEquals(db.log.length, 0);
});

Deno.test("a missing signature is refused", async () => {
  const { res, cu } = await post({ event: "taskUpdated", task_id: "t1" }, { signature: null });
  assertEquals(res.status, 401);
  assertEquals(cu.calls.length, 0);
});

Deno.test("a missing secret refuses every request", async () => {
  Deno.env.delete("CLICKUP_WEBHOOK_SECRET");
  try {
    // Even a signature made with the old secret is refused once the secret is unset.
    const { res, cu } = await post({ event: "taskUpdated", task_id: "t1" });
    assertEquals(res.status, 401);
    assertEquals(cu.calls.length, 0);
  } finally {
    Deno.env.set("CLICKUP_WEBHOOK_SECRET", "test-webhook-secret");
  }
});

Deno.test("an unsigned GET gets 401; a signed GET gets 405", async () => {
  const unsigned = await mod.handler(new Request("https://fn.local/clickup-webhook", { method: "GET" }), { background: false });
  assertEquals(unsigned.status, 401);
  const signed = await mod.handler(
    new Request("https://fn.local/clickup-webhook", { method: "GET", headers: { "X-Signature": await sign("") } }),
    { background: false },
  );
  assertEquals(signed.status, 405);
});

Deno.test("taskUpdated reads the task and upserts it with its client", async () => {
  const { res, json, tasks, cu, db } = await post({ event: "taskUpdated", task_id: "t1", webhook_id: "w" });
  assertEquals(res.status, 200);
  assertEquals(json.outcome, "upserted");
  const t1 = tasks.get("t1")!;
  assertEquals([t1.client_slug, t1.status, t1.is_asset, t1.read_only], ["bearaby", "editing", true, false]);
  assertEquals(cu.calls.filter((c) => c.method !== "GET"), []);
  const runs = db.table("os_sync_runs");
  assertEquals(runs.length, 1);
  assertEquals([runs[0].kind, runs[0].ok], ["webhook", true]);
  assertEquals((runs[0].counts as Record<string, unknown>).event, "taskUpdated");
});

Deno.test("taskCommentPosted stores the comments", async () => {
  const { json, db } = await post({ event: "taskCommentPosted", task_id: "t1" });
  assertEquals(json.outcome, "upserted");
  const comments = db.table("os_task_comments");
  assertEquals(comments.length, 1);
  assertEquals([comments[0].clickup_comment_id, comments[0].body], ["cm1", "Ship it"]);
  assertEquals(comments[0].thread, "internal", "ClickUp comments land in the internal thread");
});

Deno.test("stuck keeps the app status and sets the flag", async () => {
  const { tasks } = await post({ event: "taskStatusUpdated", task_id: "t2" });
  const t2 = tasks.get("t2")!;
  assertEquals([t2.status, t2.raw_status, t2.is_stuck, t2.stuck_reason], ["internal review", "stuck", true, "Stuck in ClickUp"]);
});

Deno.test("a new stuck task takes its list's first status, which is added as Other", async () => {
  const { tasks, db, cu } = await post({ event: "taskCreated", task_id: "t9" });
  assertEquals(tasks.get("t9")!.status, "brief creation");
  assert(cu.calls.some((c) => c.url.endsWith("/list/l-bpv")));
  assertEquals(db.table("os_task_statuses").find((s) => s.status === "brief creation")!.stage, "Other");
});

Deno.test("taskDeleted removes the app row", async () => {
  const { json, tasks, cu } = await post({ event: "taskDeleted", task_id: "t2" });
  assertEquals(json.outcome, "deleted");
  assertEquals(tasks.has("t2"), false);
  assertEquals(cu.calls.length, 0, "a delete needs no ClickUp read");
});

Deno.test("taskDeleted keeps a read-only row", async () => {
  const { json, tasks } = await post({ event: "taskDeleted", task_id: "r1" });
  assertEquals(json.outcome, "kept_read_only");
  assertEquals(tasks.has("r1"), true);
});

Deno.test("a task outside the three spaces is ignored", async () => {
  const { json, tasks } = await post({ event: "taskUpdated", task_id: "x1" });
  assertEquals(json.outcome, "ignored");
  assertEquals(tasks.has("x1"), false);
});

Deno.test("an unknown event is ignored without a ClickUp read or a run row", async () => {
  const { json, cu, db } = await post({ event: "listCreated", list_id: "l1" });
  assertEquals(json.outcome, "ignored");
  assertEquals(cu.calls.length, 0);
  assertEquals(db.table("os_sync_runs").length, 0);
});

Deno.test("a task ClickUp no longer has is reported, not an error", async () => {
  const { json, db } = await post({ event: "taskUpdated", task_id: "missing" });
  assertEquals(json.outcome, "not_found");
  assertEquals(db.table("os_sync_runs")[0].ok, true);
});

Deno.test("a failed write is recorded on the run and still answers 200", async () => {
  const db = fakeDb({ tables: seed(), fail: ["os_tasks:upsert"] });
  const cu = fakeClickUp(ROUTES);
  const body = JSON.stringify({ event: "taskUpdated", task_id: "t1" });
  const res = await mod.handler(
    new Request("https://fn.local/clickup-webhook", { method: "POST", headers: { "X-Signature": await sign(body) }, body }),
    { supabase: db.supabase, fetch: cu.fetch, background: false },
  );
  assertEquals(res.status, 200);
  const runRow = db.table("os_sync_runs")[0];
  assertEquals(runRow.ok, false);
  assert(String(runRow.error).includes("upsert"));
});

Deno.test("the event list matches what the registration script subscribes to", () => {
  assertEquals(mod.WEBHOOK_EVENTS.sort(), [
    "taskAssigneeUpdated", "taskCommentPosted", "taskCommentUpdated", "taskCreated", "taskDeleted",
    "taskDueDateUpdated", "taskMoved", "taskStatusUpdated", "taskUpdated",
  ]);
});
