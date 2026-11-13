// Tests for the OS-017 ClickUp write-back (os-clickup-writeback.ts), with an in-memory Supabase
// and a fake ClickUp. No test reaches the real ClickUp API: every request goes to fakeCu below.
//
// Covered: write-back off -> held and no ClickUp call; list not allowed -> held; the staging guard
// also has to allow the list; status, due date, people field, comment (both threads) and decision
// writes; ClickUp already matching -> no write; clash where ClickUp is later (ClickUp kept, app row
// updated, logged) and where the app is later (written, logged); our own earlier write is not a
// ClickUp change; retry schedule then failed; 429 waits without using an attempt and stops the
// run; 404 fails at once; read-only tasks are skipped; a sent comment is not posted twice; echo
// detection and pending app values for the webhook; the sync skips our own comments.
//
//   deno test -A supabase/functions/_shared/os-clickup-writeback.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeDb } from "./testing/os-sync-fakes.ts";
import { CLICKUP_TEAM_ID, FIELDS } from "./os-task-map.ts";
import { type CommentRow, upsertComments } from "./os-clickup-sync.ts";
import {
  afterFailure,
  dateToMs,
  decideConflict,
  HELD_GUARD,
  HELD_LIST,
  HELD_OFF,
  isEchoOfOwnWrite,
  keepPendingAppValues,
  MAX_ATTEMPTS,
  runWriteback,
} from "./os-clickup-writeback.ts";

const NOW = "2026-11-30T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const BEFORE = (min: number) => new Date(NOW_MS - min * 60_000).toISOString();
const LIST = "901400000001";
const OTHER_LIST = "901400000002";
const STAGING_URL = "https://mnvcksbhbvypuiwozvct.supabase.co";
const PROD_URL = "https://example.supabase.co";

type Row = Record<string, unknown>;

function envOf(values: Record<string, string>) {
  const all: Record<string, string> = { SUPABASE_URL: PROD_URL, CLICKUP_API_TOKEN: "fake-token", ...values };
  return (name: string) => all[name];
}
const ON = { CLICKUP_WRITEBACK_ENABLED: "true", CLICKUP_WRITEBACK_LIST_IDS: LIST };

interface Call {
  method: string;
  path: string;
  body: Row | null;
}

/** A ClickUp stand-in that keeps task state and records every call. */
function fakeCu(tasks: Record<string, Row>, opts: { fail?: Record<string, { status: number; headers?: Record<string, string> }> } = {}) {
  const calls: Call[] = [];
  let clock = NOW_MS + 1000;
  let commentN = 0;
  const members = [
    { user: { id: 11, email: "sam@goodo.test" } },
    { user: { id: 12, email: "ava@goodo.test" } },
  ];
  const fetchFn = (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = url.replace("https://api.clickup.com/api/v2", "").split("?")[0];
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body });
    const fail = opts.fail?.[`${method} ${path}`];
    if (fail) return Promise.resolve(new Response("nope", { status: fail.status, headers: fail.headers }));
    const ok = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200 }));
    if (method === "GET" && path === "/team") return ok({ teams: [{ id: CLICKUP_TEAM_ID, members }] });
    const m = path.match(/^\/task\/([^/]+)(\/comment|\/field\/([^/]+))?$/);
    const task = m ? tasks[decodeURIComponent(m[1])] : undefined;
    if (!m || !task) return Promise.resolve(new Response("not found", { status: 404 }));
    if (method === "GET" && !m[2]) return ok(task);
    if (method === "PUT" && !m[2]) {
      if (body && "status" in body) task.status = { status: body.status };
      if (body && "due_date" in body) task.due_date = body.due_date === null ? null : String(body.due_date);
      task.date_updated = String(clock += 1000);
      return ok(task);
    }
    if (method === "POST" && m[2] === "/comment") {
      task.date_updated = String(clock += 1000);
      return ok({ id: `cu-comment-${++commentN}`, date: clock });
    }
    if (method === "POST" && m[3]) {
      const field = (task.custom_fields as Row[]).find((f) => f.id === m[3]);
      const value = (body?.value ?? {}) as { add?: string[]; rem?: string[] };
      const kept = ((field?.value as Row[]) ?? []).filter((u) => !(value.rem ?? []).includes(String(u.id)));
      const added = members.filter((x) => (value.add ?? []).includes(String(x.user.id))).map((x) => x.user);
      if (field) field.value = [...kept, ...added];
      task.date_updated = String(clock += 1000);
      return ok({});
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  return { fetch: fetchFn, calls, writes: () => calls.filter((c) => c.method !== "GET") };
}

const cuTask = (id: string, over: Row = {}): Row => ({
  id,
  status: { status: "editing" },
  due_date: null,
  date_updated: String(Date.parse(BEFORE(60))),
  list: { id: LIST },
  custom_fields: [
    { id: FIELDS.strategist.id, name: "Strategist", value: [{ id: 12, email: "ava@goodo.test" }] },
    { id: FIELDS.producer.id, name: "Producer", value: [] },
    { id: FIELDS.editor.id, name: "Editor", value: [] },
  ],
  ...over,
});

let nextId = 1;
const outbox = (over: Row): Row => ({
  id: nextId++,
  task_id: "app-t1",
  clickup_task_id: "t1",
  clickup_list_id: LIST,
  kind: "status",
  field: "status",
  payload: { from: "editing", to: "client review" },
  app_changed_at: BEFORE(5),
  state: "queued",
  attempts: 0,
  next_attempt_at: BEFORE(1),
  clickup_ref: null,
  ...over,
});

function setup(rows: Row[], extra: { tasks?: Row[]; outboxSent?: Row[] } = {}) {
  return fakeDb({
    tables: {
      os_clickup_outbox: [...rows, ...(extra.outboxSent ?? [])],
      os_tasks: extra.tasks ?? [
        { id: "app-t1", clickup_task_id: "t1", clickup_list_id: LIST, read_only: false, status: "client review" },
        { id: "app-t2", clickup_task_id: "t2", clickup_list_id: OTHER_LIST, read_only: false, status: "editing" },
      ],
      os_task_statuses: [{ status: "editing" }, { status: "client review" }, { status: "internal review" }],
    },
    users: { "sam@goodo.test": "u-sam", "ava@goodo.test": "u-ava", "nomember@goodo.test": "u-nomember" },
  });
}

const one = (db: ReturnType<typeof setup>, id: unknown) => db.table("os_clickup_outbox").find((r) => r.id === id)!;

// ------------------------------------------------------------------ pure rules

Deno.test("decideConflict covers every case", () => {
  const base = { appChangedMs: 1000, lastOwnWriteMs: null };
  assertEquals(decideConflict({ ...base, from: "a", to: "b", current: "b", clickupChangedMs: 5000 }), { action: "noop" });
  assertEquals(decideConflict({ ...base, from: "a", to: "b", current: "a", clickupChangedMs: 5000 }), { action: "write", clash: false });
  assertEquals(decideConflict({ ...base, from: "a", to: "b", current: "c", clickupChangedMs: 5000 }), { action: "clash" });
  assertEquals(decideConflict({ ...base, from: "a", to: "b", current: "c", clickupChangedMs: 500 }), { action: "write", clash: true });
  assertEquals(decideConflict({ ...base, from: "a", to: "b", current: "c", clickupChangedMs: 5000, lastOwnWriteMs: 5000 }), { action: "write", clash: true });
  assertEquals(decideConflict({ ...base, from: "a", to: "b", current: "c", clickupChangedMs: null }), { action: "write", clash: true });
});

Deno.test("retry schedule is 1, 5, 15 and 60 minutes, then failed", () => {
  const waits = [1, 2, 3, 4].map((n) => {
    const r = afterFailure(n, 0);
    return r.state === "queued" ? Date.parse(r.nextAttemptAt) / 60_000 : -1;
  });
  assertEquals(waits, [1, 5, 15, 60]);
  assertEquals(afterFailure(MAX_ATTEMPTS, 0), { state: "failed" });
  assertEquals(MAX_ATTEMPTS, 5);
});

Deno.test("dates go to ClickUp as noon UTC", () => {
  assertEquals(dateToMs("2026-12-05"), Date.parse("2026-12-05T12:00:00Z"));
  assertEquals(dateToMs(null), null);
});

// ------------------------------------------------------------------ the switches

Deno.test("write-back off (the default): every row is held and ClickUp is never called", async () => {
  const db = setup([outbox({}), outbox({ kind: "comment", field: "comment", payload: { thread: "internal", body: "Hi", author: "Sam" } })]);
  const cu = fakeCu({ t1: cuTask("t1") });
  const counts = await runWriteback(db.supabase, envOf({ CLICKUP_WRITEBACK_LIST_IDS: LIST }), cu.fetch, NOW);
  assertEquals(cu.calls.length, 0);
  assertEquals(counts.held, 2);
  assert(db.table("os_clickup_outbox").every((r) => r.state === "held" && r.last_error === HELD_OFF));
  const state = db.table("os_clickup_writeback_state")[0];
  assertEquals([state.enabled, state.blocked_reason], [false, "off"]);
});

Deno.test("any value other than true keeps it off", async () => {
  const db = setup([outbox({})]);
  const cu = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db.supabase, envOf({ CLICKUP_WRITEBACK_ENABLED: "yes", CLICKUP_WRITEBACK_LIST_IDS: LIST }), cu.fetch, NOW);
  assertEquals(cu.calls.length, 0);
  assertEquals(db.table("os_clickup_outbox")[0].state, "held");
});

Deno.test("write-back on: a task on a list that is not allowed is held, never written", async () => {
  const db = setup([outbox({ task_id: "app-t2", clickup_task_id: "t2", clickup_list_id: OTHER_LIST })]);
  const cu = fakeCu({ t2: cuTask("t2", { list: { id: OTHER_LIST } }) });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.calls.length, 0);
  assertEquals([db.table("os_clickup_outbox")[0].state, db.table("os_clickup_outbox")[0].last_error], ["held", HELD_LIST]);
});

Deno.test("write-back on with an empty allow-list holds everything", async () => {
  const db = setup([outbox({})]);
  const cu = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db.supabase, envOf({ CLICKUP_WRITEBACK_ENABLED: "true" }), cu.fetch, NOW);
  assertEquals(cu.calls.length, 0);
  assertEquals(db.table("os_clickup_outbox")[0].last_error, HELD_LIST);
  assertEquals(db.table("os_clickup_writeback_state")[0].blocked_reason, "no lists allowed");
});

Deno.test("the current list of the task decides, not the list at the time of the change", async () => {
  const db = setup([outbox({ clickup_list_id: LIST })], {
    tasks: [{ id: "app-t1", clickup_task_id: "t1", clickup_list_id: OTHER_LIST, read_only: false }],
  });
  const cu = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.calls.length, 0);
  assertEquals(db.table("os_clickup_outbox")[0].state, "held");
});

Deno.test("staging writes only to the one test list the write guard also allows", async () => {
  const blocked = setup([outbox({})]);
  const cu1 = fakeCu({ t1: cuTask("t1") });
  await runWriteback(blocked.supabase, envOf({ ...ON, SUPABASE_URL: STAGING_URL }), cu1.fetch, NOW);
  assertEquals(cu1.calls.length, 0);
  assertEquals(blocked.table("os_clickup_outbox")[0].last_error, HELD_GUARD);

  const allowed = setup([outbox({}), outbox({ task_id: "app-t2", clickup_task_id: "t2", clickup_list_id: OTHER_LIST })]);
  const cu2 = fakeCu({ t1: cuTask("t1"), t2: cuTask("t2", { list: { id: OTHER_LIST } }) });
  await runWriteback(
    allowed.supabase,
    envOf({ ...ON, SUPABASE_URL: STAGING_URL, CLICKUP_WRITE_ALLOWED_LIST_IDS: `${LIST},${OTHER_LIST}` }),
    cu2.fetch,
    NOW,
  );
  assertEquals(cu2.writes().map((c) => c.path), ["/task/t1"]);
  assertEquals(allowed.table("os_clickup_outbox").map((r) => r.state), ["sent", "held"]);
});

// ------------------------------------------------------------------ each kind

Deno.test("status: PUT with the new status, marked sent with ClickUp's update time", async () => {
  const row = outbox({});
  const db = setup([row]);
  const cu = fakeCu({ t1: cuTask("t1") });
  const counts = await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.writes(), [{ method: "PUT", path: "/task/t1", body: { status: "client review" } }]);
  const r = one(db, row.id);
  assertEquals([r.state, r.attempts, r.sent_at], ["sent", 1, NOW]);
  assert(typeof r.clickup_updated_at === "string");
  assertEquals(counts.sent, 1);
  assertEquals(db.table("os_clickup_writeback_state")[0].enabled, true);
});

Deno.test("status: PUT with ClickUp's exact name of the list status", async () => {
  const row = outbox({ payload: { from: "editing", to: "filming" } });
  const db = setup([row]);
  db.table("os_clickup_list_statuses").push(
    { list_id: LIST, status: "filming", name: "Filming", order_index: 10 },
    { list_id: OTHER_LIST, status: "filming", name: "FILMING", order_index: 10 },
  );
  const cu = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.writes(), [{ method: "PUT", path: "/task/t1", body: { status: "Filming" } }]);
  assertEquals(one(db, row.id).state, "sent");
});

Deno.test("due date: PUT noon UTC, and null clears it", async () => {
  const set = outbox({ kind: "due_date", field: "due_date", payload: { from: null, to: "2026-12-05" } });
  const db = setup([set]);
  const cu = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.writes()[0].body, { due_date: Date.parse("2026-12-05T12:00:00Z"), due_date_time: false });

  const clear = outbox({ kind: "due_date", field: "due_date", payload: { from: "2026-12-05", to: null } });
  const db2 = setup([clear]);
  const cu2 = fakeCu({ t1: cuTask("t1", { due_date: String(Date.parse("2026-12-05T12:00:00Z")) }) });
  await runWriteback(db2.supabase, envOf(ON), cu2.fetch, NOW);
  assertEquals(cu2.writes()[0].body, { due_date: null, due_date_time: false });
  assertEquals(one(db2, clear.id).state, "sent");
});

Deno.test("people: the role's field gets the new ClickUp member and loses the old one", async () => {
  const row = outbox({ kind: "assignees", field: "strategist", payload: { from: "u-ava", to: "u-sam" } });
  const db = setup([row]);
  const cu = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.writes(), [{ method: "POST", path: `/task/t1/field/${FIELDS.strategist.id}`, body: { value: { add: ["11"], rem: ["12"] } } }]);
  assertEquals(one(db, row.id).state, "sent");
});

Deno.test("people: clearing a role removes the person; an unknown member fails without retry", async () => {
  const clear = outbox({ kind: "assignees", field: "strategist", payload: { from: "u-ava", to: null } });
  const db = setup([clear]);
  const cu = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.writes()[0].body, { value: { add: [], rem: ["12"] } });

  const unknown = outbox({ kind: "assignees", field: "producer", payload: { from: null, to: "u-nomember" } });
  const db2 = setup([unknown]);
  const cu2 = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db2.supabase, envOf(ON), cu2.fetch, NOW);
  assertEquals(cu2.writes().length, 0);
  const r = one(db2, unknown.id);
  assertEquals(r.state, "failed");
  assert(String(r.last_error).includes("nomember@goodo.test"));
});

Deno.test("comments: posted once with author and thread, ClickUp id kept", async () => {
  const internal = outbox({ kind: "comment", field: "comment", payload: { thread: "internal", body: "Cut looks good", author: "Sam" } });
  const client = outbox({ kind: "comment", field: "comment", payload: { thread: "client", body: "Can we swap the hook?", author: "Alex" } });
  const db = setup([internal, client]);
  const cu = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  const posts = cu.writes();
  assertEquals(posts.map((c) => c.path), ["/task/t1/comment", "/task/t1/comment"]);
  assertEquals(posts[0].body, { comment_text: "Sam commented in Goodo OS (internal thread):\nCut looks good", notify_all: false });
  assertEquals(posts[1].body?.comment_text, "Alex commented in Goodo OS (client thread, the client sees this in Goodo OS):\nCan we swap the hook?");
  assertEquals([one(db, internal.id).clickup_ref, one(db, client.id).clickup_ref], ["cu-comment-1", "cu-comment-2"]);

  // A row whose comment was already posted (ClickUp id kept) is not posted again.
  const again = setup([outbox({ kind: "comment", field: "comment", payload: { body: "x" }, clickup_ref: "cu-comment-9" })]);
  const cu2 = fakeCu({ t1: cuTask("t1") });
  await runWriteback(again.supabase, envOf(ON), cu2.fetch, NOW);
  assertEquals(cu2.calls.length, 0);
  assertEquals(again.table("os_clickup_outbox")[0].state, "sent");
});

Deno.test("decisions: a comment saying who decided, with the note; no status move", async () => {
  const ok = outbox({ kind: "decision", field: "decision", payload: { decision: "approved", note: null, author: "Alex" } });
  const change = outbox({ kind: "decision", field: "decision", payload: { decision: "changes_requested", note: "Shorter intro", author: "Alex" } });
  const db = setup([ok, change]);
  const cu = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.writes().map((c) => [c.method, c.path, c.body?.comment_text]), [
    ["POST", "/task/t1/comment", "Client decision in Goodo OS: approved by Alex."],
    ["POST", "/task/t1/comment", "Client decision in Goodo OS: changes requested by Alex.\nNote: Shorter intro"],
  ]);
  assertEquals(cu.writes().filter((c) => c.method === "PUT").length, 0);
});

Deno.test("a decision on a task with no app row (no list) is held", async () => {
  const db = setup([outbox({ task_id: null, clickup_list_id: null, kind: "decision", field: "decision", payload: { decision: "approved" } })]);
  const cu = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.calls.length, 0);
  assertEquals(db.table("os_clickup_outbox")[0].state, "held");
});

// ------------------------------------------------------------------ clashes

Deno.test("ClickUp already has the new value: nothing written, marked sent", async () => {
  const db = setup([outbox({})]);
  const cu = fakeCu({ t1: cuTask("t1", { status: { status: "Client Review" } }) });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.writes().length, 0);
  assertEquals(db.table("os_clickup_outbox")[0].state, "sent");
  assertEquals(db.table("os_clickup_clashes").length, 0);
});

Deno.test("clash, ClickUp later: ClickUp's value is kept, the app row takes it, both values logged", async () => {
  const row = outbox({ app_changed_at: BEFORE(5) });
  const db = setup([row]);
  const cu = fakeCu({ t1: cuTask("t1", { status: { status: "internal review" }, date_updated: String(Date.parse(BEFORE(2))) }) });
  const counts = await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.writes().length, 0);
  assertEquals(one(db, row.id).state, "clash");
  assertEquals(counts.clash, 1);
  const c = db.table("os_clickup_clashes")[0];
  assertEquals([c.winner, c.app_value, c.clickup_value, c.field], ["clickup", "client review", "internal review", "status"]);
  assertEquals(c.clickup_changed_at, BEFORE(2));
  assertEquals(db.table("os_tasks").find((t) => t.id === "app-t1")!.status, "internal review");
});

Deno.test("clash, app later: the app value is written and the clash logged", async () => {
  const row = outbox({ kind: "due_date", field: "due_date", payload: { from: "2026-12-01", to: "2026-12-05" }, app_changed_at: BEFORE(2) });
  const db = setup([row]);
  const cu = fakeCu({ t1: cuTask("t1", { due_date: String(Date.parse("2026-12-03T12:00:00Z")), date_updated: String(Date.parse(BEFORE(5))) }) });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.writes().length, 1);
  assertEquals(one(db, row.id).state, "sent");
  const c = db.table("os_clickup_clashes")[0];
  assertEquals([c.winner, c.app_value, c.clickup_value], ["app", "2026-12-05", "2026-12-03"]);
});

Deno.test("clash on a people field, ClickUp later: the app role takes ClickUp's person", async () => {
  const row = outbox({ kind: "assignees", field: "strategist", payload: { from: null, to: "u-sam" }, app_changed_at: BEFORE(5) });
  const db = setup([row]);
  const cu = fakeCu({ t1: cuTask("t1", { date_updated: String(Date.parse(BEFORE(1))) }) });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.writes().length, 0);
  assertEquals(db.table("os_tasks").find((t) => t.id === "app-t1")!.strategist_id, "u-ava");
  assertEquals(db.table("os_clickup_clashes")[0].clickup_value, "ava@goodo.test");
});

Deno.test("our own earlier write is not counted as a ClickUp change", async () => {
  // Someone set the due date in ClickUp ten minutes ago; then the app changed status and the due
  // date. Writing the status bumps ClickUp's date_updated past the app's due date change. That is
  // our own write, so the app's due date (the later change) still wins.
  const status = outbox({ app_changed_at: BEFORE(6) });
  const due = outbox({ kind: "due_date", field: "due_date", payload: { from: "2026-12-01", to: "2026-12-05" }, app_changed_at: BEFORE(5) });
  const db = setup([status, due]);
  const cu = fakeCu({ t1: cuTask("t1", { due_date: String(Date.parse("2026-12-03T12:00:00Z")), date_updated: String(Date.parse(BEFORE(10))) }) });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals([one(db, status.id).state, one(db, due.id).state], ["sent", "sent"]);
  assertEquals(cu.writes().length, 2);
  assertEquals(db.table("os_clickup_clashes").map((c) => c.winner), ["app"]);
});

// ------------------------------------------------------------------ failures

Deno.test("a failed write retries on schedule and shows the error, then fails after five attempts", async () => {
  const row = outbox({});
  const db = setup([row]);
  const cu = fakeCu({ t1: cuTask("t1") }, { fail: { "PUT /task/t1": { status: 500 } } });
  const expected = [1, 5, 15, 60];
  for (let i = 0; i < 4; i++) {
    one(db, row.id).next_attempt_at = BEFORE(1);
    await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
    const r = one(db, row.id);
    assertEquals([r.state, r.attempts], ["queued", i + 1]);
    assertEquals(r.last_error, "ClickUp API error [500] for PUT /task/t1");
    assertEquals((Date.parse(String(r.next_attempt_at)) - NOW_MS) / 60_000, expected[i]);
  }
  one(db, row.id).next_attempt_at = BEFORE(1);
  const counts = await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals([one(db, row.id).state, one(db, row.id).attempts], ["failed", 5]);
  assertEquals(counts.failed, 1);
});

Deno.test("a row not yet due is left alone", async () => {
  const db = setup([outbox({ next_attempt_at: new Date(NOW_MS + 60_000).toISOString() })]);
  const cu = fakeCu({ t1: cuTask("t1") });
  const counts = await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals([counts.due, cu.calls.length], [0, 0]);
});

Deno.test("429: waits for ClickUp's reset time, no attempt used, and the run stops", async () => {
  const reset = Math.floor((NOW_MS + 90_000) / 1000);
  const first = outbox({});
  const second = outbox({ kind: "due_date", field: "due_date", payload: { from: null, to: "2026-12-05" } });
  const db = setup([first, second]);
  const cu = fakeCu({ t1: cuTask("t1") }, { fail: { "GET /task/t1": { status: 429, headers: { "X-RateLimit-Reset": String(reset) } } } });
  const counts = await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.calls.length, 1);
  const r = one(db, first.id);
  assertEquals([r.state, r.attempts, r.next_attempt_at], ["queued", 0, new Date(reset * 1000).toISOString()]);
  assertEquals(one(db, second.id).attempts, 0);
  assertEquals(counts.rateLimited, true);
});

Deno.test("a task gone from ClickUp fails at once", async () => {
  const db = setup([outbox({})]);
  const cu = fakeCu({});
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(db.table("os_clickup_outbox")[0].state, "failed");
  assertEquals(db.table("os_clickup_outbox")[0].last_error, "the task is not in ClickUp any more");
});

Deno.test("no ClickUp token: counted as a failed attempt, no request", async () => {
  const db = setup([outbox({})]);
  const cu = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db.supabase, (n) => envOf(ON)(n === "CLICKUP_API_TOKEN" ? "missing" : n), cu.fetch, NOW);
  assertEquals(cu.calls.length, 0);
  assertEquals(db.table("os_clickup_outbox")[0].last_error, "CLICKUP_API_TOKEN is not set");
});

Deno.test("a read-only task is skipped, never written", async () => {
  const db = setup([outbox({})], { tasks: [{ id: "app-t1", clickup_task_id: "t1", clickup_list_id: LIST, read_only: true }] });
  const cu = fakeCu({ t1: cuTask("t1") });
  await runWriteback(db.supabase, envOf(ON), cu.fetch, NOW);
  assertEquals(cu.calls.length, 0);
  assertEquals(db.table("os_clickup_outbox")[0].state, "skipped");
});

// ------------------------------------------------------------------ echo suppression

Deno.test("echo: an event no newer than our last write is ours; a newer one is not", async () => {
  const own = Date.parse(BEFORE(1));
  const db = setup([], { outboxSent: [outbox({ state: "sent", sent_at: BEFORE(1), clickup_updated_at: new Date(own).toISOString() })] });
  assertEquals(await isEchoOfOwnWrite(db.supabase, "t1", String(own), NOW_MS), true);
  assertEquals(await isEchoOfOwnWrite(db.supabase, "t1", String(own + 5000), NOW_MS), false);
  assertEquals(await isEchoOfOwnWrite(db.supabase, "t2", String(own), NOW_MS), false);
  // Long after the write, an old event is not treated as our echo.
  assertEquals(await isEchoOfOwnWrite(db.supabase, "t1", String(own), NOW_MS + 60 * 60_000), false);
});

Deno.test("echo: a field with a change still waiting keeps the app value", async () => {
  const db = setup([outbox({ field: "status" }), outbox({ kind: "assignees", field: "editor", payload: { to: "u-sam" } })], {
    tasks: [{ id: "app-t1", clickup_task_id: "t1", status: "client review", due_date: "2026-12-01", editor_id: "u-sam", strategist_id: null, producer_id: null }],
  });
  const incoming = { clickup_task_id: "t1", status: "editing", due_date: "2026-12-09", editor_id: null, strategist_id: "u-ava" } as never;
  const out = await keepPendingAppValues(db.supabase, incoming) as unknown as Row;
  assertEquals([out.status, out.editor_id, out.due_date, out.strategist_id], ["client review", "u-sam", "2026-12-09", "u-ava"]);
});

Deno.test("echo: the sync never imports a comment the app wrote to ClickUp", async () => {
  const db = setup([], { outboxSent: [outbox({ kind: "comment", field: "comment", state: "sent", clickup_ref: "cu-comment-1" })] });
  const row = (id: string): CommentRow => ({ task_id: "app-t1", clickup_comment_id: id, thread: "internal", author: {}, body: "x", created_at: null, synced_at: NOW });
  const res = await upsertComments(db.supabase, [row("cu-comment-1"), row("cu-comment-2")]);
  assertEquals(res.failed, false);
  assertEquals(db.table("os_task_comments").map((c) => c.clickup_comment_id), ["cu-comment-2"]);
});
