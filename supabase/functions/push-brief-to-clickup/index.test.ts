// Tests for push-brief-to-clickup and _shared/clickup-brief.ts.
//
// Every ClickUp call is a stubbed fetch and the database is an in-memory stand-in;
// nothing reaches the network. Covered:
//   * gate: client, no-role login and service role refused before anything else
//   * fails closed: no CLICKUP_API_TOKEN -> 503, no database read, no ClickUp call
//   * folder resolution: source_mappings first, name rules second, none / two refused
//   * existing task: overwrite refused, wrong list refused, non-asset refused,
//     success writes only description and status
//   * new task: numbering across months, current month in Pacific time
//   * picker list: empty asset tasks in assigned / brief creation only
//   * the description sent is plain markdown with no HTML tags
//
//   deno test -A supabase/functions/push-brief-to-clickup/index.test.ts

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildBriefDescription,
  cleanTitle,
  currentMonthName,
  HTML_TAG,
  isDescriptionEmpty,
  isPickable,
  nextAssetNumber,
  toPlainMarkdown,
} from "../_shared/clickup-brief.ts";
import type { Caller } from "../_shared/internal-auth.ts";

Deno.env.set("PUSH_BRIEF_TO_CLICKUP_NO_SERVE", "1");
const { handler } = await import("./index.ts");

const TOKEN = "pk_test_not_real";
const SPACE = "90146671303";
const LIST = "901420386269";
const OTHER_LIST = "901418527654";

const staff = (roles: string[]): Caller => ({ kind: "user", userId: "u1", roles, isStaff: true });
const employee = () => Promise.resolve(staff(["employee"]));
const env = (token: string | undefined) => (name: string) => (name === "CLICKUP_API_TOKEN" ? token : undefined);

// ── in-memory database ──────────────────────────────────────────────────────
type Row = Record<string, string | boolean>;
function fakeDb(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  const db = {
    from(table: string) {
      reads.push(table);
      const filters: [string, unknown][] = [];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        then(resolve: (r: { data: Row[]; error: null }) => unknown) {
          const rows = (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { db: () => db as never, reads };
}

const TABLES: Record<string, Row[]> = {
  clients: [
    { slug: "smokeshow", name: "Smokeshow", active: true },
    { slug: "bearaby", name: "Bearaby", active: true },
    { slug: "nofolder", name: "Zzz No Folder Co", active: true },
  ],
  client_ad_accounts: [{ account_id: "act_smoke", client_slug: "smokeshow" }],
  ad_accounts: [{ id: "act_smoke", name: "Smokeshow", is_active: true }],
  source_mappings: [],
};

// ── stubbed ClickUp ─────────────────────────────────────────────────────────
interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

const FOLDERS = {
  folders: [
    { id: "f-smoke", name: "Smokeshow", lists: [{ id: LIST, name: "Smokeshow Project View" }] },
    { id: "f-bear", name: "Bearaby - Ending October", lists: [{ id: OTHER_LIST, name: "Bearaby Project View" }] },
  ],
};

function task(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    url: `https://app.clickup.com/t/${id}`,
    status: { status: "assigned" },
    list: { id: LIST },
    description: "",
    text_content: "",
    markdown_description: "",
    ...extra,
  };
}

const LIST_TASKS = [
  task("t8", "October Asset 8 - Old hook", { status: { status: "complete" }, description: "done", text_content: "done" }),
  task("86bc00t09", "November Asset 9"),
  task("86bc00t10", "November Asset 10", { status: { status: "brief creation" } }),
  task("86bc00t11", "November Asset 11", { markdown_description: "Strategist draft", text_content: "Strategist draft" }),
  task("t12", "November Asset 12", { status: { status: "editing" } }),
  task("86bcshoot", "Shoot day - November"),
];

function stubClickUp(routes: Record<string, (seen: Seen) => Response>) {
  const seen: Seen[] = [];
  const fetch = (url: string, init: RequestInit) => {
    const s: Seen = {
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : null,
    };
    seen.push(s);
    const path = url.replace("https://api.clickup.com/api/v2", "");
    const key = `${s.method} ${path.split("?")[0]}`;
    const route = routes[key];
    if (!route) return Promise.resolve(new Response(`no route ${key}`, { status: 599 }));
    return Promise.resolve(route(s));
  };
  return { fetch, seen };
}

const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const baseRoutes = (extra: Record<string, (seen: Seen) => Response> = {}) => ({
  [`GET /space/${SPACE}/folder`]: ok(FOLDERS),
  [`GET /list/${LIST}/task`]: ok({ tasks: LIST_TASKS, last_page: true }),
  ...extra,
});

function post(body: unknown) {
  return new Request("https://fn.test/push-brief-to-clickup", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer x" },
    body: JSON.stringify(body),
  });
}

async function run(body: unknown, opts: {
  routes?: Record<string, (seen: Seen) => Response>;
  caller?: () => Promise<Caller | Response>;
  token?: string | undefined;
  tables?: Record<string, Row[]>;
  now?: Date;
} = {}) {
  const click = stubClickUp(opts.routes ?? baseRoutes());
  const db = fakeDb(opts.tables ?? TABLES);
  const res = await handler(post(body), {
    resolveCaller: opts.caller ?? employee,
    env: env("token" in opts ? opts.token : TOKEN),
    fetch: click.fetch,
    db: db.db,
    now: () => opts.now ?? new Date("2026-11-15T12:00:00Z"),
  });
  return { res, json: await res.json().catch(() => null), seen: click.seen, reads: db.reads };
}

const writes = (seen: Seen[]) => seen.filter((s) => s.method !== "GET");
const PUSH = { action: "push", client_slug: "smokeshow", title: "Sleep hook", body: "## Hook\nTired of 3am?" };

// ── gate and fail-closed ────────────────────────────────────────────────────

Deno.test("a client login is refused before any database read or ClickUp call", async () => {
  const r = await run({ ...PUSH, target: "new" }, { caller: () => Promise.resolve(staff(["client"])) });
  assertEquals(r.res.status, 403);
  assertEquals(r.seen.length, 0);
  assertEquals(r.reads.length, 0);
});

Deno.test("a login with no role and the service role are refused", async () => {
  for (const caller of [staff([]), { kind: "service", isStaff: true, userId: null } as Caller]) {
    const r = await run({ action: "list", client_slug: "smokeshow" }, { caller: () => Promise.resolve(caller) });
    assertEquals(r.res.status, 403);
    assertEquals(r.seen.length, 0);
  }
});

Deno.test("an unauthenticated request gets the gate's 401", async () => {
  const r = await run({ action: "list", client_slug: "smokeshow" }, {
    caller: () => Promise.resolve(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })),
  });
  assertEquals(r.res.status, 401);
  assertEquals(r.seen.length, 0);
});

Deno.test("builder is accepted", async () => {
  const r = await run({ action: "list", client_slug: "smokeshow" }, { caller: () => Promise.resolve(staff(["builder"])) });
  assertEquals(r.res.status, 200);
});

Deno.test("missing CLICKUP_API_TOKEN fails closed with 503 and makes no call", async () => {
  for (const token of [undefined, "  "]) {
    const r = await run({ ...PUSH, target: "new" }, { token });
    assertEquals(r.res.status, 503);
    assertStringIncludes(r.json.error, "CLICKUP_API_TOKEN");
    assertEquals(r.seen.length, 0);
    assertEquals(r.reads.length, 0);
  }
});

Deno.test("the token goes in the Authorization header and never in a response", async () => {
  const r = await run({ action: "list", client_slug: "smokeshow" });
  assert(r.seen.every((s) => s.headers.Authorization === TOKEN));
  assert(!JSON.stringify(r.json).includes(TOKEN));
});

Deno.test("a rejected token answers 503", async () => {
  const r = await run({ action: "list", client_slug: "smokeshow" }, {
    routes: { [`GET /space/${SPACE}/folder`]: () => new Response("{}", { status: 401 }) },
  });
  assertEquals(r.res.status, 503);
});

// ── input validation ────────────────────────────────────────────────────────

Deno.test("bad input is refused with 400 and no ClickUp call", async () => {
  const cases: unknown[] = [
    { action: "delete", client_slug: "smokeshow" },
    { action: "list" },
    { action: "list", client_slug: "../etc" },
    { ...PUSH, target: "new", body: "  " },
    { ...PUSH, target: "new", title: "" },
    { ...PUSH, target: "../../x" },
    { ...PUSH },
    { ...PUSH, target: "new", creative: { ad_id: "1 OR 1" } },
    [],
  ];
  for (const body of cases) {
    const r = await run(body);
    assertEquals(r.res.status, 400, JSON.stringify(body));
    assertEquals(r.seen.length, 0);
  }
});

// ── folder resolution ───────────────────────────────────────────────────────

Deno.test("a client with no ClickUp folder is refused and nothing is written", async () => {
  const r = await run({ ...PUSH, client_slug: "nofolder", target: "new" });
  assertEquals(r.res.status, 404);
  assertStringIncludes(r.json.error, "no ClickUp folder");
  assertEquals(writes(r.seen).length, 0);
});

Deno.test("an unknown or inactive client is refused", async () => {
  const r = await run({ ...PUSH, client_slug: "ghost", target: "new" });
  assertEquals(r.res.status, 404);
  assertEquals(r.seen.length, 0);
});

Deno.test("account_id resolves to its client through client_ad_accounts", async () => {
  const r = await run({ action: "list", account_id: "act_smoke" });
  assertEquals(r.res.status, 200);
  assertEquals(r.json.client_slug, "smokeshow");
  const unlinked = await run({ action: "list", account_id: "act_other" });
  assertEquals(unlinked.res.status, 404);
});

Deno.test("a source_mappings row wins over a name match", async () => {
  const tables = {
    ...TABLES,
    source_mappings: [{ external_id: "f-bear", client_slug: "smokeshow", provider: "clickup", kind: "folder", active: true }],
  };
  const r = await run({ action: "list", client_slug: "smokeshow" }, {
    tables,
    routes: baseRoutes({ [`GET /list/${OTHER_LIST}/task`]: ok({ tasks: [], last_page: true }) }),
  });
  assertEquals(r.res.status, 200);
  assertEquals(r.json.list.id, OTHER_LIST);
});

Deno.test("two folders matching one client by name are refused", async () => {
  const folders = { folders: [...FOLDERS.folders, { id: "f-smoke2", name: "Smokeshow Labs", lists: [{ id: "l2", name: "Smokeshow Labs Project View" }] }] };
  const r = await run({ ...PUSH, target: "new" }, { routes: baseRoutes({ [`GET /space/${SPACE}/folder`]: ok(folders) }) });
  assertEquals(r.res.status, 409);
  assertEquals(writes(r.seen).length, 0);
});

// ── picker list ─────────────────────────────────────────────────────────────

Deno.test("list returns only empty asset tasks in assigned or brief creation, read-only", async () => {
  const r = await run({ action: "list", client_slug: "smokeshow" });
  assertEquals(r.res.status, 200);
  assertEquals(r.json.tasks.map((t: { id: string }) => t.id), ["86bc00t09", "86bc00t10"]);
  assertEquals(r.json.tasks[1], { id: "86bc00t10", name: "November Asset 10", status: "brief creation", url: "https://app.clickup.com/t/86bc00t10" });
  assertEquals(writes(r.seen).length, 0);
});

// ── existing task ───────────────────────────────────────────────────────────

const taskRoute = (t: Record<string, unknown>) => ({ [`GET /task/${t.id}`]: ok(t) });

Deno.test("pushing to an empty asset task writes only the description and status", async () => {
  const target = task("86bc00t09", "November Asset 9");
  const r = await run({ ...PUSH, target: "86bc00t09", creative: { ad_id: "1203", ad_name: "Hook <b>A</b>" } }, {
    routes: baseRoutes({ ...taskRoute(target), "PUT /task/86bc00t09": ok({ ...target, status: { status: "brief creation" } }) }),
  });
  assertEquals(r.res.status, 200);
  assertEquals(r.json, { client_slug: "smokeshow", task_id: "86bc00t09", task_name: "November Asset 9", url: "https://app.clickup.com/t/86bc00t09", created: false });
  const w = writes(r.seen);
  assertEquals(w.length, 1);
  assertEquals(Object.keys(w[0].body!).sort(), ["markdown_content", "status"]);
  assertEquals(w[0].body!.status, "brief creation");
  const md = String(w[0].body!.markdown_content);
  assertStringIncludes(md, "Tired of 3am?");
  assertStringIncludes(md, "**Reference creative:** Hook A\nhttps://www.facebook.com/ads/library/?id=1203");
  assert(r.seen.find((s) => s.url.includes("/task/86bc00t09?"))!.url.includes("include_markdown_description=true"));
});

Deno.test("a task that already has a description is never overwritten", async () => {
  for (const filled of [
    { description: "Brief by Mariah" },
    { text_content: "Brief by Mariah" },
    { markdown_description: "Brief by Mariah" },
  ]) {
    const target = task("86bc00t11", "November Asset 11", filled);
    const r = await run({ ...PUSH, target: "86bc00t11" }, { routes: baseRoutes({ ...taskRoute(target), "PUT /task/86bc00t11": ok(target) }) });
    assertEquals(r.res.status, 409);
    assertStringIncludes(r.json.error, "already has a description");
    assertEquals(writes(r.seen).length, 0);
  }
});

Deno.test("a task in another list is refused", async () => {
  const target = task("86bc00t99", "November Asset 3", { list: { id: OTHER_LIST } });
  const r = await run({ ...PUSH, target: "86bc00t99" }, { routes: baseRoutes({ ...taskRoute(target), "PUT /task/86bc00t99": ok(target) }) });
  assertEquals(r.res.status, 409);
  assertStringIncludes(r.json.error, "not in this client's Project View list");
  assertEquals(writes(r.seen).length, 0);
});

Deno.test("a non-asset task is refused", async () => {
  const target = task("86bcshoot", "Shoot day - November");
  const r = await run({ ...PUSH, target: "86bcshoot" }, { routes: baseRoutes({ ...taskRoute(target), "PUT /task/86bcshoot": ok(target) }) });
  assertEquals(r.res.status, 409);
  assertStringIncludes(r.json.error, "not an asset task");
  assertEquals(writes(r.seen).length, 0);
});

Deno.test("a task ClickUp does not know answers 404", async () => {
  const r = await run({ ...PUSH, target: "nope1" }, {
    routes: baseRoutes({ "GET /task/nope1": () => new Response("{}", { status: 404 }) }),
  });
  assertEquals(r.res.status, 404);
  assertEquals(writes(r.seen).length, 0);
});

Deno.test("a ClickUp failure on write answers 502", async () => {
  const target = task("86bc00t09", "November Asset 9");
  const r = await run({ ...PUSH, target: "86bc00t09" }, {
    routes: baseRoutes({ ...taskRoute(target), "PUT /task/86bc00t09": () => new Response("{}", { status: 500 }) }),
  });
  assertEquals(r.res.status, 502);
});

// ── new task ────────────────────────────────────────────────────────────────

Deno.test("a new task is numbered after the highest asset number in the list", async () => {
  const r = await run({ ...PUSH, target: "new" }, {
    routes: baseRoutes({ [`POST /list/${LIST}/task`]: (s) => new Response(JSON.stringify({ id: "new1", name: s.body!.name, url: "https://app.clickup.com/t/new1" })) }),
  });
  assertEquals(r.res.status, 200);
  const w = writes(r.seen);
  assertEquals(w.length, 1);
  assertEquals(w[0].body!.name, "November Asset 13 - Sleep hook");
  assertEquals(w[0].body!.status, "brief creation");
  assertEquals(Object.keys(w[0].body!).sort(), ["markdown_content", "name", "status"]);
  assertEquals(r.json, { client_slug: "smokeshow", task_id: "new1", task_name: "November Asset 13 - Sleep hook", url: "https://app.clickup.com/t/new1", created: true });
});

Deno.test("new-task numbering reads every page of the list", async () => {
  let page = 0;
  const r = await run({ ...PUSH, target: "new" }, {
    routes: baseRoutes({
      [`GET /list/${LIST}/task`]: () =>
        page++ === 0
          ? new Response(JSON.stringify({ tasks: [task("a", "November Asset 2")], last_page: false }))
          : new Response(JSON.stringify({ tasks: [task("b", "October Asset 40 - Old")], last_page: true })),
      [`POST /list/${LIST}/task`]: (s) => new Response(JSON.stringify({ id: "n", name: s.body!.name })),
    }),
  });
  assertEquals(writes(r.seen)[0].body!.name, "November Asset 41 - Sleep hook");
});

Deno.test("a list with no asset tasks starts at Asset 1, in the Pacific month", async () => {
  const r = await run({ ...PUSH, target: "new" }, {
    // 07:00 UTC on 1 December is still 30 November in Los Angeles.
    now: new Date("2026-12-01T07:00:00Z"),
    routes: baseRoutes({
      [`GET /list/${LIST}/task`]: ok({ tasks: [task("s", "Shoot day")], last_page: true }),
      [`POST /list/${LIST}/task`]: (s) => new Response(JSON.stringify({ id: "n", name: s.body!.name })),
    }),
  });
  assertEquals(writes(r.seen)[0].body!.name, "November Asset 1 - Sleep hook");
});

// ── description is plain markdown ───────────────────────────────────────────

Deno.test("the description sent contains no HTML tags", async () => {
  const body = "Hook line<sub>Notes: test two openers</sub>\n<b>Bold</b> <a href=\"x\">link</a> <br/> <https://example.com/ref>\n<!-- hidden -->";
  const r = await run({ ...PUSH, body, title: "<i>Title</i>", target: "new", creative: { ad_id: "77", ad_name: "<sub>ad</sub>" } }, {
    routes: baseRoutes({ [`POST /list/${LIST}/task`]: (s) => new Response(JSON.stringify({ id: "n", name: s.body!.name })) }),
  });
  assertEquals(r.res.status, 200);
  const sent = writes(r.seen)[0].body!;
  const md = String(sent.markdown_content);
  assert(!HTML_TAG.test(md), md);
  assert(!/<\/?sub/i.test(md));
  assertStringIncludes(md, "*Notes: test two openers*");
  assertStringIncludes(md, "https://example.com/ref");
  assert(!HTML_TAG.test(String(sent.name)));
  assertEquals(sent.name, "November Asset 13 - Title");
});

// ── pure helpers ────────────────────────────────────────────────────────────

Deno.test("helpers", () => {
  assert(isDescriptionEmpty({ id: "a", description: " ", text_content: null }));
  assert(!isDescriptionEmpty({ id: "a", markdown_description: "x" }));
  assert(isPickable({ id: "a", name: "May Asset 3", status: { status: "Brief Creation" } }));
  assert(!isPickable({ id: "a", name: "May Asset 3", status: { status: "editing" } }));
  assertEquals(nextAssetNumber(["November Asset 9", "October Asset 8 - x", "Shoot 99", null]), 10);
  assertEquals(currentMonthName(new Date("2026-11-09T20:00:00Z")), "November");
  assertEquals(cleanTitle("  a\n  b  "), "a b");
  assertEquals(cleanTitle("x".repeat(200)).length, 120);
  assertEquals(toPlainMarkdown("a<sub> </sub>b"), "ab");
  assertEquals(toPlainMarkdown("3 < 4 and 5 > 2"), "3 < 4 and 5 > 2");
  assertEquals(buildBriefDescription("Body"), "Body\n\n*Pushed from Verdanote.*");
});
