// Tests for the sync-clickup-tasks edge function (handler level).
//
// The status and field rules are covered in _shared/clickup-pipeline.test.ts.
// Covered here:
//   * A folder resolves to a client through source_mappings first, then by name
//     against clients and their linked ad accounts. Unmatched, ambiguous and
//     stale-mapping folders are skipped, never read, and listed in the result.
//   * clickup_client_folders (retired) is never read.
//   * Every row carries client_slug; account_id only when the client has exactly
//     one linked ad account.
//   * The upsert carries client-safe columns only, into pipeline_tasks.
//   * The authoritative delete fires AFTER the upsert, with the same timestamp.
//   * SAFETY: the delete is skipped when an upsert chunk fails or when any
//     client folder could not be read, so a transient error never empties a board.
//   * A failed database read stops the run before ClickUp is called.
//   * A missing ClickUp token fails closed with no ClickUp call.
//   * Only the service role gets in.
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

// Made-up clients. bearaby and osmo have one ad account each, shared-co has two
// (so its rows get no account_id), tea has none.
const CLIENTS = [
  { slug: "bearaby", name: "Bearaby" },
  { slug: "osmo", name: "Osmo Inc" },
  { slug: "shared-co", name: "Shared Co" },
  { slug: "tea", name: "Pretty Tasty Tea" },
];
const LINKS = [
  { account_id: "act_bearaby", client_slug: "bearaby" },
  { account_id: "act_osmo", client_slug: "osmo" },
  { account_id: "act_shared_1", client_slug: "shared-co" },
  { account_id: "act_shared_2", client_slug: "shared-co" },
];
const ACCOUNTS = [
  { id: "act_bearaby", name: "Bearaby" },
  { id: "act_osmo", name: "Osmo" },
  { id: "act_shared_1", name: "Shared Co US" },
  { id: "act_shared_2", name: "Shared Co EU" },
];

interface RecorderOptions {
  upsertError?: boolean;
  mappings?: unknown[];
  failTable?: string;
}

function makeRecorder({ upsertError = false, mappings = [], failTable = "" }: RecorderOptions = {}) {
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
      if (table === failTable) return resolve({ data: null, error: { message: "read refused" } });
      if (table === "clients") return resolve({ data: CLIENTS, error: null });
      if (table === "client_ad_accounts") return resolve({ data: LINKS, error: null });
      if (table === "ad_accounts") return resolve({ data: ACCOUNTS, error: null });
      if (table === "source_mappings") return resolve({ data: mappings, error: null });
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
    // Matched through the linked ad account name ("Osmo"), not the client name.
    { id: "f-osmo", name: "Osmo", lists: [{ id: "l-osmo", name: "Osmo Project View" }] },
    { id: "f-shared", name: "Shared Co", lists: [{ id: "l-shared", name: "Shared Co Project View" }] },
    // A client with no ad account, matched by its own name.
    {
      id: "f-tea",
      name: "Pretty Tasty Tea - Ending December",
      lists: [{ id: "l-tea", name: "Tea Project View" }],
    },
    { id: "f-unknown", name: "No Client Co", lists: [{ id: "l-x", name: "No Client Co Project View" }] },
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
  "l-shared": [
    { id: "t-shared", name: "November Asset 1", status: { status: "assigned" }, date_updated: String(NOW) },
  ],
  "l-tea": [
    { id: "t-tea", name: "November Asset 3", status: { status: "ready to shoot" }, date_updated: String(NOW) },
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

const upsertedRows = (calls: Call[]) =>
  calls.find((c) => c.method === "upsert" && c.table === "pipeline_tasks")!.args[0] as Record<
    string,
    unknown
  >[];

Deno.test("syncs matched folders, reports unmatched ones, writes client-safe rows only", async () => {
  const { restore, urls } = stubClickUp();
  try {
    const { supabase, calls } = makeRecorder();
    const res = await mod.handler(makeReq(), supabase);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.matchedFolders, 4);
    assertEquals(json.matchedByMapping, 0);
    assertEquals(json.matchedByName, 4);
    assertEquals(json.unmatchedFolders, ["No Client Co"]);
    assertEquals(json.ambiguousFolders, []);
    assertEquals(json.staleMappingFolders, []);
    assertEquals(json.clientsWithoutBoardAccount, ["shared-co", "tea"]);
    assertEquals(json.upserted, 4);
    assertEquals(json.deleted, 4);

    // The unmatched folder's list is never read.
    assert(!urls.some((u) => u.includes("/list/l-x/")), "unmatched folder must not be fetched");
    assert(!urls.some((u) => u.includes("/list/l-calls/")), "only the Project View list is read");

    // The retired folder table is never read; folder mappings come from source_mappings.
    assert(!calls.some((c) => c.table === "clickup_client_folders"), "clickup_client_folders is retired");
    const mappingFilters = calls
      .filter((c) => c.table === "source_mappings" && c.method === "eq")
      .map((c) => c.args);
    assertEquals(mappingFilters, [["provider", "clickup"], ["kind", "folder"], ["active", true]]);
    const clientFilters = calls.filter((c) => c.table === "clients" && c.method === "eq").map((c) => c.args);
    assertEquals(clientFilters, [["active", true]], "only active clients are matched");

    const upsert = calls.find((c) => c.method === "upsert" && c.table === "pipeline_tasks");
    assert(upsert, "must upsert into pipeline_tasks");
    const rows = upsertedRows(calls);
    assertEquals(rows.map((r) => r.clickup_task_id).sort(), ["t-edit", "t-review", "t-shared", "t-tea"]);
    const allowed = [
      "account_id",
      "clickup_task_id",
      "client_slug",
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
    const owner = (id: string) => {
      const r = rows.find((row) => row.clickup_task_id === id)!;
      return [r.client_slug, r.account_id];
    };
    assertEquals(owner("t-edit"), ["bearaby", "act_bearaby"]);
    assertEquals(owner("t-review"), ["osmo", "act_osmo"]);
    assertEquals(owner("t-shared"), ["shared-co", null], "two ad accounts: no account_id");
    assertEquals(owner("t-tea"), ["tea", null], "no ad account: client_slug only");
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

Deno.test("a staff source mapping decides the client before the name rules", async () => {
  const { restore, urls } = stubClickUp();
  try {
    const { supabase, calls } = makeRecorder({
      mappings: [
        { external_id: "f-unknown", client_slug: "osmo" }, // no name match: the mapping makes it
        { external_id: "f-bearaby", client_slug: "tea" }, // the name says bearaby: the mapping wins
      ],
    });
    const json = await (await mod.handler(makeReq(), supabase)).json();
    assertEquals(json.matchedFolders, 5);
    assertEquals(json.matchedByMapping, 2);
    assertEquals(json.matchedByName, 3);
    assertEquals(json.unmatchedFolders, []);
    assert(urls.some((u) => u.includes("/list/l-x/")), "the mapped folder is read");
    const edit = upsertedRows(calls).find((r) => r.clickup_task_id === "t-edit")!;
    assertEquals([edit.client_slug, edit.account_id], ["tea", null]);
  } finally {
    restore();
  }
});

Deno.test("a mapping to a missing or inactive client is skipped, not guessed", async () => {
  const { restore, urls } = stubClickUp();
  try {
    const { supabase, calls } = makeRecorder({
      mappings: [{ external_id: "f-bearaby", client_slug: "inactive-client" }],
    });
    const json = await (await mod.handler(makeReq(), supabase)).json();
    assertEquals(json.staleMappingFolders, ["Bearaby"]);
    assert(json.unmatchedFolders.includes("Bearaby"));
    assert(!urls.some((u) => u.includes("/list/l-bearaby/")), "a stale mapping must not be followed");
    assert(!upsertedRows(calls).some((r) => r.client_slug === "bearaby"), "no fallback to the name match");
  } finally {
    restore();
  }
});

Deno.test("a folder whose name matches two clients is skipped and listed as ambiguous", async () => {
  const { restore, urls } = stubClickUp();
  CLIENTS.push({ slug: "bearaby-2", name: "Bearaby" });
  try {
    const { supabase } = makeRecorder();
    const json = await (await mod.handler(makeReq(), supabase)).json();
    assertEquals(json.ambiguousFolders, ["Bearaby"]);
    assert(json.unmatchedFolders.includes("Bearaby"));
    assert(!urls.some((u) => u.includes("/list/l-bearaby/")), "an ambiguous folder must not be read");
  } finally {
    CLIENTS.pop();
    restore();
  }
});

for (const table of ["clients", "client_ad_accounts", "ad_accounts", "source_mappings"]) {
  Deno.test(`a failed ${table} read stops the run before ClickUp or any write`, async () => {
    const { restore, urls } = stubClickUp();
    try {
      const { supabase, calls } = makeRecorder({ failTable: table });
      const res = await mod.handler(makeReq(), supabase);
      assertEquals(res.status, 500);
      const json = await res.json();
      assertEquals(json.success, false);
      assertEquals(urls.length, 0);
      assert(!calls.some((c) => c.method === "upsert" || c.method === "delete"));
    } finally {
      restore();
    }
  });
}

Deno.test("the delete is skipped when a client folder cannot be read", async () => {
  const { restore } = stubClickUp({ failList: "l-osmo" });
  try {
    const { supabase, calls } = makeRecorder();
    const res = await mod.handler(makeReq(), supabase);
    const json = await res.json();
    assertEquals(json.success, false);
    assertEquals(json.failedFolders, ["Osmo"]);
    assertEquals(json.deleteSkipped, true);
    assertEquals(json.upserted, 3, "the folders that did read are still refreshed");
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
