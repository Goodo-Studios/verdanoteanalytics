// Tests for ingest-client-progress: valid call, no token, wrong token, revoked token, unknown client,
// oversized batch, idempotent replay, shape errors and rate limit. A small in-memory fake plays the
// database: it holds token rows and the clients the apply function would write, so the replay test
// proves the same batch leaves the same state.
//   deno test -A supabase/functions/ingest-client-progress/index.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("INGEST_PROGRESS_NO_SERVE", "1");
const mod = await import("./index.ts");
const shared = await import("../_shared/ingest-progress.ts");

const RAW = "vni_" + "a".repeat(64);
const OTHER = "vni_" + "b".repeat(64);

interface State {
  tokens: Array<{ id: string; token_hash: string; scope: string; revoked_at: string | null }>;
  clients: Map<string, { origin: string; pct_complete?: number | null; status?: string }>;
  deliverables: Map<string, string>;
  audit: Array<Record<string, unknown>>;
  rpcCalls: number;
}

async function makeState(): Promise<State> {
  return {
    tokens: [{ id: "t1", token_hash: await shared.sha256Hex(RAW), scope: "client_progress", revoked_at: null }],
    clients: new Map([["glow", { origin: "coda" }], ["hand", { origin: "manual" }]]),
    deliverables: new Map(),
    audit: [],
    rpcCalls: 0,
  };
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fake(s: State, recent = 0): any {
  return {
    from(table: string) {
      if (table === "ingest_tokens") {
        return { select: () => ({ is: () => Promise.resolve({ data: s.tokens.filter((t) => !t.revoked_at), error: null }) }) };
      }
      if (table === "ingest_audit") {
        return {
          select: () => ({ eq: () => ({ gte: () => Promise.resolve({ count: recent, error: null }) }) }),
          insert: (row: Record<string, unknown>) => { s.audit.push(row); return Promise.resolve({ error: null }); },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string, args: { p_items: Array<Record<string, unknown>>; p_token_id: string }) {
      assertEquals(name, "apply_client_progress");
      s.rpcCalls++;
      if (!s.tokens.some((t) => t.id === args.p_token_id && !t.revoked_at)) return Promise.resolve({ data: null, error: { code: "28000" } });
      const rejected: Array<{ slug: unknown; reason: string }> = [];
      let applied = 0;
      let deliverables = 0;
      for (const it of args.p_items) {
        const c = s.clients.get(it.slug as string);
        if (!c) { rejected.push({ slug: it.slug, reason: "unknown_client" }); continue; }
        if ("pct_complete" in it) c.pct_complete = it.pct_complete as number | null;
        if ("status" in it) c.status = it.status as string;
        for (const d of (it.deliverables ?? []) as Array<{ month: string; type: string; status: string }>) {
          s.deliverables.set(`${it.slug}|${d.month}|${d.type}`, d.status);
          deliverables++;
        }
        applied++;
      }
      return Promise.resolve({ data: { received: args.p_items.length, applied, rejected, deliverables_upserted: deliverables, recorded_at: "now" }, error: null });
    },
  };
}

function post(body: unknown, token: string | null = RAW, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("https://example.test/functions/v1/ingest-client-progress", {
    method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = {
  source: "run-cycle",
  clients: [{ slug: "glow", pct_complete: 60, status: "active", month: "2026-11",
    deliverables: [{ month: "2026-11", type: "cycle_brief", status: "complete", file_path: "companies/x/cycle.md" }] }],
};

Deno.test("valid call applies, audits through the write and returns counts", async () => {
  const s = await makeState();
  const res = await mod.handler(post(valid), fake(s));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals([body.ok, body.received, body.applied, body.deliverables_upserted], [true, 1, 1, 1]);
  assertEquals(s.clients.get("glow")?.pct_complete, 60);
});

Deno.test("no token is refused and nothing is written", async () => {
  const s = await makeState();
  const res = await mod.handler(post(valid, null), fake(s));
  assertEquals(res.status, 401);
  assertEquals(s.rpcCalls, 0);
});

Deno.test("wrong token, a malformed token and a client-style JWT are refused", async () => {
  const s = await makeState();
  for (const t of [OTHER, "not-a-token", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.sig"]) {
    assertEquals((await mod.handler(post(valid, t), fake(s))).status, 401);
  }
  assertEquals(s.rpcCalls, 0);
});

Deno.test("revoked token is refused, same answer as a wrong token", async () => {
  const s = await makeState();
  s.tokens[0].revoked_at = "2026-11-10T00:00:00Z";
  const res = await mod.handler(post(valid), fake(s));
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "unauthorized");
  assertEquals(s.rpcCalls, 0);
});

Deno.test("token revoked between the check and the write is refused by the write", async () => {
  const s = await makeState();
  const db = fake(s);
  const realRpc = db.rpc.bind(db);
  db.rpc = (n: string, a: never) => { s.tokens[0].revoked_at = "now"; return realRpc(n, a); };
  assertEquals((await mod.handler(post(valid), db)).status, 401);
});

Deno.test("an unknown client is refused per entry, known and hand-made ones apply", async () => {
  const s = await makeState();
  const res = await mod.handler(post({ source: "seed", clients: [{ slug: "glow", pct_complete: 5 }, { slug: "nope", pct_complete: 5 }, { slug: "hand", pct_complete: 5 }] }), fake(s));
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.applied, 2);
  assertEquals(body.rejected, [{ slug: "nope", reason: "unknown_client" }]);
  assertEquals(s.clients.get("hand")?.pct_complete, 5);
  assertEquals(s.clients.get("hand")?.origin, "manual");
});

Deno.test("an oversized body is refused with 413 and an audit row", async () => {
  const s = await makeState();
  const big = { source: "seed", clients: [{ slug: "glow", notes: "x".repeat(shared.MAX_BODY_BYTES) }] };
  const res = await mod.handler(post(big), fake(s));
  assertEquals(res.status, 413);
  assertEquals(s.rpcCalls, 0);
  assertEquals(s.audit[0].error_code, "too_large");
});

Deno.test("more than the batch limit of clients is refused", async () => {
  const s = await makeState();
  const clients = Array.from({ length: shared.MAX_CLIENTS + 1 }, (_, i) => ({ slug: `c${i}`, pct_complete: 1 }));
  const res = await mod.handler(post({ source: "seed", clients }), fake(s));
  assertEquals(res.status, 400);
  assertEquals(s.rpcCalls, 0);
});

Deno.test("replaying the same batch leaves the same state", async () => {
  const s = await makeState();
  await mod.handler(post(valid), fake(s));
  const first = JSON.stringify([...s.clients], null, 0) + JSON.stringify([...s.deliverables]);
  const res = await mod.handler(post(valid), fake(s));
  assertEquals(res.status, 200);
  assertEquals(JSON.stringify([...s.clients], null, 0) + JSON.stringify([...s.deliverables]), first);
  assertEquals(s.deliverables.size, 1);
});

Deno.test("shape errors are 400, name the field, never echo a value, and write nothing", async () => {
  const s = await makeState();
  const bad = { source: "run-cycle", clients: [{ slug: "glow", pct_complete: 140, active: false, last_synced: "2026-01-01", deliverables: [{ month: "2026-13", type: "bogus", status: "done" }] }] };
  const res = await mod.handler(post(bad), fake(s));
  assertEquals(res.status, 400);
  const body = await res.json();
  const text = JSON.stringify(body.details);
  for (const f of ["pct_complete", "active", "last_synced", "month", "type", "status"]) assert(text.includes(f), f);
  assert(!text.includes("140"));
  assertEquals(s.rpcCalls, 0);
});

Deno.test("invalid JSON and a wrong content type are 400", async () => {
  const s = await makeState();
  assertEquals((await mod.handler(post("{nope"), fake(s))).status, 400);
  const req = new Request("https://example.test/x", { method: "POST", headers: { authorization: `Bearer ${RAW}`, "content-type": "text/plain" }, body: "x" });
  assertEquals((await mod.handler(req, fake(s))).status, 400);
});

Deno.test("a token over its per-minute limit gets 429 and writes nothing", async () => {
  const s = await makeState();
  const res = await mod.handler(post(valid), fake(s, shared.RATE_LIMIT_PER_MINUTE));
  assertEquals(res.status, 429);
  assertEquals(res.headers.get("Retry-After"), "60");
  assertEquals(s.rpcCalls, 0);
});

Deno.test("only POST is accepted", async () => {
  const s = await makeState();
  assertEquals((await mod.handler(new Request("https://example.test/x", { method: "GET" }), fake(s))).status, 405);
});

Deno.test("constantTimeEqual and findTokenId", async () => {
  assert(shared.constantTimeEqual("abc", "abc"));
  assert(!shared.constantTimeEqual("abc", "abd"));
  assert(!shared.constantTimeEqual("abc", "abcd"));
  const rows = [{ id: "a", token_hash: await shared.sha256Hex(RAW), scope: "client_progress" }, { id: "b", token_hash: await shared.sha256Hex(OTHER), scope: "client_progress" }];
  assertEquals(await shared.findTokenId(OTHER, rows), "b");
  assertEquals(await shared.findTokenId("vni_" + "c".repeat(64), rows), null);
});
