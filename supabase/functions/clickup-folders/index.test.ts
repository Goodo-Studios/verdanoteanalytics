// Tests for the clickup-folders edge function (client Setup tab, phase 4).
//
// Every ClickUp call is a stubbed fetch; nothing reaches the network.
// Covered: the gate (client, employee, no role, no login) runs before the key check;
// no key -> 503 and no request; the one request is a GET for the client space with the
// token in the Authorization header; the answer keeps only ids and names; ClickUp errors
// become plain statuses and never echo the token.
//
//   deno test -A supabase/functions/clickup-folders/index.test.ts

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CLICKUP_CLIENT_SPACE_ID } from "../_shared/clickup-pipeline.ts";

Deno.env.set("CLICKUP_FOLDERS_NO_SERVE", "1");
const { handler, shapeFolders } = await import("./index.ts");

const TOKEN = "pk_test_not_a_real_token";
const env = (token: string | undefined) => (name: string) => (name === "CLICKUP_API_TOKEN" ? token : undefined);
const user = (roles: string[]) => () =>
  Promise.resolve({ kind: "user" as const, userId: "u1", roles, isStaff: roles.includes("builder") || roles.includes("employee") });
const service = () => Promise.resolve({ kind: "service" as const, isStaff: true as const, userId: null });

function stub(res: () => Response) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetch = (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(res());
  };
  return { fetch, seen };
}

const FOLDERS = {
  folders: [
    { id: "90001", name: "Zeta Co", hidden: false, lists: [{ id: "L2", name: "Zeta Project View", task_count: 4 }] },
    { id: 90002, name: " Alpha Co ", lists: [] },
    { id: "", name: "No id" },
    { id: "90003" },
  ],
};

Deno.test("a builder gets the folders sorted by name with only ids and names", async () => {
  const s = stub(() => new Response(JSON.stringify(FOLDERS), { status: 200 }));
  const res = await handler(new Request("http://x/", { method: "GET" }), { resolveCaller: user(["builder"]), env: env(TOKEN), fetch: s.fetch });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.folders, [
    { id: "90002", name: "Alpha Co", lists: [] },
    { id: "90001", name: "Zeta Co", lists: [{ id: "L2", name: "Zeta Project View" }] },
  ]);
  assertEquals(s.seen.length, 1);
  assertEquals(s.seen[0].url, `https://api.clickup.com/api/v2/space/${CLICKUP_CLIENT_SPACE_ID}/folder?archived=false`);
  assertEquals(s.seen[0].init.method, "GET");
  assertEquals((s.seen[0].init.headers as Record<string, string>).Authorization, TOKEN);
});

Deno.test("no token: 503 with a plain message and no request", async () => {
  const s = stub(() => new Response("{}"));
  for (const token of [undefined, "", "   "]) {
    const res = await handler(new Request("http://x/", { method: "POST", body: "{}" }), { resolveCaller: user(["builder"]), env: env(token), fetch: s.fetch });
    assertEquals(res.status, 503);
    assertStringIncludes((await res.json()).error, "CLICKUP_API_TOKEN is not set");
  }
  assertEquals(s.seen.length, 0);
});

Deno.test("clients, employees, logins with no role and the service role are refused before the key check", async () => {
  const s = stub(() => new Response("{}"));
  for (const roles of [["client"], ["employee"], []]) {
    const res = await handler(new Request("http://x/", { method: "POST", body: "{}" }), { resolveCaller: user(roles), env: env(undefined), fetch: s.fetch });
    assertEquals(res.status, 403, roles.join(","));
  }
  const res = await handler(new Request("http://x/", { method: "POST", body: "{}" }), { resolveCaller: service, env: env(TOKEN), fetch: s.fetch });
  assertEquals(res.status, 403);
  assertEquals(s.seen.length, 0);
});

Deno.test("no login: the 401 from the gate is returned as is", async () => {
  const unauthorized = () => Promise.resolve(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
  const res = await handler(new Request("http://x/", { method: "GET" }), { resolveCaller: unauthorized, env: env(TOKEN) });
  assertEquals(res.status, 401);
});

Deno.test("only GET and POST are served", async () => {
  const res = await handler(new Request("http://x/", { method: "DELETE" }), { resolveCaller: user(["builder"]), env: env(TOKEN) });
  assertEquals(res.status, 405);
});

Deno.test("ClickUp rejecting the token is a plain 503 and the token is never echoed", async () => {
  const s = stub(() => new Response(`bad token ${TOKEN}`, { status: 401 }));
  const res = await handler(new Request("http://x/", { method: "GET" }), { resolveCaller: user(["builder"]), env: env(TOKEN), fetch: s.fetch });
  assertEquals(res.status, 503);
  const text = await res.text();
  assert(!text.includes(TOKEN));
});

Deno.test("another ClickUp error is a 502 with the status only", async () => {
  const s = stub(() => new Response(`server said ${TOKEN}`, { status: 500 }));
  const res = await handler(new Request("http://x/", { method: "GET" }), { resolveCaller: user(["builder"]), env: env(TOKEN), fetch: s.fetch });
  assertEquals(res.status, 502);
  const text = await res.text();
  assertStringIncludes(text, "(500)");
  assert(!text.includes(TOKEN));
});

Deno.test("a network failure is a plain 502", async () => {
  const fetch = () => Promise.reject(new Error(`connect failed with ${TOKEN}`));
  const res = await handler(new Request("http://x/", { method: "GET" }), { resolveCaller: user(["builder"]), env: env(TOKEN), fetch });
  assertEquals(res.status, 502);
  assert(!(await res.text()).includes(TOKEN));
});

Deno.test("shapeFolders copes with malformed answers", () => {
  assertEquals(shapeFolders(null), []);
  assertEquals(shapeFolders({}), []);
  assertEquals(shapeFolders({ folders: "x" }), []);
  assertEquals(shapeFolders({ folders: [null, 3, { id: "1", name: "A", lists: "no" }] }), [{ id: "1", name: "A", lists: [] }]);
});
