// Tests for the invite-user edge function (invites that send, phase 4 PR 2).
//
// The Supabase Auth admin calls are a stand-in: no invite and no email is ever sent from a test.
// The database is an in-memory store that records every write.
// Covered:
//   * the gate: only a builder; the gate runs before the body is read
//   * validation, with plain messages and no admin call
//   * an invite goes through inviteUserByEmail (no password anywhere), gives the role, name and
//     client, and is logged with who invited
//   * already has a login / already invited / a stale open invite
//   * email service errors, and a login set-up failure after the email went out
//   * resend (wait a minute, revoked, accepted, login gone) and revoke (accepted, delete failure)
//   * the real store talks to the right tables
//
//   deno test -A supabase/functions/invite-user/index.test.ts

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("INVITE_USER_NO_SERVE", "1");
const { handler, supabaseStore } = await import("./index.ts");
type Store = Parameters<typeof handler>[1] extends infer D ? NonNullable<D> extends { store?: () => infer S } ? S : never : never;

const BUILDER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-12T12:00:00Z");
const ID = "22222222-2222-4222-8222-222222222222";
const LOGIN = "33333333-3333-4333-8333-333333333333";

const user = (roles: string[]) => () =>
  Promise.resolve({ kind: "user" as const, userId: BUILDER, roles, isStaff: roles.includes("builder") || roles.includes("employee") });
const service = () => Promise.resolve({ kind: "service" as const, isStaff: true as const, userId: null });

interface InviteRow {
  id: string; email: string; display_name: string; role: string; client_slug: string | null; invited_user_id: string | null;
  invited_by: string; status: "sent" | "revoked"; sent_count: number; created_at: string; last_sent_at: string;
}
const row = (over: Partial<InviteRow> = {}): InviteRow => ({
  id: ID, email: "pat@example.test", display_name: "Pat", role: "employee", client_slug: null, invited_user_id: LOGIN,
  invited_by: BUILDER, status: "sent", sent_count: 1, created_at: "2026-11-01T09:00:00Z", last_sent_at: "2026-11-01T09:00:00Z", ...over,
});

interface World {
  login?: { userId: string; confirmed: boolean } | null;
  open?: InviteRow | null;
  invite?: InviteRow | null;
  clients?: string[];
  failGrant?: boolean;
  inviteResult?: { data: { user: { id: string } | null } | null; error: { message: string; status?: number; code?: string } | null };
  deleteError?: { message: string; status?: number; code?: string } | null;
}

function setup(w: World = {}) {
  const log: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const invites: { email: string; options: Record<string, unknown> }[] = [];
  const deleted: string[] = [];
  const store = {
    loginState: () => Promise.resolve(w.login ?? null),
    clientExists: (slug: string) => Promise.resolve((w.clients ?? ["glow"]).includes(slug)),
    findOpenInvite: () => Promise.resolve(w.open ?? null),
    getInvite: () => Promise.resolve(w.invite ?? null),
    insertInvite: (r: Record<string, unknown>) => {
      inserted.push(r);
      return Promise.resolve(row({ ...(r as Partial<InviteRow>), id: ID }));
    },
    markResent: (id: string) => { log.push(`resent ${id}`); return Promise.resolve(); },
    markRevoked: (id: string) => { log.push(`revoked ${id}`); return Promise.resolve(); },
    grantRole: (_u: string, role: string) => {
      if (w.failGrant) return Promise.reject(new Error("db down"));
      log.push(`role ${role}`);
      return Promise.resolve();
    },
    setDisplayName: (_u: string, name: string) => { log.push(`name ${name}`); return Promise.resolve(); },
    linkMember: (_u: string, slug: string) => { log.push(`member ${slug}`); return Promise.resolve(); },
  };
  const admin = {
    inviteUserByEmail: (email: string, options: Record<string, unknown>) => {
      invites.push({ email, options });
      return Promise.resolve(w.inviteResult ?? { data: { user: { id: LOGIN } }, error: null });
    },
    deleteUser: (id: string) => { deleted.push(id); return Promise.resolve({ error: w.deleteError ?? null }); },
  };
  const call = async (body: unknown, roles: string[] = ["builder"]) => {
    const res = await handler(
      new Request("http://x/", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
      { resolveCaller: user(roles), store: () => store as never, admin: () => admin, now: () => NOW },
    );
    return { status: res.status, json: await res.json() };
  };
  return { call, log, inserted, invites, deleted };
}

const INVITE = { action: "invite", email: "  Pat@Example.test ", display_name: " Pat Lee ", role: "employee" };

// ── the gate ────────────────────────────────────────────────────────────────

Deno.test("only a builder gets past the gate, before the body is read", async () => {
  for (const roles of [["client"], ["employee"], []]) {
    const s = setup();
    const r = await s.call("not json", roles);
    assertEquals(r.status, 403, roles.join(","));
    assertEquals(s.invites.length, 0);
  }
  const res = await handler(new Request("http://x/", { method: "POST", body: "{}" }), { resolveCaller: service });
  assertEquals(res.status, 403);
});

Deno.test("no login: the 401 from the gate is returned, and only POST is served", async () => {
  const unauthorized = () => Promise.resolve(new Response("{}", { status: 401 }));
  assertEquals((await handler(new Request("http://x/", { method: "POST", body: "{}" }), { resolveCaller: unauthorized })).status, 401);
  assertEquals((await handler(new Request("http://x/", { method: "GET" }), { resolveCaller: user(["builder"]) })).status, 405);
});

// ── validation ──────────────────────────────────────────────────────────────

Deno.test("bad input is refused in plain words and nothing is sent", async () => {
  const cases: [unknown, number, string][] = [
    ["not json", 400, "JSON object"],
    [[], 400, "JSON object"],
    [{ action: "send" }, 400, "invite, resend or revoke"],
    [{ ...INVITE, email: "not-an-email" }, 400, "valid email"],
    [{ ...INVITE, email: undefined }, 400, "valid email"],
    [{ ...INVITE, display_name: "  " }, 400, "name"],
    [{ ...INVITE, display_name: "x".repeat(121) }, 400, "name"],
    [{ ...INVITE, role: "owner" }, 400, "Builder, Employee or Client"],
    [{ ...INVITE, role: "client" }, 400, "which client"],
    [{ ...INVITE, role: "employee", client_slug: "glow" }, 400, "Only client logins"],
    [{ ...INVITE, role: "client", client_slug: "nope" }, 404, "find that client"],
    [{ action: "resend", invite_id: "x" }, 400, "Choose an invite"],
    [{ action: "revoke" }, 400, "Choose an invite"],
  ];
  for (const [body, status, text] of cases) {
    const s = setup();
    const r = await s.call(body);
    assertEquals(r.status, status, JSON.stringify(body));
    assertStringIncludes(r.json.error, text);
    assertEquals(s.invites.length, 0);
    assertEquals(s.log.length, 0);
  }
});

// ── invite ──────────────────────────────────────────────────────────────────

Deno.test("a staff invite uses the standard invite: no password, clean email and name, role granted, logged with who invited", async () => {
  const s = setup();
  const r = await s.call({ ...INVITE, redirect_origin: "https://app.example.test" });
  assertEquals(r.status, 200);
  assertEquals(s.invites.length, 1);
  assertEquals(s.invites[0].email, "pat@example.test");
  assertEquals(s.invites[0].options, { data: { display_name: "Pat Lee" }, redirectTo: "https://app.example.test/update-password" });
  assert(!JSON.stringify(s.invites[0]).toLowerCase().includes("password\":"));
  assertEquals(s.log, ["role employee", "name Pat Lee"]);
  assertEquals(s.inserted, [{
    email: "pat@example.test", display_name: "Pat Lee", role: "employee", client_slug: null, invited_user_id: LOGIN, invited_by: BUILDER,
  }]);
  assertEquals(r.json.invite.email, "pat@example.test");
  assertEquals("invited_user_id" in r.json.invite, false);
});

Deno.test("a client invite links the login to its client", async () => {
  const s = setup();
  const r = await s.call({ ...INVITE, role: "client", client_slug: "glow" });
  assertEquals(r.status, 200);
  assertEquals(s.log, ["role client", "name Pat Lee", "member glow"]);
  assertEquals(s.inserted[0].client_slug, "glow");
});

Deno.test("a redirect origin that is not a plain origin is ignored", async () => {
  for (const origin of ["javascript:alert(1)", "https://x.test/evil/path", "https://x.test?next=1", "x.test", 5]) {
    const s = setup();
    await s.call({ ...INVITE, redirect_origin: origin });
    assertEquals("redirectTo" in s.invites[0].options, false, String(origin));
  }
});

Deno.test("an email that already has a login is refused and nothing is sent", async () => {
  const s = setup({ login: { userId: LOGIN, confirmed: true } });
  const r = await s.call(INVITE);
  assertEquals(r.status, 409);
  assertEquals(r.json.code, "already_has_login");
  assertStringIncludes(r.json.error, "pat@example.test already has a login");
  assertEquals(s.invites.length, 0);
  const unused = setup({ login: { userId: LOGIN, confirmed: false } });
  assertEquals((await unused.call(INVITE)).json.code, "already_has_login");
});

Deno.test("an email that is already invited says when, and points at Resend", async () => {
  const s = setup({ login: { userId: LOGIN, confirmed: false }, open: row() });
  const r = await s.call(INVITE);
  assertEquals(r.status, 409);
  assertEquals(r.json.code, "already_invited");
  assertStringIncludes(r.json.error, "already invited on Nov 1, 2026");
  assertStringIncludes(r.json.error, "Resend");
  assertEquals(s.invites.length, 0);
});

Deno.test("an open invite whose login is gone is closed and a new invite goes out", async () => {
  const s = setup({ login: null, open: row() });
  const r = await s.call(INVITE);
  assertEquals(r.status, 200);
  assertEquals(s.log[0], `revoked ${ID}`);
  assertEquals(s.invites.length, 1);
});

Deno.test("the email service limiting sends is a plain 429 and nothing is written", async () => {
  const s = setup({ inviteResult: { data: null, error: { message: "rate limit for pat@example.test", status: 429, code: "over_email_send_rate_limit" } } });
  const r = await s.call(INVITE);
  assertEquals(r.status, 429);
  assertStringIncludes(r.json.error, "Wait a few minutes");
  assert(!JSON.stringify(r.json).includes("pat@example.test"));
  assertEquals(s.log.length + s.inserted.length, 0);
});

Deno.test("Auth saying the email exists is the plain already-has-a-login answer", async () => {
  const s = setup({ inviteResult: { data: null, error: { message: "exists", status: 422, code: "email_exists" } } });
  const r = await s.call(INVITE);
  assertEquals(r.status, 409);
  assertEquals(r.json.code, "already_has_login");
});

Deno.test("another send failure is a 502 that does not echo the provider's message", async () => {
  const s = setup({ inviteResult: { data: null, error: { message: "smtp: 535 credentials for pat@example.test", status: 500 } } });
  const r = await s.call(INVITE);
  assertEquals(r.status, 502);
  assertStringIncludes(r.json.error, "could not be sent");
  assert(!JSON.stringify(r.json).includes("smtp"));
  const none = setup({ inviteResult: { data: { user: null }, error: null } });
  assertEquals((await none.call(INVITE)).status, 502);
  assertEquals(none.log.length, 0);
});

Deno.test("if the login cannot be set up after the email went out, the half-made login is removed", async () => {
  const s = setup({ failGrant: true });
  const r = await s.call(INVITE);
  assertEquals(r.status, 500);
  assertEquals(r.json.code, "setup_failed");
  assertStringIncludes(r.json.error, "so it was removed");
  assertEquals(s.deleted, [LOGIN]);
  assertEquals(s.inserted.length, 0);
  const stuck = setup({ failGrant: true, deleteError: { message: "nope", status: 500 } });
  assertEquals((await stuck.call(INVITE)).status, 500);
});

// ── resend ──────────────────────────────────────────────────────────────────

Deno.test("resend sends the invite again, counts it, and keeps the same role", async () => {
  const s = setup({ invite: row(), login: { userId: LOGIN, confirmed: false } });
  const r = await s.call({ action: "resend", invite_id: ID, redirect_origin: "https://app.example.test" });
  assertEquals(r.status, 200);
  assertEquals(s.invites[0].email, "pat@example.test");
  assertEquals(s.invites[0].options.data, { display_name: "Pat" });
  assertEquals(s.log, [`resent ${ID}`]);
  assertEquals(r.json.invite.sent_count, 2);
});

Deno.test("resend within a minute, of a revoked invite, of an accepted one, or of one with no login is refused plainly", async () => {
  const tooSoon = setup({ invite: row({ last_sent_at: "2026-11-12T11:59:30Z" }), login: { userId: LOGIN, confirmed: false } });
  const a = await tooSoon.call({ action: "resend", invite_id: ID });
  assertEquals([a.status, a.json.code], [429, "too_soon"]);
  assertEquals(tooSoon.invites.length, 0);

  const revoked = setup({ invite: row({ status: "revoked" }) });
  assertEquals((await revoked.call({ action: "resend", invite_id: ID })).json.code, "revoked");

  const accepted = setup({ invite: row(), login: { userId: LOGIN, confirmed: true } });
  const c = await accepted.call({ action: "resend", invite_id: ID });
  assertEquals([c.status, c.json.code], [409, "already_accepted"]);
  assertEquals(accepted.invites.length, 0);

  const gone = setup({ invite: row(), login: null });
  const d = await gone.call({ action: "resend", invite_id: ID });
  assertEquals([d.status, d.json.code], [409, "login_gone"]);
  assertEquals(gone.log, [`revoked ${ID}`]);

  const missing = setup({ invite: null });
  assertEquals((await missing.call({ action: "resend", invite_id: ID })).status, 404);
});

Deno.test("a resend the email service limits is not counted", async () => {
  const s = setup({
    invite: row(), login: { userId: LOGIN, confirmed: false },
    inviteResult: { data: null, error: { message: "slow down", status: 429 } },
  });
  const r = await s.call({ action: "resend", invite_id: ID });
  assertEquals(r.status, 429);
  assertEquals(s.log.length, 0);
});

// ── revoke ──────────────────────────────────────────────────────────────────

Deno.test("revoke removes the login that was never used and closes the invite", async () => {
  const s = setup({ invite: row(), login: { userId: LOGIN, confirmed: false } });
  const r = await s.call({ action: "revoke", invite_id: ID });
  assertEquals(r.status, 200);
  assertEquals(s.deleted, [LOGIN]);
  assertEquals(s.log, [`revoked ${ID}`]);
  assertEquals(r.json.invite.status, "revoked");
});

Deno.test("an accepted invite cannot be revoked, and a failed removal leaves it open", async () => {
  const accepted = setup({ invite: row(), login: { userId: LOGIN, confirmed: true } });
  const r = await accepted.call({ action: "revoke", invite_id: ID });
  assertEquals([r.status, r.json.code], [409, "already_accepted"]);
  assertStringIncludes(r.json.error, "Settings > Admin");
  assertEquals(accepted.deleted.length + accepted.log.length, 0);

  const failing = setup({ invite: row(), login: { userId: LOGIN, confirmed: false }, deleteError: { message: "x", status: 500 } });
  const f = await failing.call({ action: "revoke", invite_id: ID });
  assertEquals([f.status, f.json.code], [502, "revoke_failed"]);
  assertEquals(failing.log.length, 0);
});

Deno.test("revoking an invite whose login is already gone just closes it; a revoked one says so", async () => {
  const gone = setup({ invite: row(), login: null });
  assertEquals((await gone.call({ action: "revoke", invite_id: ID })).status, 200);
  assertEquals(gone.deleted.length, 0);
  assertEquals(gone.log, [`revoked ${ID}`]);
  const revoked = setup({ invite: row({ status: "revoked" }) });
  assertEquals((await revoked.call({ action: "revoke", invite_id: ID })).status, 409);
  assertEquals((await setup({ invite: null }).call({ action: "revoke", invite_id: ID })).status, 404);
});

// ── the real store ──────────────────────────────────────────────────────────

Deno.test("the real store reads and writes the right tables", async () => {
  const calls: string[] = [];
  const result = (data: unknown) => ({ data, error: null });
  const query = (name: string, data: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "insert", "update"]) q[m] = (...args: unknown[]) => { calls.push(`${name}.${m}(${args.map((a) => JSON.stringify(a)).join(",")})`); return q; };
    q.maybeSingle = () => Promise.resolve(result(data));
    q.single = () => Promise.resolve(result(data));
    q.then = (r: (v: unknown) => unknown) => Promise.resolve(result(data)).then(r);
    return q;
  };
  const db = {
    from: (t: string) => query(t, t === "user_invites" ? { id: ID, sent_count: 2 } : t === "clients" ? { slug: "glow" } : null),
    rpc: (name: string, args: Record<string, unknown>) => { calls.push(`rpc ${name} ${JSON.stringify(args)}`); return Promise.resolve(result([{ user_id: LOGIN, confirmed: false }])); },
    auth: { admin: {} as never },
  };
  const store: Store = supabaseStore(db as never) as never;
  assertEquals(await store.loginState("a@b.test"), { userId: LOGIN, confirmed: false });
  assertEquals(await store.clientExists("glow"), true);
  await store.grantRole(LOGIN, "client");
  await store.setDisplayName(LOGIN, "Pat");
  await store.linkMember(LOGIN, "glow");
  await store.markResent(ID, BUILDER, NOW);
  await store.markRevoked(ID, BUILDER, NOW);
  assertEquals(calls[0], 'rpc invite_login_state {"p_email":"a@b.test"}');
  for (const expected of [
    'user_roles.insert({"user_id":"' + LOGIN + '","role":"client"})',
    'profiles.update({"display_name":"Pat"})',
    'client_members.insert({"user_id":"' + LOGIN + '","client_slug":"glow"})',
    'user_invites.update({"sent_count":3,"last_sent_at":"2026-11-12T12:00:00.000Z","last_sent_by":"' + BUILDER + '"})',
    'user_invites.update({"status":"revoked","revoked_at":"2026-11-12T12:00:00.000Z","revoked_by":"' + BUILDER + '"})',
  ]) assert(calls.includes(expected), `missing call ${expected}\n${calls.join("\n")}`);
});

Deno.test("the real store turns a database error into a thrown error", async () => {
  const failing = {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "insert", "update"]) q[m] = () => q;
      q.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "boom" } }).then(r);
      return q;
    },
    rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    auth: { admin: {} as never },
  };
  const store = supabaseStore(failing as never);
  let thrown = "";
  try { await store.grantRole(LOGIN, "client"); } catch (e) { thrown = (e as Error).message; }
  assertStringIncludes(thrown, "user_roles insert: boom");
  thrown = "";
  try { await store.loginState("a@b.test"); } catch (e) { thrown = (e as Error).message; }
  assertStringIncludes(thrown, "invite_login_state: boom");
});
