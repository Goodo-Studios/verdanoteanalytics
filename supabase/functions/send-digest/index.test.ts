// Tests for send-digest (weekly performance email for the signed-in user).
//
// No database and no network: the Supabase client is a fake and fetch is stubbed. Covered:
//   * the gate: no bearer token, or a token that does not resolve, is 401 and nothing is read
//   * a user with the digest switched off, or no profile email, is refused with 400
//   * a client login only gets accounts linked to it, even when its saved preferences name
//     others or leave the list empty (the function reads with the service role)
//   * staff may digest any account
//   * the missing-key path: with no RESEND_API_KEY nothing is sent, the HTML comes back with a
//     plain note, and no outside request is made
//   * with the key set the email goes to the profile address; a refusal from the mail service is
//     a 500 that does not mark the digest as sent; preview mode never sends or marks it sent
//
//   deno test -A supabase/functions/send-digest/index.test.ts

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeCreateClient, fakeSupabase, type FakeConfig, withEnv, withFetch } from "../_shared/fake-supabase.ts";

Deno.env.set("SEND_DIGEST_NO_SERVE", "1");
const { handler } = await import("./index.ts");

const ENV = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_ANON_KEY: "anon-for-tests",
  SUPABASE_SERVICE_ROLE_KEY: "service-for-tests",
  RESEND_API_KEY: undefined as string | undefined,
};

const PREFS = { digest_enabled: true, digest_day: "monday", digest_accounts: [] as string[], last_digest_sent_at: null };
const PROFILE = { email: "person@staging.test", display_name: "Person" };
const ACCOUNTS = [
  { id: "act_mine", name: "Mine Skincare", logo_url: null },
  { id: "act_other", name: "Someone Elses Brand", logo_url: null },
];

function cfg(over: { role?: string; prefs?: Record<string, unknown> | null; profile?: unknown; links?: string[] } & FakeConfig = {}): FakeConfig {
  return {
    user: over.user === undefined ? { id: "u1" } : over.user,
    rpc: { get_user_role: over.role ?? "employee" },
    tables: {
      user_preferences: over.prefs === null ? [] : [{ ...PREFS, ...(over.prefs ?? {}) }],
      profiles: over.profile === null ? [] : [over.profile ?? PROFILE],
      ad_accounts: ACCOUNTS,
      user_accounts: (over.links ?? []).map((account_id) => ({ account_id })),
      creative_daily_metrics: [{ spend: 100, roas: 2, ad_id: "a1" }],
      creatives: [{ ad_name: "Top Ad", thumbnail_url: null, roas: 3 }],
    },
  };
}

async function call(
  opts: { auth?: string | null; body?: unknown; cfg?: FakeConfig; resend?: string; mail?: Response } = {},
) {
  const db = fakeSupabase(opts.cfg ?? cfg());
  const { createClient, calls: clientCalls } = fakeCreateClient(db);
  const headers: Record<string, string> = {};
  if (opts.auth !== null) headers.authorization = opts.auth ?? "Bearer user-token";
  const req = new Request("http://x/send-digest", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
  let res!: Response;
  let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  await withEnv({ ...ENV, RESEND_API_KEY: opts.resend }, () =>
    withFetch(
      () => opts.mail ?? new Response(JSON.stringify({ id: "email_1" }), { status: 200 }),
      async (calls) => {
        res = await handler(req, { createClient });
        fetchCalls = calls;
      },
    ));
  return { res, db, clientCalls, fetchCalls };
}

const sentMarks = (db: ReturnType<typeof fakeSupabase>) =>
  db.writes().filter((w) => w.table === "user_preferences" && w.verb === "update");

Deno.test("OPTIONS is the CORS preflight", async () => {
  const res = await handler(new Request("http://x", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  assert(res.headers.get("Access-Control-Allow-Origin"));
});

Deno.test("no bearer token is 401 and no client is created", async () => {
  const { res, clientCalls } = await call({ auth: null });
  assertEquals(res.status, 401);
  assertEquals(clientCalls.length, 0);
  const { res: res2, clientCalls: c2 } = await call({ auth: "Basic abc" });
  assertEquals(res2.status, 401);
  assertEquals(c2.length, 0);
});

Deno.test("a token that does not resolve to a user is 401 and nothing is read", async () => {
  const { res, db } = await call({ cfg: cfg({ user: null }) });
  assertEquals(res.status, 401);
  assertEquals(db.ops.length, 0);
});

Deno.test("the caller's own token is checked with the anon key, and the service key is only used for data", async () => {
  const { clientCalls } = await call({ body: { preview: true } });
  assertEquals(clientCalls.length, 2);
  assertEquals(clientCalls[0].key, "anon-for-tests");
  assertEquals(clientCalls[1].key, "service-for-tests");
});

Deno.test("digest switched off is 400 and nothing is sent", async () => {
  const { res, fetchCalls, db } = await call({ cfg: cfg({ prefs: { digest_enabled: false } }), resend: "re_test" });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Digest is disabled for this user");
  assertEquals(fetchCalls.length, 0);
  assertEquals(sentMarks(db).length, 0);
});

Deno.test("no preferences row counts as switched off", async () => {
  const { res } = await call({ cfg: cfg({ prefs: null }) });
  assertEquals(res.status, 400);
});

Deno.test("a profile with no email is 400", async () => {
  const { res, fetchCalls } = await call({ cfg: cfg({ profile: { email: null } }), resend: "re_test" });
  assertEquals(res.status, 400);
  assertEquals(fetchCalls.length, 0);
});

Deno.test("a client login only gets its linked accounts when its preferences name another", async () => {
  const { res } = await call({
    cfg: cfg({ role: "client", links: ["act_mine"], prefs: { digest_accounts: ["act_mine", "act_other"] } }),
    body: { preview: true },
  });
  assertEquals(res.status, 200);
  const { html } = await res.json();
  assertStringIncludes(html, "Mine Skincare");
  assert(!html.includes("Someone Elses Brand"));
});

Deno.test("a client login with an empty account list (all) still only gets its linked accounts", async () => {
  const { res } = await call({ cfg: cfg({ role: "client", links: ["act_mine"] }), body: { preview: true } });
  const { html } = await res.json();
  assertStringIncludes(html, "Mine Skincare");
  assert(!html.includes("Someone Elses Brand"));
});

Deno.test("a client login with no linked account gets 400 and nothing is sent", async () => {
  const { res, fetchCalls } = await call({ cfg: cfg({ role: "client", links: [] }), resend: "re_test" });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "No accounts selected for digest");
  assertEquals(fetchCalls.length, 0);
});

Deno.test("staff may digest any account", async () => {
  const { res } = await call({ cfg: cfg({ role: "employee" }), body: { preview: true } });
  const { html } = await res.json();
  assertStringIncludes(html, "Mine Skincare");
  assertStringIncludes(html, "Someone Elses Brand");
});

Deno.test("no RESEND_API_KEY: nothing is sent, the HTML comes back with a note, no outside request", async () => {
  const { res, fetchCalls, db } = await call({ resend: undefined });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  assertStringIncludes(body.note, "No RESEND_API_KEY configured");
  assert(typeof body.html === "string" && body.html.length > 0);
  assertEquals(fetchCalls.length, 0);
  // Today the function still marks the digest as sent in this case. Pinned so a change is deliberate.
  assertEquals(sentMarks(db).length, 1);
});

Deno.test("with the key set the email goes to the profile address and is marked sent", async () => {
  const { res, fetchCalls, db } = await call({ resend: "re_test_key" });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.emailId, "email_1");
  assertEquals(fetchCalls.length, 1);
  assertEquals(fetchCalls[0].url, "https://api.resend.com/emails");
  const sent = JSON.parse(String(fetchCalls[0].init?.body));
  assertEquals(sent.to, ["person@staging.test"]);
  assertEquals(sentMarks(db).length, 1);
  // The key is never echoed back to the caller.
  assert(!JSON.stringify(body).includes("re_test_key"));
});

Deno.test("a refusal from the mail service is a 500 and the digest is not marked sent", async () => {
  const { res, db } = await call({
    resend: "re_test_key",
    mail: new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 }),
  });
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "Failed to send email");
  assertEquals(sentMarks(db).length, 0);
});

Deno.test("preview mode never sends and never marks the digest as sent", async () => {
  const { res, fetchCalls, db } = await call({ resend: "re_test_key", body: { preview: true } });
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(body.html && body.subject);
  assertEquals(fetchCalls.length, 0);
  assertEquals(sentMarks(db).length, 0);
});
