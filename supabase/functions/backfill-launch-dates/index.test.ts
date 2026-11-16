// Audit 8.7: backfill-launch-dates picked the same unresolvable rows (created_time still
// NULL because Meta returns nothing for them) on every run.
//   deno test -A supabase/functions/backfill-launch-dates/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { makeBackfillTestDb, withMetaFetch } from "../_shared/backfill-test-db.ts";

Deno.env.set("BACKFILL_LAUNCH_DATES_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
Deno.env.set("META_ACCESS_TOKEN", "env-token");

const { handler } = await import("./index.ts");

async function run(db: unknown) {
  const res = await handler(
    new Request("http://test.local/backfill-launch-dates", {
      method: "POST",
      body: JSON.stringify({ account_id: "act_1" }),
    }),
    db,
  );
  return { status: res.status, body: await res.json() };
}

Deno.test("8.7: an ad with no created_time from Meta is marked checked", async () => {
  const db = makeBackfillTestDb({ candidates: ["ad_1", "ad_2"], settingsToken: null });
  await withMetaFetch({ ad_1: { id: "ad_1", created_time: "2026-01-02T03:04:05+0000" }, ad_2: { id: "ad_2" } }, () => run(db));
  const resolved = db.updates.find((u) => u.ad_id === "ad_1");
  assert(resolved?.payload.created_time, "the resolvable ad gets its created_time");
  const stamp = db.updates.find((u) => u.ad_id === "ad_2");
  assert(stamp && typeof stamp.payload.launch_date_checked_at === "string", "the unresolvable ad is marked checked");
});

Deno.test("8.7: a recently checked ad is not picked again", async () => {
  const db = makeBackfillTestDb({ candidates: ["ad_1"], settingsToken: null });
  await withMetaFetch({ ad_1: { id: "ad_1", created_time: "2026-01-02T03:04:05+0000" } }, () => run(db));
  assert(
    db.selectOrs.some((e) => e.startsWith("launch_date_checked_at.is.null,launch_date_checked_at.lt.")),
    `candidate select skips recently checked rows: ${JSON.stringify(db.selectOrs)}`,
  );
});

Deno.test("8.7: a failed Meta batch marks nothing", async () => {
  const db = makeBackfillTestDb({ candidates: ["ad_2"], settingsToken: null });
  await withMetaFetch({ error: { code: 4, message: "(#4) Application request limit reached" } }, () => run(db));
  assertEquals(db.updates.length, 0);
});
