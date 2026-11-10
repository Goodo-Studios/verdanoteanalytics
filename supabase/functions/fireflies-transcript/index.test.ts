// Tests for the fireflies-transcript edge function and _shared/fireflies.ts.
//
// Every Fireflies call is a stubbed fetch; nothing reaches the network.
// Covered:
//   * fails closed: no key -> 503 and no request; the gate runs before the key check
//   * the only request is a GraphQL `query` for the named transcript, with the key in
//     the Authorization header and never in a response or a log
//   * normalising, excerpt grouping, sensitive excerpts withheld
//   * not found, access denied, processing, rejected key (not retried), rate limit
//     (waits for Retry-After), provider errors (bounded retries), malformed answers
//
//   deno test -A supabase/functions/fireflies-transcript/index.test.ts

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyTranscriptText, FIREFLIES_API_URL, TRANSCRIPT_QUERY } from "../_shared/fireflies.ts";

Deno.env.set("FIREFLIES_TRANSCRIPT_NO_SERVE", "1");
const { handler } = await import("./index.ts");

const KEY = "ff-test-key-not-real";
const allow = () => Promise.resolve(null);
const env = (key: string | undefined) => (name: string) => (name === "FIREFLIES_API_KEY" ? key : undefined);

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: { query: string; variables: { id: string } };
}

function stubFetch(responses: Array<() => Response>) {
  const seen: Seen[] = [];
  let i = 0;
  const fetch = (input: string, init: RequestInit) => {
    seen.push({
      url: input,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    const next = responses[Math.min(i++, responses.length - 1)];
    return Promise.resolve(next());
  };
  return { fetch, seen };
}

const ok = (data: unknown) => () => new Response(JSON.stringify({ data }), { status: 200 });
const gqlError = (code: string, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify({ errors: [{ message: "x", extensions: { code } }] }), { status, headers });

const TRANSCRIPT = {
  id: "tr_1",
  date: Date.parse("2026-11-02T15:00:00Z"),
  organizer_email: "Owner@Example.test",
  participants: ["a@example.test, B@example.test", "a@example.test"],
  is_live: false,
  sentences: [
    { index: 0, speaker_id: 1, speaker_name: "Pat", text: "Kickoff for the new cycle.", start_time: "0", end_time: "3" },
    { index: 1, speaker_id: 1, speaker_name: "Pat", text: "Three hooks this week.", start_time: "3", end_time: "6" },
    { index: 2, speaker_id: 2, speaker_name: "Sam", text: "We need to talk about his salary later.", start_time: "6", end_time: "9" },
    { index: 3, speaker_id: 1, speaker_name: "Pat", text: "Back to the brief.", start_time: "9", end_time: "11" },
  ],
};

function post(body: unknown) {
  return new Request("https://fn.test/fireflies-transcript", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify(body),
  });
}

Deno.test("OPTIONS answers the CORS preflight", async () => {
  const res = await handler(new Request("https://fn.test/x", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  await res.body?.cancel();
});

Deno.test("GET is refused", async () => {
  const res = await handler(new Request("https://fn.test/x", { method: "GET" }), { authorize: allow, env: env(KEY) });
  assertEquals(res.status, 405);
  await res.body?.cancel();
});

Deno.test("no bearer token: the real gate answers 401 before anything else", async () => {
  const { fetch, seen } = stubFetch([ok({ transcript: TRANSCRIPT })]);
  const req = new Request("https://fn.test/x", { method: "POST", body: JSON.stringify({ transcript_id: "tr_1" }) });
  const res = await handler(req, { env: env(KEY), fetch });
  assertEquals(res.status, 401);
  assertEquals(seen.length, 0);
  await res.body?.cancel();
});

Deno.test("a refused caller gets the gate's answer, even with a key set, and no request is made", async () => {
  const { fetch, seen } = stubFetch([ok({ transcript: TRANSCRIPT })]);
  const forbidden = () => Promise.resolve(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
  const res = await handler(post({ transcript_id: "tr_1" }), { authorize: forbidden, env: env(KEY), fetch });
  assertEquals(res.status, 403);
  assertEquals(seen.length, 0);
  await res.body?.cancel();
});

Deno.test("fails closed without FIREFLIES_API_KEY: 503, clear message, no request", async () => {
  for (const key of [undefined, "", "   "]) {
    const { fetch, seen } = stubFetch([ok({ transcript: TRANSCRIPT })]);
    const res = await handler(post({ transcript_id: "tr_1" }), { authorize: allow, env: env(key), fetch });
    assertEquals(res.status, 503);
    assertStringIncludes((await res.json()).error, "FIREFLIES_API_KEY is not set");
    assertEquals(seen.length, 0);
  }
});

Deno.test("a malformed transcript id is refused with no request", async () => {
  for (const id of ["", "has space", "../etc", "x".repeat(201), 42]) {
    const { fetch, seen } = stubFetch([ok({ transcript: TRANSCRIPT })]);
    const res = await handler(post({ transcript_id: id }), { authorize: allow, env: env(KEY), fetch });
    assertEquals(res.status, 400);
    assertEquals(seen.length, 0);
    await res.body?.cancel();
  }
});

Deno.test("sends one read-only query for the named transcript and returns normalised metadata", async () => {
  const { fetch, seen } = stubFetch([ok({ transcript: TRANSCRIPT })]);
  const res = await handler(post({ transcript_id: "tr_1" }), { authorize: allow, env: env(KEY), fetch });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, FIREFLIES_API_URL);
  assertEquals(seen[0].method, "POST");
  assertEquals(seen[0].headers.authorization, `Bearer ${KEY}`);
  assertEquals(seen[0].body.query, TRANSCRIPT_QUERY);
  assert(seen[0].body.query.startsWith("query "), "only a GraphQL query is ever sent");
  assert(!/mutation/i.test(seen[0].body.query), "no mutation");
  assertEquals(seen[0].body.variables, { id: "tr_1" });
  assertEquals(body.status, "completed");
  assertEquals(body.transcript.id, "tr_1");
  assertEquals(body.transcript.started_at, "2026-11-02T15:00:00.000Z");
  assertEquals(body.transcript.organizer, "owner@example.test");
  assertEquals(body.transcript.participants, ["a@example.test", "b@example.test"]);
  assert(/^fireflies-v1-[0-9a-f]{40}$/.test(body.transcript.source_version));
  assertEquals(body.excerpts, undefined, "excerpts only when asked");
  assert(!JSON.stringify(body).includes(KEY), "the key never appears in a response");
});

Deno.test("excerpts group one speaker's sentences and withhold sensitive text", async () => {
  const { fetch } = stubFetch([ok({ transcript: TRANSCRIPT })]);
  const res = await handler(post({ transcript_id: "tr_1", include_excerpts: true }), { authorize: allow, env: env(KEY), fetch });
  const body = await res.json();
  assertEquals(body.excerpts.length, 3);
  assertEquals(body.excerpts[0].speaker, "Pat");
  assertEquals(body.excerpts[0].text, "Kickoff for the new cycle. Three hooks this week.");
  assertEquals(body.excerpts[0].started_at, "2026-11-02T15:00:00.000Z");
  assertEquals(body.excerpts[0].ended_at, "2026-11-02T15:00:06.000Z");
  assertEquals(body.excerpts[1].classification, "personnel");
  assertEquals(body.excerpts[1].text, null);
  assertEquals(body.excerpts[2].text, "Back to the brief.");
  assertEquals(body.withheld, 1);
  assert(!JSON.stringify(body).includes("salary"), "withheld text is not in the response");
});

Deno.test("the same transcript gives the same source version; a changed sentence gives a new one", async () => {
  const run = async (t: unknown) => {
    const { fetch } = stubFetch([ok({ transcript: t })]);
    return (await (await handler(post({ transcript_id: "tr_1" }), { authorize: allow, env: env(KEY), fetch })).json()).transcript.source_version;
  };
  const a = await run(TRANSCRIPT);
  const b = await run(TRANSCRIPT);
  const changed = { ...TRANSCRIPT, sentences: [{ ...TRANSCRIPT.sentences[0], text: "Edited." }, ...TRANSCRIPT.sentences.slice(1)] };
  assertEquals(a, b);
  assert(a !== (await run(changed)));
});

Deno.test("a live or unprocessed transcript is processing and has no excerpts", async () => {
  for (const t of [{ ...TRANSCRIPT, is_live: true }, { ...TRANSCRIPT, sentences: null }]) {
    const { fetch } = stubFetch([ok({ transcript: t })]);
    const body = await (await handler(post({ transcript_id: "tr_1", include_excerpts: true }), { authorize: allow, env: env(KEY), fetch })).json();
    assertEquals(body.status, "processing");
    assertEquals(body.excerpts, undefined);
  }
});

Deno.test("not found and access denied are reported as statuses", async () => {
  const cases: Array<[() => Response, string]> = [
    [gqlError("object_not_found"), "not_found"],
    [ok({ transcript: null }), "not_found"],
    [gqlError("forbidden"), "access_denied"],
    [gqlError("not_in_team"), "access_denied"],
  ];
  for (const [response, status] of cases) {
    const { fetch } = stubFetch([response]);
    const body = await (await handler(post({ transcript_id: "tr_1" }), { authorize: allow, env: env(KEY), fetch })).json();
    assertEquals(body.status, status);
  }
});

Deno.test("a rejected key is 503 and is not retried", async () => {
  for (const response of [() => new Response("{}", { status: 401 }), gqlError("auth_failed")]) {
    const { fetch, seen } = stubFetch([response]);
    const res = await handler(post({ transcript_id: "tr_1" }), { authorize: allow, env: env(KEY), fetch, sleep: () => Promise.resolve() });
    assertEquals(res.status, 503);
    assertStringIncludes((await res.json()).error, "rejected FIREFLIES_API_KEY");
    assertEquals(seen.length, 1);
  }
});

Deno.test("a rate limit waits for Retry-After and then succeeds", async () => {
  const waits: number[] = [];
  const { fetch, seen } = stubFetch([gqlError("too_many_requests", 429, { "retry-after": "2" }), ok({ transcript: TRANSCRIPT })]);
  const res = await handler(post({ transcript_id: "tr_1" }), {
    authorize: allow, env: env(KEY), fetch, sleep: (ms) => { waits.push(ms); return Promise.resolve(); },
  });
  assertEquals(res.status, 200);
  assertEquals(waits, [2000]);
  assertEquals(seen.length, 2);
  await res.body?.cancel();
});

Deno.test("provider errors are retried a bounded number of times, then 502", async () => {
  const { fetch, seen } = stubFetch([() => new Response("oops", { status: 500 })]);
  const res = await handler(post({ transcript_id: "tr_1" }), { authorize: allow, env: env(KEY), fetch, sleep: () => Promise.resolve() });
  assertEquals(res.status, 502);
  assertEquals(seen.length, 4);
  await res.body?.cancel();
});

Deno.test("a network failure is retried, then 502", async () => {
  let calls = 0;
  const fetch = () => { calls++; return Promise.reject(new TypeError("network")); };
  const res = await handler(post({ transcript_id: "tr_1" }), { authorize: allow, env: env(KEY), fetch, sleep: () => Promise.resolve() });
  assertEquals(res.status, 502);
  assertEquals(calls, 4);
  await res.body?.cancel();
});

Deno.test("a malformed answer or a different transcript id is 502", async () => {
  for (const response of [ok({ transcript: { ...TRANSCRIPT, id: "other" } }), ok({ transcript: { ...TRANSCRIPT, date: "x", dateString: "nope" } }), () => new Response("not json", { status: 200 })]) {
    const { fetch } = stubFetch([response]);
    const res = await handler(post({ transcript_id: "tr_1" }), { authorize: allow, env: env(KEY), fetch, sleep: () => Promise.resolve() });
    assertEquals(res.status, 502);
    await res.body?.cancel();
  }
});

Deno.test("logs never carry the key or transcript text", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const { fetch } = stubFetch([gqlError("too_many_requests", 429, { "retry-after": "1" }), gqlError("forbidden")]);
    await (await handler(post({ transcript_id: "tr_1" }), { authorize: allow, env: env(KEY), fetch, sleep: () => Promise.resolve() })).body?.cancel();
  } finally {
    console.error = original;
  }
  assert(logged.length > 0);
  for (const line of logged) {
    assert(!line.includes(KEY));
    assert(!line.includes("Kickoff"));
  }
});

Deno.test("classifyTranscriptText", () => {
  assertEquals(classifyTranscriptText("Let's review the hooks."), "clean");
  assertEquals(classifyTranscriptText("Her performance review is Friday."), "personnel");
  assertEquals(classifyTranscriptText("Our lawyer sent the draft."), "legal");
  assertEquals(classifyTranscriptText("The routing number is on file."), "financial");
  assertEquals(classifyTranscriptText("Card 4111 1111 1111 1111"), "financial");
  assertEquals(classifyTranscriptText("The lawyer asked about his salary."), "personnel", "personnel wins");
});
