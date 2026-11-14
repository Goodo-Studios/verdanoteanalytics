// Tests for client-insights (three plain-English sentences about an account's creatives).
//
// No database and no network: the Supabase client is a fake and fetch is stubbed. Covered:
//   * the gate: no Authorization header, or a token that does not resolve, is 401 and no
//     request goes to Anthropic
//   * the data is read with the caller's own token and the anon key, never the service role, so
//     row rules keep one client's creatives away from another
//   * accountId is required
//   * an account with no creatives answers with no insights and makes no outside request
//   * the missing-key path: with no ANTHROPIC_API_KEY no request is sent and the answer says why
//   * with the key set the request carries the key, the answer is cut to three insights, and a
//     reply wrapped in a code fence still parses
//   * Anthropic rate limit passes through as 429; any other failure answers no insights; an
//     unparseable reply answers no insights; the key is never in a response
//
//   deno test -A supabase/functions/client-insights/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeCreateClient, fakeSupabase, type FakeConfig, withEnv, withFetch } from "../_shared/fake-supabase.ts";

Deno.env.set("CLIENT_INSIGHTS_NO_SERVE", "1");
const { handler } = await import("./index.ts");

const ENV = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_ANON_KEY: "anon-for-tests",
  SUPABASE_SERVICE_ROLE_KEY: "service-for-tests",
  ANTHROPIC_API_KEY: "sk-ant-test-value",
  ANTHROPIC_MODEL: undefined as string | undefined,
};

const CREATIVES = [
  { ad_name: "Summer Sale V2", spend: 900, roas: 4.2, cpa: 12.5, ctr: 1.2, ad_type: "video", style: null, hook: null, theme: null, product: null },
  { ad_name: "Beach Lifestyle", spend: 300, roas: 2.1, cpa: 20, ctr: 0.9, ad_type: "static", style: null, hook: null, theme: null, product: null },
];

const anthropic = (text: string, status = 200) =>
  new Response(JSON.stringify({ content: [{ text }] }), { status });

async function call(
  opts: {
    auth?: string | null;
    body?: unknown;
    cfg?: FakeConfig;
    key?: string;
    reply?: Response;
  } = {},
) {
  const db = fakeSupabase(opts.cfg ?? { user: { id: "u1" }, tables: { creatives: CREATIVES } });
  const { createClient, calls: clientCalls } = fakeCreateClient(db);
  const headers: Record<string, string> = {};
  if (opts.auth !== null) headers.authorization = opts.auth ?? "Bearer client-token";
  const req = new Request("http://x/client-insights", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? { accountId: "act_1" }),
  });
  let res!: Response;
  let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  await withEnv({ ...ENV, ANTHROPIC_API_KEY: "key" in opts ? opts.key : ENV.ANTHROPIC_API_KEY }, () =>
    withFetch(
      () => opts.reply ?? anthropic('["one","two","three"]'),
      async (calls) => {
        res = await handler(req, { createClient });
        fetchCalls = calls;
      },
    ));
  return { res, db, clientCalls, fetchCalls };
}

Deno.test("OPTIONS is the CORS preflight", async () => {
  const res = await handler(new Request("http://x", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  assert(res.headers.get("Access-Control-Allow-Origin"));
});

Deno.test("no Authorization header is 401, nothing is read and Anthropic is not called", async () => {
  const { res, db, clientCalls, fetchCalls } = await call({ auth: null });
  assertEquals(res.status, 401);
  assertEquals(clientCalls.length, 0);
  assertEquals(db.ops.length, 0);
  assertEquals(fetchCalls.length, 0);
});

Deno.test("a token that does not resolve to a user is 401 and Anthropic is not called", async () => {
  const { res, db, fetchCalls } = await call({ cfg: { user: null, tables: { creatives: CREATIVES } } });
  assertEquals(res.status, 401);
  assertEquals(db.ops.length, 0);
  assertEquals(fetchCalls.length, 0);
});

Deno.test("an auth error is 401 even when a user object comes back", async () => {
  const { res, fetchCalls } = await call({
    cfg: { user: { id: "u1" }, authError: { message: "expired" }, tables: { creatives: CREATIVES } },
  });
  assertEquals(res.status, 401);
  assertEquals(fetchCalls.length, 0);
});

Deno.test("creatives are read with the caller's own token and the anon key, never the service role", async () => {
  const { clientCalls, db } = await call();
  assertEquals(clientCalls.length, 1);
  assertEquals(clientCalls[0].key, "anon-for-tests");
  assertEquals(
    (clientCalls[0].options as { global: { headers: Record<string, string> } }).global.headers.Authorization,
    "Bearer client-token",
  );
  assertEquals(db.ops.map((o) => o.table), ["creatives"]);
  assertEquals(db.ops[0].filters[0], ["eq", "account_id", "act_1"]);
});

Deno.test("accountId is required", async () => {
  const { res, fetchCalls } = await call({ body: {} });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "accountId required");
  assertEquals(fetchCalls.length, 0);
});

Deno.test("an account with no creatives answers with no insights and calls nobody", async () => {
  const { res, fetchCalls } = await call({ cfg: { user: { id: "u1" }, tables: { creatives: [] } } });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { insights: [] });
  assertEquals(fetchCalls.length, 0);
});

Deno.test("no ANTHROPIC_API_KEY: no request is sent and the answer says the key is missing", async () => {
  const { res, fetchCalls } = await call({ key: undefined });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { insights: [], reason: "ai_key_missing" });
  assertEquals(fetchCalls.length, 0);
});

Deno.test("an empty ANTHROPIC_API_KEY counts as missing", async () => {
  const { res, fetchCalls } = await call({ key: "" });
  assertEquals((await res.json()).reason, "ai_key_missing");
  assertEquals(fetchCalls.length, 0);
});

Deno.test("with the key set the request carries it and the insights come back", async () => {
  const { res, fetchCalls } = await call();
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { insights: ["one", "two", "three"] });
  assertEquals(fetchCalls.length, 1);
  assertEquals(fetchCalls[0].url, "https://api.anthropic.com/v1/messages");
  assertEquals((fetchCalls[0].init?.headers as Record<string, string>)["x-api-key"], "sk-ant-test-value");
  assert(!JSON.stringify(body).includes("sk-ant-test-value"));
});

Deno.test("a reply in a code fence still parses and the list is cut to three", async () => {
  const { res } = await call({ reply: anthropic('```json\n["a","b","c","d","e"]\n```') });
  assertEquals((await res.json()).insights, ["a", "b", "c"]);
});

Deno.test("an unparseable reply answers with no insights", async () => {
  const { res } = await call({ reply: anthropic("Sure, here are three insights") });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { insights: [] });
});

Deno.test("a reply that is JSON but not a list answers with no insights", async () => {
  const { res } = await call({ reply: anthropic('{"insights":"x"}') });
  assertEquals(await res.json(), { insights: [] });
});

Deno.test("an Anthropic rate limit passes through as 429", async () => {
  const { res } = await call({ reply: new Response("slow down", { status: 429 }) });
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error, "Rate limited");
});

Deno.test("any other Anthropic failure answers with no insights and no error text", async () => {
  const { res } = await call({ reply: new Response("key sk-ant-test-value is invalid", { status: 401 }) });
  assertEquals(res.status, 200);
  const text = await res.text();
  assertEquals(JSON.parse(text), { insights: [] });
  assert(!text.includes("sk-ant-test-value"));
});

Deno.test("a crash while reading is a 500 with a fixed message", async () => {
  const db = fakeSupabase({ user: { id: "u1" } });
  const { createClient } = fakeCreateClient(db);
  db.client.from = () => {
    throw new Error("relation creatives secret detail");
  };
  let res!: Response;
  await withEnv(ENV, async () => {
    res = await handler(
      new Request("http://x", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ accountId: "a" }) }),
      { createClient },
    );
  });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Failed to generate insights" });
});
