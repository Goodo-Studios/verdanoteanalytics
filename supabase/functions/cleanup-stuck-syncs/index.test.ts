// Tests for cleanup-stuck-syncs: updates are guarded by status and update errors are checked.
//
//   deno test -A supabase/functions/cleanup-stuck-syncs/index.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeCreateClient, fakeSupabase, type FakeConfig, withEnv } from "../_shared/fake-supabase.ts";

Deno.env.set("CLEANUP_STUCK_SYNCS_NO_SERVE", "1");
const { handler } = await import("./index.ts");

const KEY = "service-key-for-tests";
const ENV = { SUPABASE_URL: "http://localhost", SUPABASE_SERVICE_ROLE_KEY: KEY };

const stale = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

function stuckRow(id: string, phase = 2) {
  return { id, sync_state: { last_activity: stale(), retry_count: 0 }, started_at: stale(), current_phase: phase, api_errors: null };
}

async function run(cfg: FakeConfig) {
  const db = fakeSupabase(cfg);
  const { createClient } = fakeCreateClient(db);
  let res!: Response;
  await withEnv(ENV, async () => {
    res = await handler(
      new Request("http://x/cleanup-stuck-syncs", { method: "POST", headers: { authorization: `Bearer ${KEY}` } }),
      { createClient },
    );
  });
  return { db, res, body: await res.json() };
}

Deno.test("requeue update is guarded by status=running", async () => {
  const { db, body } = await run({
    tables: { sync_logs: (op) => (op.filters.some(([, c, v]) => c === "status" && v === "queued") ? [] : [stuckRow("s1")]) },
    writeData: { "update:sync_logs": [{ id: "s1" }] },
  });
  const updates = db.writes().filter((o) => o.verb === "update");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].filters.some(([m, c, v]) => m === "eq" && c === "status" && v === "running"), true);
  assertEquals(body.requeued, 1);
});

Deno.test("a sync that completed in between is not counted as requeued", async () => {
  const { body } = await run({
    tables: { sync_logs: (op) => (op.filters.some(([, c, v]) => c === "status" && v === "queued") ? [] : [stuckRow("s1")]) },
    writeData: { "update:sync_logs": [] },
  });
  assertEquals(body.requeued, 0);
  assertEquals(body.raced, 1);
});

Deno.test("update errors are reported with a 500 and not counted", async () => {
  const { res, body } = await run({
    tables: { sync_logs: (op) => (op.filters.some(([, c, v]) => c === "status" && v === "queued") ? [] : [stuckRow("s1")]) },
    writeErrors: { "update:sync_logs": { message: "boom" } },
  });
  assertEquals(res.status, 500);
  assertEquals(body.requeued, 0);
  assertEquals(body.errors, 1);
});
