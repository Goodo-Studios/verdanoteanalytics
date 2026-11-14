// Tests for brain-ask (OS-026): answers only from Brain pages, with the pages cited.
//
// No database and no network: the passage store is in memory and fetch is stubbed. Covered:
//   * the gate: the resolver's 401 passes through; a client, a login with no role and the
//     service role get 403 with no read and no model request
//   * input checks (method, JSON, length)
//   * nothing matches: the plain no-match answer, no citations, no model request
//   * no ANTHROPIC_API_KEY: the matching paragraphs are the answer, each page cited once
//   * with the key: only paragraphs the model named are cited; numbers outside the set are
//     dropped; "not answered" becomes the no-match answer; a failed model call falls back to the
//     paragraphs; the key goes only to Anthropic and never into a response
//
//   deno test -A supabase/functions/brain-ask/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Caller } from "../_shared/internal-auth.ts";

Deno.env.set("BRAIN_ASK_NO_SERVE", "1");
const { handler, NO_MATCH, citationsOf } = await import("./index.ts");
type Passage = import("./index.ts").Passage;

const STAFF: Caller = { kind: "user", isStaff: true, userId: "u1", roles: ["employee"] };
const KEY = "test-key-not-real";

const P: Passage[] = [
  { page_id: "1", section: "Playbooks", slug: "video", title: "Video playbook", passage: "Film the founder in daylight." },
  { page_id: "1", section: "Playbooks", slug: "video", title: "Video playbook", passage: "Keep the logo in frame." },
  { page_id: "2", section: "Handbook", slug: "brand", title: "Brand rules", passage: "The logo never sits on a busy background." },
];

function memoryStore(rows: Passage[]) {
  const asked: string[] = [];
  return { asked, store: { passages: (q: string) => (asked.push(q), Promise.resolve(rows)) } };
}

function modelReply(obj: unknown, status = 200) {
  return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(obj) }], stop_reason: "end_turn" }), { status });
}

async function run(
  body: unknown,
  opts: { caller?: Caller | Response; rows?: Passage[]; key?: string; reply?: () => Response; raw?: string } = {},
) {
  const mem = memoryStore(opts.rows ?? P);
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const env: Record<string, string> = opts.key ? { ANTHROPIC_API_KEY: opts.key } : {};
  const res = await handler(
    new Request("https://fn.test/brain-ask", { method: "POST", body: opts.raw ?? JSON.stringify(body) }),
    {
      resolveCaller: () => Promise.resolve(opts.caller ?? STAFF),
      env: (n) => env[n],
      fetch: (url, init) => {
        seen.push({ url, init });
        return Promise.resolve((opts.reply ?? (() => modelReply({ answered: true, answer: "Film in daylight.", used: [1] })))());
      },
      store: mem.store,
    },
  );
  const text = await res.text();
  return { res, text, json: JSON.parse(text), seen, asked: mem.asked };
}

const Q = { question: "How do we film the founder?" };

Deno.test("OPTIONS is the CORS preflight; GET is refused", async () => {
  const pre = await handler(new Request("https://fn.test", { method: "OPTIONS" }));
  assertEquals(pre.status, 200);
  await pre.body?.cancel();
  const get = await handler(new Request("https://fn.test", { method: "GET" }), { resolveCaller: () => Promise.resolve(STAFF) });
  assertEquals(get.status, 405);
  await get.body?.cancel();
});

Deno.test("the resolver's 401 is passed through with no read", async () => {
  const r = await run(Q, { caller: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) });
  assertEquals(r.res.status, 401);
  assertEquals(r.asked.length, 0);
  assertEquals(r.seen.length, 0);
});

for (const [label, caller] of [
  ["client", { kind: "user", isStaff: false, userId: "c1", roles: ["client"] }],
  ["no role", { kind: "user", isStaff: false, userId: "c2", roles: [] }],
  ["service role", { kind: "service", isStaff: true, userId: null }],
] as Array<[string, Caller]>) {
  Deno.test(`${label} is refused with 403, with no Brain read and no model request`, async () => {
    const r = await run(Q, { caller, key: KEY });
    assertEquals(r.res.status, 403);
    assertEquals(r.asked.length, 0);
    assertEquals(r.seen.length, 0);
    assert(!r.text.includes("founder"));
  });
}

Deno.test("input checks", async () => {
  assertEquals((await run(null, { raw: "not json" })).res.status, 400);
  assertEquals((await run({ question: "  a " })).res.status, 400);
  assertEquals((await run({ question: 7 })).res.status, 400);
  assertEquals((await run({ question: "x".repeat(501) })).res.status, 400);
});

Deno.test("nothing matches: the plain no-match answer with no citations and no model request", async () => {
  const r = await run(Q, { rows: [], key: KEY });
  assertEquals(r.res.status, 200);
  assertEquals(r.json, { answer: NO_MATCH, mode: "none", citations: [], passages: [] });
  assertEquals(NO_MATCH, "Nothing in the Brain answers that yet.");
  assertEquals(r.seen.length, 0);
  assertEquals(r.asked, ["How do we film the founder?"]);
});

Deno.test("no key: the matching paragraphs are the answer, each page cited once", async () => {
  const r = await run(Q);
  assertEquals(r.json.mode, "passages");
  assertEquals(r.json.answer, null);
  assertEquals(r.json.citations, [
    { section: "Playbooks", slug: "video", title: "Video playbook" },
    { section: "Handbook", slug: "brand", title: "Brand rules" },
  ]);
  assertEquals(r.json.passages.length, 3);
  assertEquals(r.seen.length, 0);
});

Deno.test("with the key: only pages of the paragraphs the model used are cited", async () => {
  const r = await run(Q, { key: KEY, reply: () => modelReply({ answered: true, answer: "Film in daylight.", used: [1, 1, 9, 0] }) });
  assertEquals(r.json.mode, "answer");
  assertEquals(r.json.answer, "Film in daylight.");
  assertEquals(r.json.citations, [{ section: "Playbooks", slug: "video", title: "Video playbook" }]);
  assertEquals(r.json.passages, [{ section: "Playbooks", slug: "video", title: "Video playbook", text: "Film the founder in daylight." }]);
  assertEquals(r.seen.length, 1);
  assertEquals(r.seen[0].url, "https://api.anthropic.com/v1/messages");
  assertEquals((r.seen[0].init.headers as Record<string, string>)["x-api-key"], KEY);
  const sent = JSON.parse(String(r.seen[0].init.body));
  assert(sent.messages[0].content.includes("Keep the logo in frame."), "the model sees the Brain paragraphs");
  assert(sent.system.includes("only the numbered Brain passages"));
  assert(!r.text.includes(KEY), "the key is never in a response");
});

Deno.test("with the key: 'not answered' or no usable passage numbers is the no-match answer", async () => {
  for (const reply of [
    { answered: false, answer: "", used: [] },
    { answered: true, answer: "Made up.", used: [] },
    { answered: true, answer: "Made up.", used: [42] },
    { answered: true, answer: "   ", used: [1] },
  ]) {
    const r = await run(Q, { key: KEY, reply: () => modelReply(reply) });
    assertEquals(r.json, { answer: NO_MATCH, mode: "none", citations: [], passages: [] });
  }
});

Deno.test("a failed or unreadable model call falls back to the matching paragraphs", async () => {
  for (const reply of [
    () => new Response("down", { status: 500 }),
    () => new Response(JSON.stringify({ content: [{ type: "text", text: "not json" }] })),
    () => new Response(JSON.stringify({ content: [], stop_reason: "refusal" })),
  ]) {
    const r = await run(Q, { key: KEY, reply });
    assertEquals(r.res.status, 200);
    assertEquals(r.json.mode, "passages");
    assertEquals(r.json.citations.length, 2);
  }
});

Deno.test("a store failure is a 500 with no detail", async () => {
  const res = await handler(new Request("https://fn.test", { method: "POST", body: JSON.stringify(Q) }), {
    resolveCaller: () => Promise.resolve(STAFF),
    env: () => undefined,
    store: { passages: () => Promise.reject(new Error("db secret detail")) },
  });
  assertEquals(res.status, 500);
  assert(!(await res.text()).includes("secret"));
});

Deno.test("citationsOf keeps first-seen order and one entry per page", () => {
  assertEquals(citationsOf([P[2], P[0], P[1], P[2]]).map((c) => c.slug), ["brand", "video"]);
});
