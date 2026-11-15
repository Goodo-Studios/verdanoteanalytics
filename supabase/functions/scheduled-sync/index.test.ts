// Tests for scheduled-sync: a failed trigger gives the account back instead of stranding it.
//
//   deno test -A supabase/functions/scheduled-sync/index.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeCreateClient, fakeSupabase, withEnv } from "../_shared/fake-supabase.ts";

Deno.env.set("SCHEDULED_SYNC_NO_SERVE", "1");
const { handler } = await import("./index.ts");

const KEY = "service-key-for-tests";
const ENV = { SUPABASE_URL: "http://localhost", SUPABASE_SERVICE_ROLE_KEY: KEY };

const acct = (id: string) => ({ id, name: id, sync_frequency: "daily", sync_hour: 3, sync_timezone: "UTC" });

async function run(accounts: unknown[], fetchStub: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const db = fakeSupabase({
    rpc: { claim_due_sync_accounts: accounts },
    tables: { ad_accounts: accounts.map((a) => ({ id: (a as { id: string }).id, daily_backfilled_since: "2026-01-01", last_full_sync_at: new Date().toISOString() })) },
  });
  const { createClient } = fakeCreateClient(db);
  let body: Record<string, unknown> = {};
  await withEnv(ENV, async () => {
    const res = await handler(
      new Request("http://x/scheduled-sync", { method: "POST", headers: { authorization: `Bearer ${KEY}` } }),
      // deno-lint-ignore no-explicit-any
      { createClient, fetch: ((u: string, i?: RequestInit) => Promise.resolve(fetchStub(u, i))) as any },
    );
    body = await res.json();
  });
  return { db, body };
}

const nextSyncWrites = (db: ReturnType<typeof fakeSupabase>) =>
  db.writes().filter((o) => o.table === "ad_accounts").map((o) => ({
    id: o.filters.find(([m, c]) => m === "eq" && c === "id")?.[2],
    at: (o.payload as { next_sync_at: string }).next_sync_at,
  }));

Deno.test("a /sync that errors releases that account and the loop still reaches the next one", async () => {
  const { db, body } = await run([acct("a1"), acct("a2")], (url, init) => {
    if (url.endsWith("/sync/continue")) return new Response("{}");
    const id = JSON.parse(String(init?.body)).account_id;
    return id === "a1" ? new Response("boom", { status: 500 }) : new Response(JSON.stringify({ started: [{ id: "log" }] }));
  });
  assertEquals(body.triggered, 1);
  assertEquals(body.accounts, ["a2"]);
  assertEquals(body.released, ["a1"]);
  const writes = nextSyncWrites(db);
  // a1 is due again within minutes, not 6 hours.
  const a1 = writes.find((w) => w.id === "a1")!;
  assertEquals(new Date(a1.at).getTime() - Date.now() < 15 * 60 * 1000, true);
});

Deno.test("a /sync call that throws (timeout) releases the account", async () => {
  const { body } = await run([acct("a1")], (url) => {
    if (url.endsWith("/sync/continue")) return new Response("{}");
    throw new DOMException("timed out", "TimeoutError");
  });
  assertEquals(body.triggered, 0);
  assertEquals(body.released, ["a1"]);
});

Deno.test("nothing enqueued counts as a failed trigger and is released", async () => {
  const { body } = await run([acct("a1")], (url) =>
    url.endsWith("/sync/continue") ? new Response("{}") : new Response(JSON.stringify({ message: "All requested accounts already syncing" }))
  );
  assertEquals(body.triggered, 0);
  assertEquals(body.released, ["a1"]);
});
