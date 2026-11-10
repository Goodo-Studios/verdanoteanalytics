// Tests for the meeting-recaps edge function and _shared/meeting-recaps.ts.
//
// Fireflies and the model are one stubbed fetch, routed by URL; the database is an
// in-memory store. Nothing reaches the network. Covered:
//   * gate (401 passthrough; client, no role, service role 403) before any read
//   * input checks, fail-closed 503 without either key (no request, no read)
//   * unknown client, engagement of another client
//   * unavailable (not found, no access, processing) and quarantined outcomes are
//     recorded without content and without a model call
//   * the model gets only clean excerpts, structured output and the key header;
//     only grounded candidates with exact quotes are kept, with hashes
//   * model refusal / bad output recorded as failed; a rejected key is a 503
//   * validateRecapCandidates, recapItemHash, stripJsonFence, citationSpan
//
//   deno test -A supabase/functions/meeting-recaps/index.test.ts

import { assert, assertEquals, assertMatch, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ANTHROPIC_URL,
  citationSpan,
  DEFAULT_RECAP_MODEL,
  MAX_CANDIDATES,
  type RecapExcerpt,
  recapItemHash,
  stripJsonFence,
  validateRecapCandidates,
} from "../_shared/meeting-recaps.ts";
import { FIREFLIES_API_URL } from "../_shared/fireflies.ts";
import type { Caller } from "../_shared/internal-auth.ts";

Deno.env.set("MEETING_RECAPS_NO_SERVE", "1");
const { handler } = await import("./index.ts");

const STAFF: Caller = { kind: "user", isStaff: true, userId: "00000000-0000-4000-8000-0000000000e1", roles: ["employee"] };
const KEYS: Record<string, string> = { FIREFLIES_API_KEY: "ff-test-not-real", ANTHROPIC_API_KEY: "model-test-not-real" };
const ENGAGEMENT = "11111111-1111-4111-8111-111111111111";

const TRANSCRIPT = {
  id: "tr_1",
  date: Date.parse("2026-11-02T15:00:00Z"),
  organizer_email: "owner@example.test",
  participants: ["a@example.test"],
  is_live: false,
  sentences: [
    { index: 0, speaker_id: 1, speaker_name: "Pat", text: "We agreed on three hooks.", start_time: "0", end_time: "3" },
    { index: 1, speaker_id: 1, speaker_name: "Pat", text: "Sam will send the brief by 2026-11-20.", start_time: "3", end_time: "6" },
    { index: 2, speaker_id: 2, speaker_name: "Sam", text: "We need to talk about his salary later.", start_time: "6", end_time: "9" },
    { index: 3, speaker_id: 1, speaker_name: "Pat", text: "Who approves the script?", start_time: "9", end_time: "11" },
  ],
};

type ModelReply = (excerpts: RecapExcerpt[]) => Response;
const modelJson = (candidates: unknown[]) => (_: RecapExcerpt[]) =>
  new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ candidates }) }] }), { status: 200 });

function stubFetch(fireflies: () => Response, model?: ModelReply) {
  const seen: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetch = (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    seen.push({ url, headers: init.headers as Record<string, string>, body });
    if (url === FIREFLIES_API_URL) return Promise.resolve(fireflies());
    if (url === ANTHROPIC_URL && model) {
      const text = String((body.messages as Array<{ content: string }>)[0].content);
      const excerpts = JSON.parse(text.slice(text.indexOf("\n") + 1)) as RecapExcerpt[];
      return Promise.resolve(model(excerpts));
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  };
  return { fetch, seen };
}
const ffOk = (transcript: unknown = TRANSCRIPT) => () => new Response(JSON.stringify({ data: { transcript } }), { status: 200 });

function memoryStore(clients = ["glow"], engagements: Record<string, string> = { [ENGAGEMENT]: "glow" }) {
  const recorded: Array<{ recap: Record<string, unknown>; items: Record<string, unknown>[] }> = [];
  let reads = 0;
  return {
    recorded,
    reads: () => reads,
    store: {
      clientExists: (s: string) => (reads++, Promise.resolve(clients.includes(s))),
      engagementClient: (id: string) => (reads++, Promise.resolve(engagements[id] ?? null)),
      record: (recap: Record<string, unknown>, items: Record<string, unknown>[]) => {
        recorded.push({ recap, items });
        return Promise.resolve(`recap-${recorded.length}`);
      },
    },
  };
}

function post(body: unknown) {
  return new Request("https://fn.test/meeting-recaps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function run(body: unknown, opts: { caller?: Caller | Response; env?: Record<string, string>; fireflies?: () => Response; model?: ModelReply; mem?: ReturnType<typeof memoryStore> } = {}) {
  const mem = opts.mem ?? memoryStore();
  const { fetch, seen } = stubFetch(opts.fireflies ?? ffOk(), opts.model);
  const env = opts.env ?? KEYS;
  const res = await handler(post(body), {
    resolveCaller: () => Promise.resolve(opts.caller ?? STAFF),
    env: (n) => env[n],
    fetch,
    sleep: () => Promise.resolve(),
    store: mem.store,
  });
  return { res, json: await res.json(), seen, mem };
}

const GOOD = { client_slug: "glow", transcript_id: "tr_1" };

Deno.test("OPTIONS is the CORS preflight; GET is refused", async () => {
  const pre = await handler(new Request("https://fn.test", { method: "OPTIONS" }));
  assertEquals(pre.status, 200);
  await pre.body?.cancel();
  const get = await handler(new Request("https://fn.test", { method: "GET" }), { resolveCaller: () => Promise.resolve(STAFF) });
  assertEquals(get.status, 405);
  await get.body?.cancel();
});

Deno.test("the resolver's 401 is passed through before anything else", async () => {
  const r = await run(GOOD, { caller: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) });
  assertEquals(r.res.status, 401);
  assertEquals(r.seen.length, 0);
  assertEquals(r.mem.reads(), 0);
});

for (const [label, caller] of [
  ["client", { kind: "user", isStaff: false, userId: "c1", roles: ["client"] }],
  ["no role", { kind: "user", isStaff: false, userId: "c2", roles: [] }],
  ["service role", { kind: "service", isStaff: true, userId: null }],
] as Array<[string, Caller]>) {
  Deno.test(`${label} is refused with 403, with no request and no read`, async () => {
    const r = await run(GOOD, { caller });
    assertEquals(r.res.status, 403);
    assertEquals(r.seen.length, 0);
    assertEquals(r.mem.reads(), 0);
    assertEquals(r.mem.recorded.length, 0);
  });
}

Deno.test("input checks", async () => {
  for (const body of [{}, { client_slug: "glow" }, { client_slug: "bad slug!", transcript_id: "tr_1" }, { client_slug: "glow", transcript_id: "a/b" }, { ...GOOD, engagement_id: "nope" }]) {
    const r = await run(body);
    assertEquals(r.res.status, 400, JSON.stringify(body));
    assertEquals(r.seen.length, 0);
  }
});

Deno.test("fails closed without either key: 503, no request, no read", async () => {
  for (const env of [{ ANTHROPIC_API_KEY: "x" }, { FIREFLIES_API_KEY: "x" }, { FIREFLIES_API_KEY: "  ", ANTHROPIC_API_KEY: "x" }]) {
    const r = await run(GOOD, { env });
    assertEquals(r.res.status, 503);
    assertStringIncludes(r.json.error, "is not set");
    assertEquals(r.seen.length, 0);
    assertEquals(r.mem.reads(), 0);
  }
});

Deno.test("unknown client is 404 and an engagement of another client is 400, with no request", async () => {
  const unknown = await run({ ...GOOD, client_slug: "other" });
  assertEquals(unknown.res.status, 404);
  assertEquals(unknown.seen.length, 0);
  const foreign = await run({ ...GOOD, engagement_id: ENGAGEMENT }, { mem: memoryStore(["glow"], { [ENGAGEMENT]: "other" }) });
  assertEquals(foreign.res.status, 400);
  assertEquals(foreign.seen.length, 0);
});

Deno.test("transcript not found / no access / processing: recorded as unavailable with no content and no model call", async () => {
  const cases: Array<[() => Response, string]> = [
    [() => new Response(JSON.stringify({ data: { transcript: null } }), { status: 200 }), "not_found"],
    [() => new Response(JSON.stringify({ errors: [{ message: "x", extensions: { code: "forbidden" } }] }), { status: 200 }), "access_denied"],
    [ffOk({ ...TRANSCRIPT, is_live: true }), "processing"],
  ];
  for (const [fireflies, evidence] of cases) {
    const r = await run(GOOD, { fireflies, model: modelJson([]) });
    assertEquals(r.res.status, 200);
    assertEquals(r.json.status, "unavailable");
    assertEquals(r.mem.recorded[0].recap.evidence_status, evidence);
    assertEquals(r.mem.recorded[0].items, []);
    assert(!r.seen.some((s) => s.url === ANTHROPIC_URL), "no model call");
  }
});

Deno.test("every excerpt withheld: quarantined, nothing sent to the model", async () => {
  const onlySalary = { ...TRANSCRIPT, sentences: [TRANSCRIPT.sentences[2]] };
  const r = await run(GOOD, { fireflies: ffOk(onlySalary), model: modelJson([]) });
  assertEquals(r.json.status, "quarantined");
  assertEquals(r.mem.recorded[0].recap.withheld_excerpts, 1);
  assert(!r.seen.some((s) => s.url === ANTHROPIC_URL));
});

Deno.test("prepared: only clean excerpts go to the model and only grounded candidates are kept", async () => {
  const model: ModelReply = (ex) => {
    const pat = ex.find((e) => e.text.includes("three hooks"))!;
    const q = ex.find((e) => e.text.includes("Who approves"))!;
    return modelJson([
      { kind: "decision", summary: "Three hooks agreed", citations: [{ excerptId: pat.excerptId, quote: "We agreed on three hooks." }], date: { status: "missing", text: null, value: null }, missingInformation: [], proposedAction: null },
      { kind: "action", summary: "Sam sends the brief by 2026-11-20", citations: [{ excerptId: pat.excerptId, quote: "Sam will send the brief by 2026-11-20." }], date: { status: "stated", text: "2026-11-20", value: "2026-11-20" }, missingInformation: [], proposedAction: "set_due_date" },
      { kind: "question", summary: "Who approves the script?", citations: [{ excerptId: q.excerptId, quote: "Who approves the script?" }], date: { status: "missing", text: null, value: null }, missingInformation: ["approval_owner"], proposedAction: null },
      { kind: "decision", summary: "Budget is 5000", citations: [{ excerptId: pat.excerptId, quote: "a quote nobody said" }], date: { status: "missing", text: null, value: null }, missingInformation: [], proposedAction: null },
    ])(ex);
  };
  const r = await run({ ...GOOD, engagement_id: ENGAGEMENT }, { model });
  assertEquals(r.res.status, 200);
  assertEquals(r.json.status, "prepared");
  assertEquals(r.json.items, 3);
  const call = r.seen.find((s) => s.url === ANTHROPIC_URL)!;
  assertEquals(call.headers["x-api-key"], KEYS.ANTHROPIC_API_KEY);
  assertEquals(call.body.model, DEFAULT_RECAP_MODEL);
  assertEquals((call.body.output_config as { format: { type: string } }).format.type, "json_schema");
  assert(!JSON.stringify(call.body).includes("salary"), "withheld text is never sent");
  const { recap, items } = r.mem.recorded[0];
  assertEquals(recap.requested_by, STAFF.userId);
  assertEquals(recap.engagement_id, ENGAGEMENT);
  assertEquals(recap.rejected_candidates, 1);
  assertEquals(recap.withheld_excerpts, 1);
  assertMatch(String(recap.source_version), /^fireflies-v1-/);
  assertEquals(items.map((i) => i.kind), ["decision", "action", "question"]);
  const action = items[1] as { date_status: string; date_value: string; proposed_action: string; citations: Array<{ quote: string; speaker: string }>; item_hash: string };
  assertEquals([action.date_status, action.date_value, action.proposed_action], ["stated", "2026-11-20", "set_due_date"]);
  assertEquals(action.citations[0].quote, "Sam will send the brief by 2026-11-20.");
  assertEquals(action.citations[0].speaker, "Pat");
  assertMatch(action.item_hash, /^[0-9a-f]{64}$/);
  assertStringIncludes(String(recap.limitation), "1 excerpt(s) were withheld");
});

Deno.test("ANTHROPIC_RECAP_MODEL overrides the model", async () => {
  const r = await run(GOOD, { env: { ...KEYS, ANTHROPIC_RECAP_MODEL: "claude-opus-5-5" }, model: modelJson([]) });
  assertEquals(r.seen.find((s) => s.url === ANTHROPIC_URL)!.body.model, "claude-opus-5-5");
  assertEquals(r.mem.recorded[0].recap.model, "claude-opus-5-5");
});

Deno.test("a model refusal or bad output is recorded as failed without content", async () => {
  const refusal: ModelReply = () => new Response(JSON.stringify({ stop_reason: "refusal", content: [] }), { status: 200 });
  const garbage: ModelReply = () => new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }), { status: 200 });
  for (const model of [refusal, garbage]) {
    const r = await run(GOOD, { model });
    assertEquals(r.json.status, "failed");
    assertEquals(r.mem.recorded[0].items, []);
  }
});

Deno.test("a rejected model key or Fireflies key is a 503 and nothing is recorded", async () => {
  const r = await run(GOOD, { model: () => new Response("{}", { status: 401 }) });
  assertEquals(r.res.status, 503);
  assertEquals(r.mem.recorded.length, 0);
  const ff = await run(GOOD, { fireflies: () => new Response("{}", { status: 401 }) });
  assertEquals(ff.res.status, 503);
  assertEquals(ff.mem.recorded.length, 0);
});

// ── rules ──────────────────────────────────────────────────────────────────────

const EX: RecapExcerpt[] = [{ excerptId: "e1", speaker: "Pat", startedAt: "2026-11-02T15:00:00Z", text: "We will ship 3 ads next week. Budget stays." }];
const cite = (quote: string) => [{ excerptId: "e1", ...citationSpan(EX, "e1", quote) }];

Deno.test("validateRecapCandidates: numbers must be in the quote, actions only on actions, vague dates uncertain", () => {
  const { accepted, rejected } = validateRecapCandidates([
    { kind: "action", summary: "Ship 3 ads", citations: cite("We will ship 3 ads next week."), date: { status: "uncertain", text: "next week" }, proposedAction: "set_due_date" },
    { kind: "action", summary: "Ship 4 ads", citations: cite("We will ship 3 ads next week.") },
    { kind: "decision", summary: "Budget stays", citations: cite("Budget stays."), proposedAction: "add_internal_note" },
    { kind: "call", summary: "Book a call", citations: cite("Budget stays.") },
    { kind: "decision", summary: "Budget stays", citations: [{ excerptId: "e9", start: 0, end: 3 }] },
    { kind: "decision", summary: "Budget stays", citations: [{ excerptId: "e1", start: 0, end: 999 }] },
    { kind: "decision", summary: "Budget stays", citations: [] },
  ], EX);
  assertEquals(accepted.length, 1);
  assertEquals(accepted[0].dateStatus, "uncertain");
  assertEquals(accepted[0].proposedAction, "add_internal_note");
  assertEquals(accepted[0].missingInformation, ["due_date"]);
  assertEquals(rejected.map((r) => r.reason), ["ungrounded_detail", "action_not_allowed", "kind_not_allowed", "citation_not_authorized", "citation_span_invalid", "citation_missing"]);
});

Deno.test("validateRecapCandidates caps the number of candidates", () => {
  const many = Array.from({ length: MAX_CANDIDATES + 2 }, () => ({ kind: "decision", summary: "Budget stays", citations: cite("Budget stays.") }));
  const { accepted, rejected } = validateRecapCandidates(many, EX);
  assertEquals(accepted.length, MAX_CANDIDATES);
  assertEquals(rejected.length, 2);
  assertEquals(validateRecapCandidates("nope", EX).accepted, []);
});

Deno.test("recapItemHash is stable and changes with the content", async () => {
  const draft = validateRecapCandidates([{ kind: "decision", summary: "Budget stays", citations: cite("Budget stays.") }], EX).accepted[0];
  const a = await recapItemHash("tr_1", "v1", 0, draft);
  assertEquals(a, await recapItemHash("tr_1", "v1", 0, { ...draft }));
  assert(a !== await recapItemHash("tr_1", "v2", 0, draft));
  assert(a !== await recapItemHash("tr_1", "v1", 0, { ...draft, summary: "Budget stays the same" }));
});

Deno.test("stripJsonFence and citationSpan", () => {
  assertEquals(stripJsonFence('```json\n{"a":1}\n```'), '{"a":1}');
  assertEquals(stripJsonFence('{"a":1}'), '{"a":1}');
  assertEquals(citationSpan(EX, "e1", "Budget stays."), { excerptId: "e1", start: 30, end: 43 });
  assertEquals(citationSpan(EX, "e1", "not there").start, -1);
  assertEquals(citationSpan(EX, 5, "x").excerptId, null);
});
