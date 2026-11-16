// Audit 8.7: backfill-retag re-listed every active account on each chain link, so a
// continuation redid the accounts the previous link had already finished (and, on a large
// account set, never got past the first few). The continuation now carries a cursor.
//   deno test -A supabase/functions/backfill-retag/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BACKFILL_RETAG_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const { handler } = await import("./index.ts");

const ACCOUNTS = ["a1", "a2", "a3"];

// Permissive fake: every account has no creatives; records which accounts were visited
// (each visit reads that account's name_mappings) and the order filter on ad_accounts.
function makeDb() {
  const visited: string[] = [];
  const accountFilters: string[] = [];
  const db = {
    visited,
    accountFilters,
    rpc: () => Promise.resolve({ data: null, error: null }),
    from(table: string) {
      let accountId: string | undefined;
      // deno-lint-ignore no-explicit-any
      const b: any = {};
      for (const m of ["select", "in", "is", "range", "update", "order", "limit"]) b[m] = () => b;
      b.eq = (col: string, val: string) => {
        if (col === "account_id") accountId = val;
        return b;
      };
      b.gt = (col: string, val: string) => {
        if (table === "ad_accounts") accountFilters.push(`${col}>${val}`);
        return b;
      };
      b.order = (col: string) => {
        if (table === "ad_accounts") accountFilters.push(`order:${col}`);
        return b;
      };
      // deno-lint-ignore no-explicit-any
      b.then = (resolve: (v: any) => void) => {
        if (table === "name_mappings" && accountId) visited.push(accountId);
        if (table === "ad_accounts") {
          const after = accountFilters.find((f) => f.startsWith("id>"))?.slice(3);
          const ids = ACCOUNTS.filter((id) => !after || id > after);
          resolve({ data: ids.map((id) => ({ id })), error: null, count: 0 });
          return;
        }
        resolve({ data: [], error: null, count: 0 });
      };
      return b;
    },
  };
  return db;
}

async function run(body: Record<string, unknown>, timedOut: () => boolean, db: ReturnType<typeof makeDb>) {
  const chainBodies: Record<string, unknown>[] = [];
  const realFetch = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = (_url: string, init?: RequestInit) => {
    chainBodies.push(JSON.parse(String(init?.body ?? "{}")));
    return Promise.resolve(new Response("{}"));
  };
  try {
    const res = await handler(
      new Request("http://test.local/backfill-retag", { method: "POST", body: JSON.stringify(body) }),
      db,
      { timedOut },
    );
    return { json: await res.json(), chainBodies };
  } finally {
    globalThis.fetch = realFetch;
  }
}

Deno.test("8.7: a continuation resumes after the last finished account", async () => {
  const db = makeDb();
  // Budget runs out while a2 is in progress: a1 is finished, a2 is not.
  const { json, chainBodies } = await run({}, () => db.visited.includes("a2"), db);
  assertEquals(json.drained, false);
  assertEquals(chainBodies.length, 1);
  assertEquals(chainBodies[0].after_account, "a1", "the next link starts after a1, not from the top");
});

Deno.test("8.7: a chained link skips accounts before its cursor", async () => {
  const db = makeDb();
  await run({ after_account: "a1", _chained: true }, () => false, db);
  assertEquals(db.visited, ["a2", "a3"]);
  assert(db.accountFilters.includes("order:id"), "accounts are listed in a stable order");
});

Deno.test("8.7: a run that finishes does not chain", async () => {
  const db = makeDb();
  const { json, chainBodies } = await run({}, () => false, db);
  assertEquals(json.drained, true);
  assertEquals(chainBodies.length, 0);
  assertEquals(db.visited, ACCOUNTS);
});
