// Tests for client-invite (OS-021). Only a builder gets in; with the switch off the answer is a dry
// run and nothing is written or sent; an unapproved template or batch and an excluded or ending
// client are refused; the domain allow-list limits who is sent. Nothing is sent from a test: the
// mailer is a stand-in that records calls.
//
//   deno test -A supabase/functions/client-invite/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("CLIENT_INVITE_NO_SERVE", "1");

import type { Caller } from "../_shared/internal-auth.ts";
import type { Batch, Invite, Mailer, Store, Template } from "./index.ts";

// Imported after the env is set, so the module does not start a server.
const { allowedDomains, domainAllowed, handler } = await import("./index.ts");

const BATCH = "b0000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-12-03T12:00:00Z");

const builder: Caller = { kind: "user", isStaff: true, userId: "u-builder", roles: ["builder"] };
const employee: Caller = { kind: "user", isStaff: true, userId: "u-emp", roles: ["employee"] };
const client: Caller = { kind: "user", isStaff: false, userId: "u-client", roles: ["client"] };

interface World {
  template: Template | null;
  batch: Batch | null;
  invites: Invite[];
  blocked: Record<string, string>;
  logins: Record<string, string>;
}

function world(over: Partial<World> = {}): World {
  return {
    template: { subject: "Hi", body: "Sign in", approved_at: "2026-12-01T00:00:00Z" },
    batch: { id: BATCH, name: "Pilot", kind: "pilot", client_slugs: ["alpha", "beta"], approved_at: "2026-12-02T00:00:00Z", sent_at: null },
    invites: [
      { id: "i1", client_slug: "alpha", email: "ann@staging.verdanote.test", display_name: "Ann", status: "approved" },
      { id: "i2", client_slug: "beta", email: "bob@beta.example", display_name: "Bob", status: "approved" },
    ],
    blocked: {},
    logins: {},
    ...over,
  };
}

function setup(w: World, env: Record<string, string> = {}, caller: Caller = builder) {
  const writes: string[] = [];
  const mails: string[] = [];
  const store: Store = {
    template: () => Promise.resolve(w.template),
    batch: () => Promise.resolve(w.batch),
    invites: () => Promise.resolve(w.invites),
    blockedReason: (slug) => Promise.resolve(w.blocked[slug] ?? null),
    loginState: (email) => Promise.resolve(w.logins[email] ? { userId: w.logins[email], confirmed: true } : null),
    setUpClientLogin: (userId, slug) => {
      writes.push(`login:${userId}:${slug}`);
      return Promise.resolve();
    },
    markSent: (id) => {
      writes.push(`sent:${id}`);
      return Promise.resolve();
    },
    markBatchSent: (id) => {
      writes.push(`batch:${id}`);
      return Promise.resolve();
    },
  };
  const mailer: Mailer = {
    inviteUserByEmail: (email) => {
      mails.push(`invite:${email}`);
      return Promise.resolve({ data: { user: { id: `new-${email}` } }, error: null });
    },
    sendMagicLink: (email) => {
      mails.push(`magic:${email}`);
      return Promise.resolve({ error: null });
    },
  };
  const call = async (body: unknown = { action: "send", batch_id: BATCH }) => {
    const res = await handler(new Request("https://fn.local/client-invite", { method: "POST", body: JSON.stringify(body) }), {
      resolveCaller: () => Promise.resolve(caller),
      store: () => store,
      mailer: () => mailer,
      env: (name) => env[name],
      now: () => NOW,
    });
    return { status: res.status, body: await res.json() };
  };
  return { call, writes, mails };
}

const ON = { CLIENT_INVITES_SEND_ENABLED: "true" };

Deno.test("employees and clients are refused before anything is read", async () => {
  for (const who of [employee, client]) {
    const t = setup(world(), ON, who);
    const r = await t.call();
    assertEquals(r.status, 403);
    assertEquals([t.writes.length, t.mails.length], [0, 0]);
  }
});

Deno.test("a call with no login is refused", async () => {
  const res = await handler(new Request("https://fn.local/client-invite", { method: "POST", body: "{}" }), {
    resolveCaller: () => Promise.resolve(new Response("{}", { status: 401 })),
  });
  assertEquals(res.status, 401);
});

Deno.test("with the switch off the answer is a dry run and nothing is sent or written", async () => {
  const t = setup(world(), {});
  const r = await t.call();
  assertEquals(r.status, 200);
  assertEquals(r.body.dry_run, true);
  assertEquals(r.body.would_send.map((p: { email: string }) => p.email), ["ann@staging.verdanote.test", "bob@beta.example"]);
  assertEquals([t.writes.length, t.mails.length], [0, 0]);
});

Deno.test("a switch set to anything but true is still a dry run", async () => {
  const t = setup(world(), { CLIENT_INVITES_SEND_ENABLED: "TRUE " });
  const r = await t.call();
  assertEquals(r.body.dry_run, true);
  assertEquals(t.mails.length, 0);
});

Deno.test("an unapproved email text is refused", async () => {
  const t = setup(world({ template: { subject: "Hi", body: "x", approved_at: null } }), ON);
  const r = await t.call();
  assertEquals([r.status, r.body.code], [409, "template_not_approved"]);
  assertEquals(t.mails.length, 0);
});

Deno.test("an unapproved batch is refused", async () => {
  const w = world();
  w.batch = { ...w.batch!, approved_at: null };
  const t = setup(w, ON);
  const r = await t.call();
  assertEquals([r.status, r.body.code], [409, "batch_not_approved"]);
  assertEquals(t.mails.length, 0);
});

Deno.test("an excluded or ending client refuses the whole batch, even as a dry run", async () => {
  for (const env of [ON, {}]) {
    const t = setup(world({ blocked: { beta: "excluded" } }), env);
    const r = await t.call();
    assertEquals([r.status, r.body.code], [409, "excluded_client"]);
    assertEquals(r.body.blocked, [{ client_slug: "beta", reason: "excluded" }]);
    assertEquals([t.writes.length, t.mails.length], [0, 0]);
  }
  const ending = setup(world({ blocked: { alpha: "ending" } }), ON);
  assertEquals((await ending.call()).body.code, "excluded_client");
});

Deno.test("a contact whose client is not in the batch list is still checked", async () => {
  const w = world({ blocked: { royo: "excluded" } });
  w.invites = [...w.invites, { id: "i3", client_slug: "royo", email: "r@royo.example", display_name: "R", status: "approved" }];
  const t = setup(w, ON);
  assertEquals((await t.call()).body.code, "excluded_client");
  assertEquals(t.mails.length, 0);
});

Deno.test("the domain allow-list sends only matching addresses and lists the rest as skipped", async () => {
  const t = setup(world(), { ...ON, CLIENT_INVITES_ALLOWED_DOMAINS: "staging.verdanote.test" });
  const r = await t.call();
  assertEquals(r.status, 200);
  assertEquals(t.mails, ["invite:ann@staging.verdanote.test"]);
  assertEquals(r.body.skipped.map((s: { email: string; reason: string }) => [s.email, s.reason]), [["bob@beta.example", "domain_not_allowed"]]);
  assertEquals(t.writes, ["login:new-ann@staging.verdanote.test:alpha", "sent:i1", `batch:${BATCH}`]);
});

Deno.test("the dry run applies the allow-list too", async () => {
  const t = setup(world(), { CLIENT_INVITES_ALLOWED_DOMAINS: "staging.verdanote.test" });
  const r = await t.call();
  assertEquals(r.body.would_send.length, 1);
  assertEquals(r.body.skipped.length, 1);
});

Deno.test("an address with a login gets a magic link and no new login", async () => {
  const t = setup(world({ logins: { "ann@staging.verdanote.test": "u-ann" } }), { ...ON, CLIENT_INVITES_ALLOWED_DOMAINS: "staging.verdanote.test" });
  const r = await t.call();
  assertEquals(r.status, 200);
  assertEquals(t.mails, ["magic:ann@staging.verdanote.test"]);
  assert(!t.writes.some((w) => w.startsWith("login:")));
});

Deno.test("a later run does not move the batch's sent date", async () => {
  const w = world();
  w.batch = { ...w.batch!, sent_at: "2026-12-02T10:00:00Z" };
  w.invites = [{ ...w.invites[0], status: "sent" }, w.invites[1]];
  const t = setup(w, ON);
  await t.call();
  assertEquals(t.writes.filter((x) => x.startsWith("batch:")).length, 0);
  const done = setup({ ...w, invites: w.invites.map((i) => ({ ...i, status: "sent" as const })) }, ON);
  assertEquals((await done.call()).body.code, "already_sent");
});

Deno.test("bad input is refused", async () => {
  const t = setup(world(), ON);
  assertEquals((await t.call({ action: "send", batch_id: "nope" })).status, 400);
  assertEquals((await t.call({ action: "delete", batch_id: BATCH })).status, 400);
  const get = await handler(new Request("https://fn.local/client-invite", { method: "GET" }), { resolveCaller: () => Promise.resolve(builder) });
  assertEquals(get.status, 405);
});

Deno.test("allowedDomains and domainAllowed", () => {
  assertEquals(allowedDomains(undefined), null);
  assertEquals(allowedDomains(" , "), null);
  assertEquals(allowedDomains("Staging.Verdanote.test, @x.test"), ["staging.verdanote.test", "x.test"]);
  assert(domainAllowed("a@staging.verdanote.test", ["staging.verdanote.test"]));
  assert(!domainAllowed("a@evil-staging.verdanote.test.com", ["staging.verdanote.test"]));
  assert(!domainAllowed("a@sub.staging.verdanote.test", ["staging.verdanote.test"]));
  assert(domainAllowed("a@anything.example", null));
});
