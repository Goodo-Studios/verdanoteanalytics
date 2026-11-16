// Audit plan item 5.4: cancelled syncs come back.
//
// - saveState wrote `status` with no condition, so a sync cancelled mid-phase was
//   set back to "running" by its own next save.
// - POST /sync/cancel cancelled running and queued syncs for EVERY account, not
//   just the one asked for.
//
//   deno test -A supabase/functions/sync/cancel.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SYNC_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const mod = await import("./index.ts");

type Row = Record<string, unknown>;

/** Tiny in-memory sync_logs table that applies eq / in filters to select and update. */
function memDb(rows: Row[]) {
  function builder() {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let selecting = false;
    const b: Record<string, unknown> = {};
    b.select = () => { selecting = true; return b; };
    b.update = (p: Row) => { patch = p; return b; };
    b.eq = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return b; };
    b.in = (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return b; };
    b.then = (resolve: (v: unknown) => void) => {
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (patch) {
        for (const r of hit) Object.assign(r, patch);
        return resolve({ data: selecting ? hit.map((r) => ({ id: r.id })) : null, error: null });
      }
      return resolve({ data: hit, error: null });
    };
    return b;
  }
  return { from: (_t: string) => builder() };
}

Deno.test("a sync cancelled mid-phase is not set back to running by its next save", async () => {
  const rows = [{ id: "s1", account_id: "act_1", status: "cancelled" }];
  const wrote = await mod.updateRunningSyncLog(memDb(rows), "s1", { status: "running", current_phase: 2 });
  assertEquals(rows[0].status, "cancelled");
  assertEquals(wrote, false);
});

Deno.test("a running sync's save still lands", async () => {
  const rows = [{ id: "s1", account_id: "act_1", status: "running" }];
  const wrote = await mod.updateRunningSyncLog(memDb(rows), "s1", { status: "completed", current_phase: 4 });
  assertEquals(rows[0].status, "completed");
  assertEquals(wrote, true);
});

Deno.test("cancelling one account leaves other accounts' syncs running", async () => {
  const rows = [
    { id: "s1", account_id: "act_1", status: "running" },
    { id: "s2", account_id: "act_2", status: "running" },
    { id: "s3", account_id: "act_1", status: "queued" },
    { id: "s4", account_id: "act_1", status: "completed" },
  ];
  const n = await mod.cancelActiveSyncs(memDb(rows), "act_1");
  assertEquals(n, 2);
  assertEquals(rows.map((r) => r.status), ["cancelled", "running", "cancelled", "completed"]);
});

Deno.test("cancelling with no account still cancels every active sync (explicit all)", async () => {
  const rows = [
    { id: "s1", account_id: "act_1", status: "running" },
    { id: "s2", account_id: "act_2", status: "queued" },
  ];
  const n = await mod.cancelActiveSyncs(memDb(rows), null);
  assertEquals(n, 2);
  assertEquals(rows.map((r) => r.status), ["cancelled", "cancelled"]);
});

Deno.test("cancel never touches a sync that finished in the meantime", async () => {
  const rows = [{ id: "s1", account_id: "act_1", status: "completed" }];
  const n = await mod.cancelActiveSyncs(memDb(rows), "act_1");
  assertEquals(n, 0);
  assertEquals(rows[0].status, "completed");
});
