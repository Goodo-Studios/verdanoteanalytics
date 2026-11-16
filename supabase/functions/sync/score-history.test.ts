// Audit 8.4 part 2: Phase 5 score snapshots must be safe to write twice for the same sync run
// (a takeover or a continuation can re-enter Phase 5). The writer tags every row with the sync
// run's id and upserts on (ad_id, sync_log_id) with ignoreDuplicates, so a repeat is skipped.
//   deno test -A supabase/functions/sync/score-history.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SYNC_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
Deno.env.set("BACKFILL_DAILY_HISTORY_NO_SERVE", "1");
Deno.env.set("META_ACCESS_TOKEN", "fake-meta-token");

const { writeScoreHistory } = await import("./index.ts");

/** A fake table with a unique key on (ad_id, sync_log_id), like the migration adds. */
function fakeScoreHistory() {
  const rows: Record<string, unknown>[] = [];
  const calls: { method: string; options?: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      if (table !== "score_history") throw new Error(`unexpected table ${table}`);
      return {
        insert(chunk: Record<string, unknown>[]) {
          calls.push({ method: "insert" });
          rows.push(...chunk);
          return Promise.resolve({ error: null });
        },
        upsert(chunk: Record<string, unknown>[], options: Record<string, unknown>) {
          calls.push({ method: "upsert", options });
          for (const r of chunk) {
            const dup = rows.some((x) => x.ad_id === r.ad_id && x.sync_log_id === r.sync_log_id);
            if (dup && options.ignoreDuplicates) continue;
            rows.push(r);
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, rows, calls };
}

const scoreRows = [
  { ad_id: "ad_1", account_id: "act_1", score: 60 },
  { ad_id: "ad_2", account_id: "act_1", score: 42 },
];

Deno.test("8.4: re-running Phase 5 for the same sync writes each snapshot once", async () => {
  const { client, rows } = fakeScoreHistory();
  await writeScoreHistory(client, scoreRows, 777, () => false);
  await writeScoreHistory(client, scoreRows, 777, () => false);
  assertEquals(rows.length, 2);
  assertEquals(rows.map((r) => r.sync_log_id), [777, 777]);
});

Deno.test("8.4: the write is an upsert on (ad_id, sync_log_id) that skips duplicates", async () => {
  const { client, calls } = fakeScoreHistory();
  await writeScoreHistory(client, scoreRows, 778, () => false);
  assertEquals(calls, [{ method: "upsert", options: { onConflict: "ad_id,sync_log_id", ignoreDuplicates: true } }]);
});

Deno.test("8.4: a later sync run still records its own snapshot", async () => {
  const { client, rows } = fakeScoreHistory();
  await writeScoreHistory(client, scoreRows, 779, () => false);
  await writeScoreHistory(client, scoreRows, 780, () => false);
  assertEquals(rows.length, 4);
});

Deno.test("8.4: stops between chunks when the phase budget runs out", async () => {
  const { client, rows } = fakeScoreHistory();
  const many = Array.from({ length: 1200 }, (_, i) => ({ ad_id: `ad_${i}`, account_id: "act_1", score: 1 }));
  let checks = 0;
  const written = await writeScoreHistory(client, many, 781, () => ++checks > 1);
  assertEquals(rows.length, 500);
  assertEquals(written, 500);
});
