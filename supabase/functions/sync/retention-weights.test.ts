// Retention quartiles use their own weights (audit plan item 6.5, part 5).
//
// The rollup divided p25, p75 and p100 by the video views of days that had a p50 value. A day
// with p25 or p100 but no p50 added to the numerator and not the denominator, so the result
// could exceed 100%. Each quartile is now divided by the views of the days that have it.
//
//   deno test -A supabase/functions/sync/retention-weights.test.ts

import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SYNC_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
Deno.env.set("BACKFILL_DAILY_HISTORY_NO_SERVE", "1");

const { rollupDailyRows } = await import("./index.ts");

// Same fixture as supabase/tests/retention_weights_test.sql.
const days = [
  { video_views: 100, retention_p25: 80, retention_p50: 60, retention_p75: 40, retention_p100: 20 },
  { video_views: 300, retention_p25: 90, retention_p50: null, retention_p75: null, retention_p100: 10 },
];

Deno.test("each quartile is weighted by the views of the days that have it", () => {
  const agg = rollupDailyRows(days);
  assertAlmostEquals(agg.retention_p25!, (80 * 100 + 90 * 300) / 400, 1e-9); // 87.5, was 350
  assertAlmostEquals(agg.retention_p50!, 60, 1e-9);
  assertAlmostEquals(agg.retention_p75!, 40, 1e-9);
  assertAlmostEquals(agg.retention_p100!, (20 * 100 + 10 * 300) / 400, 1e-9); // 12.5, was 50
});

Deno.test("a quartile no day reports stays null", () => {
  const agg = rollupDailyRows([{ video_views: 100, retention_p25: 50 }]);
  assertAlmostEquals(agg.retention_p25!, 50, 1e-9);
  assertEquals(agg.retention_p50, null);
});
