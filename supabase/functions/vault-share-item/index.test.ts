// Tests for vault-share-item (public single-item share links).
//
// Covers:
//   * genShareToken — 12-char, hyphen-free format.
//   * parseAction — action discrimination + required-field validation.
//   * handler() against a recording/stubbed mock client:
//       - OPTIONS preflight + non-POST + bad JSON + invalid action guards.
//       - resolve: 404 on unknown token; 200 returns item+transcript+framework
//         and a signed URL for a private-bucket upload (file_path, no video_url),
//         and NO signing when a public video_url is present.
//       - mint: 401 without a valid user; idempotent reuse of an existing token;
//         generates + persists a new token when none exists.
//       - revoke: 401 without a user; nulls share_token + shared_at when authed.
//
// VAULT_SHARE_NO_SERVE is set before import so the module-level Deno.serve never binds.
//   deno test -A supabase/functions/vault-share-item/index.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("VAULT_SHARE_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const mod = await import("./index.ts");

// ---- Pure helpers ----------------------------------------------------------

Deno.test("genShareToken is 12 hyphen-free chars", () => {
  const t = mod.genShareToken();
  assertEquals(t.length, 12);
  assertMatch(t, /^[0-9a-f]{12}$/);
  // Distinct across calls (sanity, not a strict guarantee).
  assert(mod.genShareToken() !== t);
});

Deno.test("parseAction validates mint/revoke item_id", () => {
  assert(mod.parseAction({ action: "mint", item_id: "i1" }).ok);
  assert(mod.parseAction({ action: "revoke", item_id: "i1" }).ok);
  assert(!mod.parseAction({ action: "mint" }).ok);
  assert(!mod.parseAction({ action: "mint", item_id: "   " }).ok);
});

Deno.test("parseAction validates resolve token", () => {
  assert(mod.parseAction({ action: "resolve", token: "abc" }).ok);
  assert(!mod.parseAction({ action: "resolve" }).ok);
  assert(!mod.parseAction({ action: "resolve", token: "" }).ok);
});

Deno.test("parseAction rejects unknown actions", () => {
  assert(!mod.parseAction({ action: "delete", item_id: "i1" }).ok);
  assert(!mod.parseAction({}).ok);
});

// ---- Mock client -----------------------------------------------------------

interface MockOpts {
  // Row returned by the inspiration_items lookup (.maybeSingle()). null => not found.
  item?: Record<string, unknown> | null;
  transcript?: Record<string, unknown> | null;
  framework?: Record<string, unknown> | null;
  signedUrl?: string | null;
  // User returned by auth.getUser. null => unauthenticated.
  user?: Record<string, unknown> | null;
}

interface Captured {
  updates: Array<{ table: string; values: Record<string, unknown> }>;
  signedPaths: string[];
}

function makeClient(opts: MockOpts) {
  const captured: Captured = { updates: [], signedPaths: [] };

  function builder(table: string) {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.update = (values: Record<string, unknown>) => {
      captured.updates.push({ table, values });
      // update().eq() is awaited -> resolve to {error:null}
      return { eq: () => Promise.resolve({ error: null }) };
    };
    b.maybeSingle = () =>
      Promise.resolve({
        data: table === "inspiration_items" ? (opts.item ?? null) : null,
        error: null,
      });
    // Awaiting the builder (transcripts/frameworks .eq() terminal) yields arrays.
    b.then = (resolve: (v: unknown) => void) => {
      if (table === "inspiration_transcripts") {
        return resolve({ data: opts.transcript ? [opts.transcript] : [], error: null });
      }
      if (table === "inspiration_frameworks") {
        return resolve({ data: opts.framework ? [opts.framework] : [], error: null });
      }
      return resolve({ data: [], error: null });
    };
    return b;
  }

  const client = {
    from: (table: string) => builder(table),
    auth: {
      // deno-lint-ignore no-explicit-any
      getUser: (_token: string) =>
        Promise.resolve(
          opts.user
            ? { data: { user: opts.user }, error: null }
            : { data: { user: null }, error: { message: "bad jwt" } },
        ) as any,
    },
    storage: {
      from: (_bucket: string) => ({
        createSignedUrl: (path: string, _ttl: number) => {
          captured.signedPaths.push(path);
          return Promise.resolve({
            data: opts.signedUrl ? { signedUrl: opts.signedUrl } : null,
            error: null,
          });
        },
      }),
    },
  };
  return { client, captured };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://fn.local/vault-share-item", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const AUTH = { Authorization: "Bearer user-jwt" };

// ---- Guards ----------------------------------------------------------------

Deno.test("handler OPTIONS returns CORS ok", async () => {
  const res = await mod.handler(
    new Request("https://fn.local/vault-share-item", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
  assert(res.headers.get("Access-Control-Allow-Origin") !== null);
});

Deno.test("handler rejects non-POST with 405", async () => {
  const { client } = makeClient({});
  const res = await mod.handler(
    new Request("https://fn.local/vault-share-item", { method: "GET" }),
    client,
  );
  assertEquals(res.status, 405);
});

Deno.test("handler 400s bad JSON and invalid action", async () => {
  const { client } = makeClient({});
  const bad = new Request("https://fn.local/vault-share-item", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  assertEquals((await mod.handler(bad, client)).status, 400);
  assertEquals((await mod.handler(post({ action: "nope" }), client)).status, 400);
});

// ---- resolve ---------------------------------------------------------------

Deno.test("resolve 404s an unknown token", async () => {
  const { client } = makeClient({ item: null });
  const res = await mod.handler(post({ action: "resolve", token: "missing" }), client);
  assertEquals(res.status, 404);
});

Deno.test("resolve returns item + transcript + framework + signed URL for a private upload", async () => {
  const { client, captured } = makeClient({
    item: { id: "it1", file_path: "uploads/u/x.png", video_url: null, brand_name: "Acme" },
    transcript: { cleaned_script: "hello" },
    framework: { copywriting_framework: "PAS" },
    signedUrl: "https://signed.example/x.png?token=sig",
  });
  const res = await mod.handler(post({ action: "resolve", token: "tok123" }), client);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.item.id, "it1");
  assertEquals(body.transcript.cleaned_script, "hello");
  assertEquals(body.framework.copywriting_framework, "PAS");
  assertEquals(body.signed_url, "https://signed.example/x.png?token=sig");
  assertEquals(captured.signedPaths, ["uploads/u/x.png"]);
});

Deno.test("resolve does NOT sign when a public video_url is present", async () => {
  const { client, captured } = makeClient({
    item: { id: "it2", file_path: "uploads/u/v.mp4", video_url: "https://cdn/v.mp4" },
  });
  const res = await mod.handler(post({ action: "resolve", token: "tok" }), client);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.signed_url, null);
  assertEquals(captured.signedPaths, []);
});

// ---- mint ------------------------------------------------------------------

Deno.test("mint 401s without a valid user", async () => {
  const { client } = makeClient({ user: null });
  const res = await mod.handler(post({ action: "mint", item_id: "it1" }, AUTH), client);
  assertEquals(res.status, 401);
});

Deno.test("mint reuses an existing token (idempotent, no update)", async () => {
  const { client, captured } = makeClient({
    user: { id: "u1" },
    item: { share_token: "existing12345" },
  });
  const res = await mod.handler(post({ action: "mint", item_id: "it1" }, AUTH), client);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).share_token, "existing12345");
  assertEquals(captured.updates.length, 0);
});

Deno.test("mint generates + persists a new token when none exists", async () => {
  const { client, captured } = makeClient({
    user: { id: "u1" },
    item: { share_token: null },
  });
  const res = await mod.handler(post({ action: "mint", item_id: "it1" }, AUTH), client);
  assertEquals(res.status, 200);
  const token = (await res.json()).share_token;
  assertMatch(token, /^[0-9a-f]{12}$/);
  assertEquals(captured.updates.length, 1);
  assertEquals(captured.updates[0].table, "inspiration_items");
  assertEquals(captured.updates[0].values.share_token, token);
  assert(typeof captured.updates[0].values.shared_at === "string");
});

Deno.test("mint 404s a missing item", async () => {
  const { client } = makeClient({ user: { id: "u1" }, item: null });
  const res = await mod.handler(post({ action: "mint", item_id: "gone" }, AUTH), client);
  assertEquals(res.status, 404);
});

// ---- revoke ----------------------------------------------------------------

Deno.test("revoke 401s without a user", async () => {
  const { client } = makeClient({ user: null });
  const res = await mod.handler(post({ action: "revoke", item_id: "it1" }, AUTH), client);
  assertEquals(res.status, 401);
});

Deno.test("revoke nulls share_token + shared_at when authed", async () => {
  const { client, captured } = makeClient({ user: { id: "u1" } });
  const res = await mod.handler(post({ action: "revoke", item_id: "it1" }, AUTH), client);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
  assertEquals(captured.updates.length, 1);
  assertEquals(captured.updates[0].values.share_token, null);
  assertEquals(captured.updates[0].values.shared_at, null);
});
