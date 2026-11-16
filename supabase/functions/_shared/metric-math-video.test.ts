// Video and frequency metrics from daily rows (audit plan item 6.1, part 1).
//
// reports and scheduled-reports averaged each day's hook rate, hold rate, frequency and
// play time, so a tiny day counted as much as a big one. The shared module now builds
// them from counts:
//   hook rate  = sum(video_views) / sum(impressions) x 100, over rows with video_views > 0
//   hold rate  = sum(hold_rate / 100 x video_views) / sum(video_views) x 100
//   play time  = sum(play_time x video_views) / sum(video_views)
//   frequency  = impression-weighted average of daily frequency (approximate: reach is not stored)
// Zero denominators give null.
//
//   deno test -A supabase/functions/_shared/metric-math-video.test.ts

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// deno-lint-ignore no-explicit-any
const mm: any = await import("./metric-math.ts");

Deno.test("hook rate is weighted by impressions (Codex fixture: 10.891%, not 55%)", () => {
  const v = mm.computeVideoMetrics([
    { impressions: 100, video_views: 100 },
    { impressions: 10000, video_views: 1000 },
  ]);
  assertAlmostEquals(v.hook_rate, (1100 / 10100) * 100, 1e-9);
  assertEquals(Math.round(v.hook_rate * 1000) / 1000, 10.891);
});

Deno.test("hook rate ignores rows with no video views (image days)", () => {
  const v = mm.computeVideoMetrics([
    { impressions: 1000, video_views: 100 },
    { impressions: 9000, video_views: 0 },
  ]);
  assertAlmostEquals(v.hook_rate, 10, 1e-9);
});

Deno.test("hold rate and play time are weighted by video views", () => {
  const v = mm.computeVideoMetrics([
    { impressions: 1000, video_views: 100, hold_rate: 50, video_avg_play_time: 2 },
    { impressions: 1000, video_views: 900, hold_rate: 10, video_avg_play_time: 6 },
  ]);
  // (50 + 90) thruplays / 1000 views = 14%
  assertAlmostEquals(v.hold_rate, 14, 1e-9);
  // (2*100 + 6*900) / 1000 = 5.6s
  assertAlmostEquals(v.avg_play_time, 5.6, 1e-9);
});

Deno.test("frequency is an impression-weighted approximation", () => {
  const v = mm.computeVideoMetrics([
    { impressions: 100, frequency: 3 },
    { impressions: 900, frequency: 1 },
  ]);
  assertAlmostEquals(v.frequency_approx, 1.2, 1e-9);
});

Deno.test("no impressions or views gives null, not 0", () => {
  const v = mm.computeVideoMetrics([{ impressions: 0, video_views: 0 }]);
  assertEquals(v, { hook_rate: null, hold_rate: null, avg_play_time: null, frequency_approx: null });
});

Deno.test("an accumulator fed row by row matches the batch result", () => {
  const rows = [
    { impressions: 100, video_views: 100, hold_rate: 20, video_avg_play_time: 3, frequency: 2 },
    { impressions: 10000, video_views: 1000, hold_rate: 5, video_avg_play_time: 1, frequency: 1.1 },
  ];
  const acc = mm.emptyVideoAccumulator();
  for (const r of rows) mm.addVideoRow(acc, r);
  assertEquals(mm.videoMetricsFromAccumulator(acc), mm.computeVideoMetrics(rows));
});

Deno.test("reports and scheduled-reports use the shared video math, not per-day averages", async () => {
  // The reports function aggregates through _shared/standard-report.ts (audit 6.3).
  const reportsSrc = await Deno.readTextFile(new URL("../reports/index.ts", import.meta.url));
  assert(reportsSrc.includes('from "../_shared/standard-report.ts"'), "reports must use the shared standard report build");
  for (const file of ["./standard-report.ts", "../scheduled-reports/index.ts"]) {
    const fn = file;
    const src = await Deno.readTextFile(new URL(file, import.meta.url));
    assertEquals(/_tsr_sum\s*\/\s*days/.test(src), false, `${fn} still averages hook rate per day`);
    assertEquals(/_hr_sum\s*\/\s*days/.test(src), false, `${fn} still averages hold rate per day`);
    assert(src.includes("videoMetricsFromAccumulator("), `${fn} must use videoMetricsFromAccumulator`);
  }
});
