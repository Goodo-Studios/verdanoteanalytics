// Tests for the run-slack-jobs edge function and _shared/slack-web-api.ts.
//
// Slack is a stubbed fetch and the database is a stand-in JobStore; nothing
// reaches the network. Covered:
//   * the three locks: production project only (409 elsewhere, no database or
//     Slack call), the off-by-default switch, and SLACK_BOT_TOKEN (503 when missing)
//   * the gate runs first
//   * a send is marked before it is posted, and finished with the Slack receipt
//   * rejected, rate-limited and unclear answers: recovery, retry, recovery; an
//     unclear answer is never posted twice
//   * a destination that is no longer confirmed, a bad payload and a stale lease
//     are not posted
//   * the token never reaches a response or a log
//
//   deno test -A supabase/functions/run-slack-jobs/index.test.ts

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSlackWebApi, retryAfterMs, SLACK_API_BASE_URL } from "../_shared/slack-web-api.ts";

Deno.env.set("RUN_SLACK_JOBS_NO_SERVE", "1");
const { handler, isProductionProject, PRODUCTION_PROJECT_REF } = await import("./index.ts");
type Job = { id: string; kind: string; fence: number; payload: Record<string, unknown> };

const TOKEN = "slack-bot-test-token-not-real";
const PROD_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const allow = () => Promise.resolve(null);
const envOf = (vars: Record<string, string | undefined>) => (name: string) => vars[name];
const prodEnv = (extra: Record<string, string | undefined> = {}) =>
  envOf({ SUPABASE_URL: PROD_URL, SLACK_BOT_TOKEN: TOKEN, SUPABASE_SERVICE_ROLE_KEY: "svc", ...extra });

function makeStore(opts: { enabled?: boolean; jobs?: Job[]; confirmed?: boolean; markOk?: boolean; failState?: string } = {}) {
  const log: string[] = [];
  const store = {
    switchEnabled: (name: string) => { log.push(`switch:${name}`); return Promise.resolve(opts.enabled ?? true); },
    enqueueDueReminders: () => { log.push("enqueue"); return Promise.resolve(1); },
    claim: (kinds: string[], owner: string) => { log.push(`claim:${kinds.join(",")}:${owner}`); return Promise.resolve(opts.jobs ?? []); },
    destinationConfirmed: (channel: string, purpose: string) => { log.push(`dest:${channel}:${purpose}`); return Promise.resolve(opts.confirmed ?? true); },
    markSending: (id: string, fence: number) => { log.push(`mark:${id}:${fence}`); return Promise.resolve(opts.markOk ?? true); },
    finish: (id: string, fence: number, _o: string, receipt: Record<string, unknown>) => {
      log.push(`finish:${id}:${fence}:${JSON.stringify(receipt)}`);
      return Promise.resolve(true);
    },
    fail: (id: string, fence: number, _o: string, error: string, retry: number, permanent: boolean) => {
      log.push(`fail:${id}:${fence}:${error}:${retry}:${permanent}`);
      return Promise.resolve(opts.failState ?? (permanent ? "recovery" : "queued"));
    },
  };
  return { store, log };
}

function slackStub(responses: Array<() => Response | Promise<Response>>) {
  const seen: Array<{ url: string; headers: Record<string, string>; body: URLSearchParams }> = [];
  let i = 0;
  const fetch = (input: string, init: RequestInit) => {
    seen.push({ url: input, headers: init.headers as Record<string, string>, body: new URLSearchParams(String(init.body)) });
    return Promise.resolve(responses[Math.min(i++, responses.length - 1)]());
  };
  return { fetch, seen };
}
const slackOk = (ts = "1730000000.000100") => () => new Response(JSON.stringify({ ok: true, ts, channel: "C0TEST" }), { status: 200 });
const slackErr = (error: string) => () => new Response(JSON.stringify({ ok: false, error }), { status: 200 });

const reminder = (id = "j1", fence = 1): Job => ({
  id, kind: "slack.reminder", fence, payload: { channel_id: "C0TEST", purpose: "internal", body: "Test reminder text" },
});
const ownerAlert = (id = "j2", fence = 1): Job => ({ id, kind: "slack.owner_alert", fence, payload: { channel_id: "C0ALERT", text: "Test alert" } });
const post = () => new Request("https://fn.test/run-slack-jobs", { method: "POST", headers: { authorization: "Bearer svc" } });

Deno.test("OPTIONS answers the CORS preflight", async () => {
  const res = await handler(new Request("https://fn.test/x", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  await res.body?.cancel();
});

Deno.test("the real gate refuses a request with no service-role key", async () => {
  const { store, log } = makeStore();
  const res = await handler(new Request("https://fn.test/x", { method: "POST" }), { env: prodEnv(), store });
  assertEquals(res.status, 401);
  assertEquals(log, []);
  await res.body?.cancel();
});

Deno.test("isProductionProject accepts only the production project host", () => {
  assert(isProductionProject(PROD_URL));
  assert(!isProductionProject("https://mnvcksbhbvypuiwozvct.supabase.co"), "staging");
  assert(!isProductionProject(`https://evil.test/${PRODUCTION_PROJECT_REF}.supabase.co`));
  assert(!isProductionProject(`https://${PRODUCTION_PROJECT_REF}.supabase.co.evil.test`));
  assert(!isProductionProject(undefined));
  assert(!isProductionProject("not a url"));
});

Deno.test("staging (or any non-production project) is refused with 409 before any database or Slack call", async () => {
  for (const url of ["https://mnvcksbhbvypuiwozvct.supabase.co", undefined, "http://127.0.0.1:54321"]) {
    const { store, log } = makeStore({ jobs: [reminder()] });
    const { fetch, seen } = slackStub([slackOk()]);
    const res = await handler(post(), { authorize: allow, env: prodEnv({ SUPABASE_URL: url }), store, fetch });
    assertEquals(res.status, 409);
    assertStringIncludes((await res.json()).error, "never run outside the production project");
    assertEquals(log, []);
    assertEquals(seen.length, 0);
  }
});

Deno.test("the switch is off by default: nothing is queued, claimed or posted", async () => {
  const { store, log } = makeStore({ enabled: false, jobs: [reminder()] });
  const { fetch, seen } = slackStub([slackOk()]);
  const res = await handler(post(), { authorize: allow, env: prodEnv(), store, fetch });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.sent, 0);
  assertStringIncludes(body.skipped, "switch is off");
  assertEquals(log, ["switch:slack_sends"]);
  assertEquals(seen.length, 0);
});

Deno.test("fails closed without SLACK_BOT_TOKEN: 503, nothing claimed or posted", async () => {
  for (const token of [undefined, "", "  "]) {
    const { store, log } = makeStore({ jobs: [reminder()] });
    const { fetch, seen } = slackStub([slackOk()]);
    const res = await handler(post(), { authorize: allow, env: prodEnv({ SLACK_BOT_TOKEN: token }), store, fetch });
    assertEquals(res.status, 503);
    assertStringIncludes((await res.json()).error, "SLACK_BOT_TOKEN is not set");
    assertEquals(log, ["switch:slack_sends"]);
    assertEquals(seen.length, 0);
  }
});

Deno.test("a reminder is marked, posted once and finished with the Slack receipt", async () => {
  const { store, log } = makeStore({ jobs: [reminder("j1", 3)] });
  const { fetch, seen } = slackStub([slackOk("123.456")]);
  const res = await handler(post(), { authorize: allow, env: prodEnv(), store, fetch, owner: "w-test" });
  const body = await res.json();
  assertEquals(body.sent, 1);
  assertEquals(body.queued_reminders, 1);
  assertEquals(log, [
    "switch:slack_sends",
    "enqueue",
    "claim:slack.reminder,slack.owner_alert:w-test",
    "dest:C0TEST:internal",
    "mark:j1:3",
    'finish:j1:3:{"channel":"C0TEST","ts":"123.456"}',
  ]);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, `${SLACK_API_BASE_URL}/chat.postMessage`);
  assertEquals(seen[0].headers.authorization, `Bearer ${TOKEN}`);
  assertEquals(seen[0].body.get("channel"), "C0TEST");
  assertEquals(seen[0].body.get("text"), "Test reminder text");
  assertEquals(seen[0].body.get("unfurl_links"), "false");
  assert(!seen[0].body.toString().includes(TOKEN), "the token is not in the body");
  assert(!JSON.stringify(body).includes(TOKEN), "the token is not in the response");
});

Deno.test("an owner alert is checked against an owner_alerts destination", async () => {
  const { store, log } = makeStore({ jobs: [ownerAlert()] });
  const { fetch, seen } = slackStub([slackOk()]);
  await (await handler(post(), { authorize: allow, env: prodEnv(), store, fetch })).body?.cancel();
  assert(log.includes("dest:C0ALERT:owner_alerts"));
  assertEquals(seen[0].body.get("text"), "Test alert");
});

Deno.test("a destination that is no longer confirmed is not posted to", async () => {
  const { store, log } = makeStore({ jobs: [reminder()], confirmed: false });
  const { fetch, seen } = slackStub([slackOk()]);
  const body = await (await handler(post(), { authorize: allow, env: prodEnv(), store, fetch })).json();
  assertEquals(body.recovery, 1);
  assertEquals(seen.length, 0);
  assert(log.some((l) => l.startsWith("fail:j1:1:destination is no longer active and confirmed:0:true")));
  assert(!log.some((l) => l.startsWith("mark:")));
});

Deno.test("a payload without a valid channel or text goes to recovery unposted", async () => {
  for (const payload of [{ channel_id: "#general", body: "x", purpose: "internal" }, { channel_id: "C0TEST", body: "  ", purpose: "internal" }, { body: "x" }]) {
    const { store, log } = makeStore({ jobs: [{ id: "jb", kind: "slack.reminder", fence: 1, payload }] });
    const { fetch, seen } = slackStub([slackOk()]);
    await (await handler(post(), { authorize: allow, env: prodEnv(), store, fetch })).body?.cancel();
    assertEquals(seen.length, 0);
    assert(log.some((l) => l.startsWith("fail:jb:1:payload has no valid channel")));
  }
});

Deno.test("a stale lease is not posted", async () => {
  const { store, log } = makeStore({ jobs: [reminder()], markOk: false });
  const { fetch, seen } = slackStub([slackOk()]);
  const body = await (await handler(post(), { authorize: allow, env: prodEnv(), store, fetch })).json();
  assertEquals(body.stale, 1);
  assertEquals(seen.length, 0);
  assert(!log.some((l) => l.startsWith("finish:") || l.startsWith("fail:")));
});

Deno.test("a Slack rejection goes to recovery with Slack's error code", async () => {
  const { store, log } = makeStore({ jobs: [reminder()] });
  const { fetch } = slackStub([slackErr("channel_not_found")]);
  const body = await (await handler(post(), { authorize: allow, env: prodEnv(), store, fetch })).json();
  assertEquals(body.recovery, 1);
  assert(log.includes("fail:j1:1:slack rejected: channel_not_found:0:true"));
});

Deno.test("a rate limit is retried after Retry-After", async () => {
  const { store, log } = makeStore({ jobs: [reminder()] });
  const { fetch } = slackStub([() => new Response("{}", { status: 429, headers: { "retry-after": "7" } })]);
  const body = await (await handler(post(), { authorize: allow, env: prodEnv(), store, fetch })).json();
  assertEquals(body.retry, 1);
  assert(log.includes("fail:j1:1:slack rate limited:7:false"));
});

Deno.test("an unclear answer goes to recovery and is never posted again in the same run", async () => {
  const cases: Array<() => Response | Promise<Response>> = [
    () => new Response("oops", { status: 503 }),
    slackErr("internal_error"),
    () => new Response("not json", { status: 200 }),
    () => Promise.reject(new TypeError("network")),
  ];
  for (const response of cases) {
    const { store, log } = makeStore({ jobs: [reminder()] });
    const { fetch, seen } = slackStub([response]);
    const body = await (await handler(post(), { authorize: allow, env: prodEnv(), store, fetch })).json();
    assertEquals(body.recovery, 1);
    assertEquals(seen.length, 1, "posted once only");
    assert(log.some((l) => l.startsWith("fail:j1:1:slack outcome unknown:") && l.endsWith(":0:true")));
  }
});

Deno.test("several jobs are handled one by one", async () => {
  const { store, log } = makeStore({ jobs: [reminder("a"), ownerAlert("b"), reminder("c")] });
  const { fetch, seen } = slackStub([slackOk("1"), slackErr("not_in_channel"), slackOk("3")]);
  const body = await (await handler(post(), { authorize: allow, env: prodEnv(), store, fetch })).json();
  assertEquals([body.claimed, body.sent, body.recovery], [3, 2, 1]);
  assertEquals(seen.length, 3);
  assert(log.includes("fail:b:1:slack rejected: not_in_channel:0:true"));
});

Deno.test("logs never carry the token", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const { store } = makeStore({ jobs: [reminder()] });
    const { fetch } = slackStub([slackErr("invalid_auth")]);
    await (await handler(post(), { authorize: allow, env: prodEnv(), store, fetch })).body?.cancel();
  } finally {
    console.error = original;
  }
  for (const line of logged) assert(!line.includes(TOKEN));
});

Deno.test("slack web api: retryAfterMs and token checks", () => {
  assertEquals(retryAfterMs("2"), 2000);
  assertEquals(retryAfterMs(null), 60_000);
  assertEquals(retryAfterMs("nope"), 60_000);
  assertEquals(retryAfterMs("99999"), 3_600_000);
  let threw = false;
  try { createSlackWebApi({ token: "  " }); } catch { threw = true; }
  assert(threw, "an empty token is refused");
  assertEquals(JSON.stringify(createSlackWebApi({ token: TOKEN })), JSON.stringify({ baseUrl: SLACK_API_BASE_URL }));
});
