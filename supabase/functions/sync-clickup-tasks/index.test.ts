// Tests for the sync-clickup-tasks edge function (handler level).
//
// The status and field rules are covered in _shared/clickup-pipeline.test.ts.
// Covered here:
//   * Only matched client folders are read; unmatched folders are reported.
//   * The upsert carries client-safe columns only, into pipeline_tasks.
//   * The authoritative delete fires AFTER the upsert, with the same timestamp.
//   * SAFETY: the delete is skipped when an upsert chunk fails or when any
//     client folder could not be read, so a transient error never empties a board.
//   * A missing ClickUp token fails closed with no ClickUp call.
//
//   deno test -A supabase/functions/sync-clickup-tasks/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SYNC_CLICKUP_TASKS_NO_SERVE", "1");
Deno.env.set("CLICKUP_API_TOKEN", "fake-clickup-token");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const mod = await import("./index.ts");

interface Call {
  method: string;
  table: string;
  args: unknown[];
}

const ACCOUNTS = [
  { id: "act_bearaby", name: "Bearaby" },
  { id: "act_osmo", name: "Osmo" },
];

function makeRecorder({ upsertError = false, overrides = [] as unknown[] } = {}) {
  const calls: Call[] = [];
  const makeBuilder = (table: string) => {
    let op = "select";
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "upsert", "delete", "lt"]) {
      builder[m] = (...args: unknown[]) => {
        if (m === "upsert" || m === "delete") op = m;
        calls.push({ method: m, table, args });
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => void) => {
      if (op === "delete") return resolve({ data: null, error: null, count: 4 });
      if (op === "upsert") {
        return resolve(
          upsertError ? { data: null, error: { message: "boom" } } : { data: null, error: null },
        );
      }
      if (table === "ad_accounts") return resolve({ data: ACCOUNTS, error: null });
      if (table === "clickup_client_folders") return resolve({ data: overrides, error: null });
      return resolve({ data: [], error: null });
    };
    return builder;
  };
  const supabase = {
    from: (table: string) => {
      calls.push({ method: "from", table, args: [] });
      return makeBuilder(table);
    },
  };
  return { supabase, calls };
}

const NOW = Date.now();

const FOLDERS = {
  folders: [
    {
      id: "f-bearaby",
      name: "Bearaby",
      lists: [
        { id: "l-bearaby", name: "Bearaby Project View" },
        { id: "l-calls", name: "Meeting Calls" },
      ],
    },
    { id: "f-osmo", name: "Osmo", lists: [{ id: "l-osmo", name: "Osmo Project View" }] },
    { id: "f-unknown", name: "No Account Co", lists: [{ id: "l-x", name: "No Account Co Project View" }] },
  ],
};

const TASKS: Record<string, unknown[]> = {
  "l-bearaby": [
    {
      id: "t-edit",
      name: "November Asset 1 - Gifting",
      status: { status: "editing" },
      due_date: "1795194000000",
      date_updated: String(NOW),
      assignees: [{ email: "internal@goodostudios.com" }],
      custom_fields: [{ name: "Link to Asset", type: "text", value: "https://app.air.inc/secret" }],
    },
    { id: "t-stuck", name: "November Asset 2", status: { status: "stuck" }, date_updated: String(NOW) },
    { id: "t-shoot", name: "Nov Shoot Day", status: { status: "assigned" }, date_updated: String(NOW) },
  ],
  "l-osmo": [
    { id: "t-review", name: "November Asset 5", status: { status: "client review" }, date_updated: String(NOW) },
  ],
};

function stubClickUp({ failList = "" } = {}): { restore: () => void; urls: string[] } {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    assertEquals(init?.method ?? "GET", "GET", "the sync must never write to ClickUp");
    const json = (body: unknown, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
      );
    if (url.includes("/space/")) return json(FOLDERS);
    const listId = url.match(/\/list\/([^/]+)\/task/)?.[1] ?? "";
    if (listId === failList) return json({ err: "rate limited" }, 429);
    return json({ tasks: TASKS[listId] ?? [], last_page: true });
  }) as typeof fetch;
  return { restore: () => (globalThis.fetch = original), urls };
}

const makeReq = () => new Request("https://fn.local/sync-clickup-tasks", { method: "POST" });

Deno.test("syncs matched folders, reports unmatched ones, writes client-safe rows only", async () => {
  const { restore, urls } = stubClickUp();
  try {
    const { supabase, calls } = makeRecorder();
    const res = await mod.handler(makeReq(), supabase);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.matchedFolders, 2);
    assertEquals(json.unmatchedFolders, ["No Account Co"]);
    assertEquals(json.upserted, 2);
    assertEquals(json.deleted, 4);

    // The unmatched folder's list is never read.
    assert(!urls.some((u) => u.includes("/list/l-x/")), "unmatched folder must not be fetched");
    assert(!urls.some((u) => u.includes("/list/l-calls/")), "only the Project View list is read");

    const upsert = calls.find((c) => c.method === "upsert" && c.table === "pipeline_tasks");
    assert(upsert, "must upsert into pipeline_tasks");
    const rows = upsert.args[0] as Record<string, unknown>[];
    assertEquals(rows.map((r) => r.clickup_task_id).sort(), ["t-edit", "t-review"]);
    const allowed = [
      "account_id",
      "clickup_task_id",
      "content_type",
      "due_date",
      "stage",
      "synced_at",
      "task_name",
      "updated_at",
    ];
    for (const row of rows) assertEquals(Object.keys(row).sort(), allowed);
    assert(!JSON.stringify(rows).includes("air.inc"), "asset links must not be stored");
    assert(!JSON.stringify(rows).includes("goodostudios.com"), "assignees must not be stored");
    assertEquals(rows.find((r) => r.clickup_task_id === "t-edit")?.account_id, "act_bearaby");
    assertEquals(rows.find((r) => r.clickup_task_id === "t-review")?.account_id, "act_osmo");
    assertEquals(rows.find((r) => r.clickup_task_id === "t-review")?.stage, "Client Review");

    // Delete happens after the upsert, on the same timestamp the rows carry.
    const upsertIdx = calls.indexOf(upsert);
    const deleteIdx = calls.findIndex((c) => c.method === "delete" && c.table === "pipeline_tasks");
    assert(deleteIdx > upsertIdx, "delete must come after the upsert");
    const lt = calls.find((c) => c.method === "lt" && c.table === "pipeline_tasks");
    assertEquals(lt?.args, ["synced_at", rows[0].synced_at]);
  } finally {
    restore();
  }
});

Deno.test("a staff override row decides the account for a folder", async () => {
  const { restore } = stubClickUp();
  try {
    const { supabase, calls } = makeRecorder({
      overrides: [{ folder_id: "f-unknown", account_id: "act_osmo" }],
    });
    const json = await (await mod.handler(makeReq(), supabase)).json();
    assertEquals(json.matchedFolders, 3);
    assertEquals(json.unmatchedFolders, []);
    assert(calls.some((c) => c.method === "upsert"));
  } finally {
    restore();
  }
});

Deno.test("the delete is skipped when a client folder cannot be read", async () => {
  const { restore } = stubClickUp({ failList: "l-osmo" });
  try {
    const { supabase, calls } = makeRecorder();
    const res = await mod.handler(makeReq(), supabase);
    const json = await res.json();
    assertEquals(json.success, false);
    assertEquals(json.failedFolders, ["Osmo"]);
    assertEquals(json.deleteSkipped, true);
    assertEquals(json.upserted, 1, "the folders that did read are still refreshed");
    assert(!calls.some((c) => c.method === "delete"), "must not delete after a partial read");
  } finally {
    restore();
  }
});

Deno.test("the delete is skipped when an upsert chunk fails", async () => {
  const { restore } = stubClickUp();
  try {
    const { supabase, calls } = makeRecorder({ upsertError: true });
    const json = await (await mod.handler(makeReq(), supabase)).json();
    assertEquals(json.success, false);
    assertEquals(json.deleteSkipped, true);
    assert(!calls.some((c) => c.method === "delete"));
  } finally {
    restore();
  }
});

Deno.test("a missing ClickUp token fails closed without calling ClickUp", async () => {
  const { restore, urls } = stubClickUp();
  Deno.env.delete("CLICKUP_API_TOKEN");
  try {
    const { supabase, calls } = makeRecorder();
    const res = await mod.handler(makeReq(), supabase);
    assertEquals(res.status, 500);
    const json = await res.json();
    assertEquals(json.success, false);
    assertEquals(urls.length, 0);
    assert(!calls.some((c) => c.method === "upsert" || c.method === "delete"));
  } finally {
    Deno.env.set("CLICKUP_API_TOKEN", "fake-clickup-token");
    restore();
  }
});

Deno.test("a caller without the service-role key is refused", async () => {
  const { restore, urls } = stubClickUp();
  try {
    const res = await mod.handler(
      new Request("https://fn.local/sync-clickup-tasks", {
        method: "POST",
        headers: { Authorization: "Bearer not-the-service-key" },
      }),
    );
    assert(res.status === 401 || res.status === 403, `expected a refusal, got ${res.status}`);
    assertEquals(urls.filter((u) => u.includes("clickup.com")).length, 0);
  } finally {
    restore();
  }
});
