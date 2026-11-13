// Tests for clickup-os-sync (OS-007), with an in-memory Supabase and a recorded ClickUp.
//
// Covered:
//   * Walks the three spaces (folders, their lists, folderless lists), paginates, reads with
//     include_closed, subtasks and not archived, and only ever sends GET to ClickUp.
//   * Client folders resolve to a client; ending-client folders are read-only (resolved among
//     inactive clients too); production and social tasks have no client; an unresolved client
//     folder is skipped, never read, and its rows are kept.
//   * Unknown statuses are added with stage Other after the rest, before the tasks.
//   * Stuck keeps the app status (or the list's first status for a new task).
//   * People map by email to login ids; unmatched emails leave the id empty.
//   * full: comments of asset tasks. nightly: discrepancies recorded before the overwrite, and
//     comments only for tasks ClickUp updated since the last good run.
//   * Rows whose ClickUp task is gone are deleted only after a clean walk; demo seed rows, app
//     rows and rows of skipped folders are kept.
//   * Each run is recorded in os_sync_runs. No token: 503 and no ClickUp call. Only the service
//     role gets in.
//
//   deno test -A supabase/functions/clickup-os-sync/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("CLICKUP_OS_SYNC_NO_SERVE", "1");
Deno.env.set("CLICKUP_API_TOKEN", "fake-clickup-token");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

import { fakeClickUp, fakeDb } from "../_shared/testing/os-sync-fakes.ts";
import { FIELDS } from "../_shared/os-task-map.ts";

const mod = await import("./index.ts");

const CLIENT_SPACE = "90146671303";
const PROD_SPACE = "90147169333";
const SOCIAL_SPACE = "90149054875";
const NOW = Date.parse("2026-11-12T08:00:00Z");
const OLD = "2026-11-01T00:00:00.000Z";
const ms = (iso: string) => String(Date.parse(iso));

const KNOWN_STATUSES = [
  "assigned", "brief creation", "client brief review", "editing", "internal review", "client review", "complete",
].map((status, i) => ({ status, position: (i + 1) * 10, stage: "Editing" }));

function seed() {
  return {
    clients: [
      { slug: "bearaby", name: "Bearaby", active: true },
      { slug: "royo", name: "Royo", active: false },
    ],
    client_ad_accounts: [],
    ad_accounts: [],
    source_mappings: [],
    os_task_statuses: KNOWN_STATUSES,
    os_sync_runs: [{ id: "run-prev", kind: "nightly", ok: true, started_at: "2026-11-11T08:00:00.000Z" }],
    os_tasks: [
      { id: "app-t2", clickup_task_id: "t2", title: "November Asset 2", status: "internal review", client_slug: "bearaby", clickup_list_id: "l-bpv", last_synced_at: OLD, read_only: false },
      { id: "app-t1", clickup_task_id: "t1", title: "November Asset 1", status: "complete", client_slug: "bearaby", clickup_list_id: "l-bpv", last_synced_at: OLD, read_only: false, raw_status: "editing" },
      { id: "app-gone", clickup_task_id: "gone-1", title: "Deleted in ClickUp", status: "editing", client_slug: "bearaby", clickup_list_id: "l-bpv", last_synced_at: OLD, read_only: false },
      { id: "app-demo", clickup_task_id: "demo-seed-1", title: "Demo", status: "editing", client_slug: "bearaby", clickup_list_id: "l-bpv", last_synced_at: OLD, read_only: false },
      { id: "app-mystery", clickup_task_id: "m1", title: "Mystery task", status: "editing", client_slug: null, clickup_list_id: "l-mpv", last_synced_at: OLD, read_only: false },
      { id: "app-native", clickup_task_id: null, title: "Made in the app", status: "assigned", client_slug: "bearaby", last_synced_at: null, read_only: false },
    ],
  };
}

const user = (id: number, email: string) => ({ id, username: email.split("@")[0], email });

function routes(overrides: Record<string, unknown> = {}) {
  return {
    [`/space/${CLIENT_SPACE}/folder`]: {
      folders: [
        {
          id: "f-bearaby",
          name: "Bearaby",
          lists: [
            { id: "l-bpv", name: "Bearaby Project View", statuses: [{ status: "brief creation", orderindex: 0 }, { status: "stuck", orderindex: 5 }] },
            { id: "l-bcalls", name: "Meeting Calls" },
          ],
        },
        { id: "901411490908", name: "Royo - Ending October", lists: [{ id: "l-rpv", name: "Royo Project View" }] },
        { id: "f-mystery", name: "Mystery Co", lists: [{ id: "l-mpv", name: "Mystery Co Project View" }] },
      ],
    },
    [`/space/${CLIENT_SPACE}/list`]: { lists: [] },
    [`/space/${PROD_SPACE}/folder`]: { folders: [{ id: "f-ugc", name: "UGC Creators", lists: [{ id: "901419234642", name: "Creator Management" }] }] },
    [`/space/${PROD_SPACE}/list`]: { lists: [] },
    [`/space/${SOCIAL_SPACE}/folder`]: { folders: [] },
    [`/space/${SOCIAL_SPACE}/list`]: { lists: [{ id: "901422029399", name: "Social Media Calendar" }, { id: "901422314788", name: "Goodo Media day" }] },
    "/list/l-bpv/task": (path: string) =>
      path.includes("page=0")
        ? {
          last_page: false,
          tasks: [
            {
              id: "t1",
              name: "November Asset 1",
              status: { status: "editing" },
              date_updated: ms("2026-11-11T12:00:00Z"),
              custom_fields: [
                { id: FIELDS.strategist.id, name: "Strategist", value: [user(1, "sam@goodo.test")] },
                { id: FIELDS.editor.id, name: "Editor", value: [user(2, "freelancer@elsewhere.test")] },
              ],
            },
            { id: "t2", name: "November Asset 2", status: { status: "stuck" }, date_updated: ms("2026-11-01T12:00:00Z") },
          ],
        }
        : { last_page: true, tasks: [{ id: "t3", name: "November Asset 3", status: { status: "stuck" }, date_updated: ms("2026-11-01T12:00:00Z") }] },
    "/list/l-bcalls/task": { last_page: true, tasks: [{ id: "t4", name: "Kickoff call", status: { status: "complete" } }] },
    "/list/l-rpv/task": { last_page: true, tasks: [{ id: "t5", name: "September Asset 2", status: { status: "complete" } }] },
    "/list/901419234642/task": { last_page: true, tasks: [{ id: "c1", name: "Creator Jane", status: { status: "Active Creator" } }] },
    "/list/901422029399/task": {
      last_page: true,
      tasks: [
        { id: "s1", name: "Post 1", status: { status: "scheduled" } },
        { id: "s2", name: "Post 1 caption", status: { status: "scheduled" }, parent: "s1" },
      ],
    },
    "/list/901422314788/task": { last_page: true, tasks: [] },
    "/task/t1/comment": { comments: [{ id: "cm1", comment_text: "Looks good", user: user(1, "Sam@goodo.test"), date: ms("2026-11-11T13:00:00Z") }] },
    "/task/t2/comment": { comments: [] },
    "/task/t3/comment": { comments: [] },
    "/task/t5/comment": { comments: [{ id: "cm5", comment_text: "Final", user: user(3, "x@goodo.test"), date: ms("2026-09-01T13:00:00Z") }] },
    ...overrides,
  };
}

async function run(mode: "full" | "nightly", opts: { overrides?: Record<string, unknown>; failing?: Record<string, number>; fail?: string[] } = {}) {
  const db = fakeDb({ tables: seed(), users: { "sam@goodo.test": "u-sam" }, fail: opts.fail });
  const cu = fakeClickUp(routes(opts.overrides), opts.failing);
  const res = await mod.handler(
    new Request("https://fn.local/clickup-os-sync", { method: "POST", body: JSON.stringify({ mode }) }),
    { supabase: db.supabase, fetch: cu.fetch, now: () => NOW },
  );
  const body = await res.json();
  const tasks = new Map(db.table("os_tasks").map((r) => [String(r.clickup_task_id), r]));
  return { res, body, db, cu, tasks };
}

Deno.test("full: walks the three spaces with GET only and paginates", async () => {
  const { res, body, cu } = await run("full");
  assertEquals(res.status, 200);
  assertEquals(body.success, true);
  assertEquals(cu.calls.filter((c) => c.method !== "GET"), []);
  const urls = cu.calls.map((c) => c.url);
  for (const space of [CLIENT_SPACE, PROD_SPACE, SOCIAL_SPACE]) {
    assert(urls.some((u) => u.includes(`/space/${space}/folder?archived=false`)), `folders of ${space}`);
    assert(urls.some((u) => u.includes(`/space/${space}/list?archived=false`)), `folderless lists of ${space}`);
  }
  const bpv = urls.filter((u) => u.includes("/list/l-bpv/task"));
  assertEquals(bpv.length, 2, "two pages");
  assert(bpv.every((u) => u.includes("include_closed=true") && u.includes("subtasks=true") && u.includes("archived=false")));
  assertEquals(urls.filter((u) => u.includes("l-mpv")), [], "a skipped folder is never read");
  assertEquals(body.seen, 8);
  assertEquals(body.skippedFolders, [{ name: "Mystery Co", reason: "unmatched" }]);
});

Deno.test("full: clients, internal tasks, read-only history, is_asset, subtasks", async () => {
  const { tasks } = await run("full");
  assertEquals(tasks.get("t1")!.client_slug, "bearaby");
  assertEquals(tasks.get("t1")!.is_asset, true);
  assertEquals(tasks.get("t4")!.client_slug, "bearaby");
  assertEquals(tasks.get("t4")!.is_asset, false, "meeting calls are not assets");
  assertEquals(tasks.get("t5")!.client_slug, "royo", "an ending client resolves even when inactive");
  assertEquals(tasks.get("t5")!.read_only, true);
  assertEquals(tasks.get("t1")!.read_only, false);
  assertEquals(tasks.get("c1")!.client_slug, null);
  assertEquals(tasks.get("s1")!.client_slug, null);
  assertEquals(tasks.get("s2")!.clickup_parent_id, "s1");
  assertEquals(tasks.get("c1")!.clickup_space_id, PROD_SPACE);
});

Deno.test("full: unknown statuses are added as Other after the rest, before the task upsert", async () => {
  const { db, body } = await run("full");
  const added = db.table("os_task_statuses").filter((s) => s.stage === "Other");
  assertEquals(added.map((s) => s.status).sort(), ["active creator", "scheduled"]);
  assert(added.every((s) => Number(s.position) > 70));
  assertEquals(body.statusesAdded, ["active creator", "scheduled"]);
  const order = db.log.map((l) => `${l.table}:${l.op}`);
  assert(order.indexOf("os_task_statuses:upsert") < order.indexOf("os_tasks:upsert"));
});

Deno.test("every walked list's ClickUp statuses are stored, replacing the old ones, before the tasks", async () => {
  const folders = routes()[`/space/${CLIENT_SPACE}/folder`] as { folders: Record<string, unknown>[] };
  const bearaby = {
    ...folders.folders[0],
    lists: [
      {
        id: "l-bpv",
        name: "Bearaby Project View",
        statuses: [
          { status: "Complete", orderindex: 3, color: "#00ff00", type: "closed" },
          { status: "brief creation", orderindex: 0, color: "#aaaaaa", type: "open" },
          { status: "stuck", orderindex: 2, color: "#ff0000", type: "custom" },
          { status: "Filming", orderindex: 1, color: "#123456", type: "custom" },
        ],
      },
      { id: "l-bcalls", name: "Meeting Calls" },
    ],
  };
  const db = fakeDb({
    tables: {
      ...seed(),
      os_clickup_list_statuses: [
        { list_id: "l-bpv", status: "old status", name: "Old Status", position: 10 },
        { list_id: "l-mpv", status: "editing", name: "Editing", position: 10 },
      ],
    },
    users: { "sam@goodo.test": "u-sam" },
  });
  const cu = fakeClickUp(routes({
    [`/space/${CLIENT_SPACE}/folder`]: { folders: [bearaby, ...folders.folders.slice(1)] },
    [`/space/${SOCIAL_SPACE}/list`]: {
      lists: [
        { id: "901422029399", name: "Social Media Calendar", statuses: [{ status: "Idea", orderindex: 0, type: "open" }, { status: "Posted", orderindex: 1, type: "closed" }] },
        { id: "901422314788", name: "Goodo Media day" },
      ],
    },
  }));
  const res = await mod.handler(
    new Request("https://fn.local/clickup-os-sync", { method: "POST", body: JSON.stringify({ mode: "full" }) }),
    { supabase: db.supabase, fetch: cu.fetch, now: () => NOW },
  );
  const body = await res.json();
  assertEquals(body.success, true);

  const rows = db.table("os_clickup_list_statuses");
  const of = (list: string) =>
    rows.filter((r) => r.list_id === list).sort((a, b) => Number(a.position) - Number(b.position))
      .map((r) => [r.status, r.name, r.color, r.type]);
  assertEquals(of("l-bpv"), [
    ["brief creation", "brief creation", "#aaaaaa", "open"],
    ["filming", "Filming", "#123456", "custom"],
    ["complete", "Complete", "#00ff00", "closed"],
  ], "ClickUp order and exact names; stuck is a flag, not stored; the old row is gone");
  assertEquals(of("901422029399").map((r) => r[0]), ["idea", "posted"]);
  assertEquals(of("l-mpv").map((r) => r[0]), ["editing"], "a list that was not walked keeps its rows");

  const statuses = new Map(db.table("os_task_statuses").map((s) => [String(s.status), s]));
  assertEquals(statuses.get("filming")!.stage, "Editing", "a new status takes the stage of the earlier known one on its list");
  assertEquals(statuses.get("idea")!.stage, "Other");
  assertEquals(statuses.get("posted")!.stage, "Ready to Launch", "a closed status with no known earlier one");
  assertEquals(statuses.has("stuck"), false);
  assertEquals(body.listStatusesAdded, ["filming", "idea", "posted"]);
  assertEquals(cu.calls.filter((c) => c.method !== "GET"), []);

  const order = db.log.map((l) => `${l.table}:${l.op}`);
  assert(order.indexOf("os_clickup_list_statuses:insert") < order.indexOf("os_tasks:upsert"));
});

Deno.test("stuck keeps the app status; a new stuck task takes its list's first status", async () => {
  const { tasks } = await run("full");
  const t2 = tasks.get("t2")!;
  assertEquals([t2.status, t2.raw_status, t2.is_stuck, t2.stuck_reason], ["internal review", "stuck", true, "Stuck in ClickUp"]);
  const t3 = tasks.get("t3")!;
  assertEquals([t3.status, t3.is_stuck], ["brief creation", true]);
});

Deno.test("people map by email; unmatched emails leave the id empty", async () => {
  const { tasks, body } = await run("full");
  assertEquals(tasks.get("t1")!.strategist_id, "u-sam");
  assertEquals(tasks.get("t1")!.editor_id, null);
  assertEquals(body.unmatchedPeople, 1);
});

Deno.test("full: comments for asset tasks only", async () => {
  const { db, cu, body } = await run("full");
  const commentUrls = cu.calls.map((c) => c.url).filter((u) => u.includes("/comment"));
  assertEquals(commentUrls.length, 4, "t1, t2, t3, t5");
  const comments = db.table("os_task_comments");
  assertEquals(comments.map((c) => c.clickup_comment_id).sort(), ["cm1", "cm5"]);
  const cm1 = comments.find((c) => c.clickup_comment_id === "cm1")!;
  assertEquals(cm1.task_id, "app-t1");
  assert(comments.every((c) => c.thread === "internal"), "ClickUp comments land in the internal thread");
  assertEquals((cm1.author as Record<string, unknown>).email, "sam@goodo.test");
  assertEquals(body.comments, 2);
});

Deno.test("clean walk deletes gone tasks; keeps demo, app-made and skipped-folder rows", async () => {
  const { tasks, db, body } = await run("full");
  assertEquals(tasks.has("gone-1"), false);
  assertEquals(tasks.has("demo-seed-1"), true);
  assertEquals(tasks.has("m1"), true);
  assert(db.table("os_tasks").some((r) => r.id === "app-native"));
  assertEquals(body.deleted, 1);
  assertEquals(body.deleteSkipped, false);
});

Deno.test("a list that cannot be read stops the delete and marks the run not ok", async () => {
  const { tasks, body, db } = await run("full", { failing: { "/list/l-rpv/task": 500 } });
  assertEquals(body.success, false);
  assertEquals(body.deleteSkipped, true);
  assertEquals(body.failedLists, ["Royo Project View"]);
  assertEquals(tasks.has("gone-1"), true);
  const runRow = db.table("os_sync_runs").find((r) => r.kind === "full")!;
  assertEquals(runRow.ok, false);
});

Deno.test("a failed task upsert stops the delete", async () => {
  const { body, db } = await run("full", { fail: ["os_tasks:upsert"] });
  assertEquals(body.success, false);
  assertEquals(body.deleteSkipped, true);
  assert(db.table("os_tasks").some((r) => r.clickup_task_id === "gone-1"));
});

Deno.test("nightly: discrepancies are recorded before the app row is overwritten", async () => {
  const { db, tasks, body } = await run("nightly");
  const runRow = db.table("os_sync_runs").find((r) => r.kind === "nightly" && r.id !== "run-prev")!;
  const diffs = db.table("os_sync_discrepancies");
  const status = diffs.find((d) => d.clickup_task_id === "t1" && d.field === "status")!;
  assertEquals([status.app_value, status.clickup_value, status.run_id], ["complete", "editing", runRow.id]);
  assertEquals(diffs.filter((d) => d.clickup_task_id === "t2" && d.field === "status"), [], "stuck is not a discrepancy");
  assertEquals(tasks.get("t1")!.status, "editing", "ClickUp wins after the record");
  assertEquals(runRow.discrepancy_count, diffs.length);
  assertEquals(body.discrepancies, diffs.length);
  const order = db.log.map((l) => `${l.table}:${l.op}`);
  assert(order.indexOf("os_sync_discrepancies:insert") > order.indexOf("os_tasks:select"));
});

Deno.test("nightly: comments only for tasks ClickUp updated since the last good run", async () => {
  const { cu, body } = await run("nightly");
  const commentUrls = cu.calls.map((c) => c.url).filter((u) => u.includes("/comment"));
  assertEquals(commentUrls.length, 1);
  assert(commentUrls[0].includes("/task/t1/comment"));
  assertEquals(body.commentTasks, 1);
});

Deno.test("full mode records no discrepancies", async () => {
  const { db } = await run("full");
  assertEquals(db.table("os_sync_discrepancies").length, 0);
});

Deno.test("the run is recorded with counts", async () => {
  const { db } = await run("full");
  const runRow = db.table("os_sync_runs").find((r) => r.kind === "full")!;
  assertEquals(runRow.ok, true);
  assert(runRow.finished_at);
  assertEquals((runRow.counts as Record<string, unknown>).seen, 8);
});

Deno.test("a bad mode is refused", async () => {
  const db = fakeDb({ tables: seed() });
  const cu = fakeClickUp(routes());
  const res = await mod.handler(
    new Request("https://fn.local/x", { method: "POST", body: JSON.stringify({ mode: "everything" }) }),
    { supabase: db.supabase, fetch: cu.fetch },
  );
  assertEquals(res.status, 400);
  assertEquals(cu.calls.length, 0);
});

Deno.test("no ClickUp token: 503, no ClickUp call, nothing written", async () => {
  Deno.env.delete("CLICKUP_API_TOKEN");
  try {
    const db = fakeDb({ tables: seed() });
    const cu = fakeClickUp(routes());
    const res = await mod.handler(
      new Request("https://fn.local/x", { method: "POST", body: "{}" }),
      { supabase: db.supabase, fetch: cu.fetch },
    );
    assertEquals(res.status, 503);
    assertEquals(cu.calls.length, 0);
    assertEquals(db.log.filter((l) => l.op !== "select"), []);
  } finally {
    Deno.env.set("CLICKUP_API_TOKEN", "fake-clickup-token");
  }
});

Deno.test("a caller without the service-role key is refused", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return Promise.resolve(new Response("{}", { status: 401 }));
  }) as typeof fetch;
  try {
    const res = await mod.handler(
      new Request("https://fn.local/clickup-os-sync", { method: "POST", headers: { Authorization: "Bearer not-a-key" }, body: "{}" }),
    );
    assert(res.status === 401 || res.status === 403, `expected a refusal, got ${res.status}`);
    assertEquals(urls.filter((u) => u.includes("clickup.com")).length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
