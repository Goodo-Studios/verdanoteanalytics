// Regression tests for the `creatives` edge function aggregation helpers.
//
//   deno test supabase/functions/_shared/creatives-aggregate.test.ts
//
// Covers two date-picker bugs:
//   • Bug 1 — empty date range must aggregate to ZERO, never silently fall back
//     to lifetime spend. The helpers return {}/zeros for empty input; the
//     handler's empty-range branch returns that zero result.
//   • Bug 3 — portfolio avg ROAS/CPA must be SPEND-WEIGHTED (Σvalue/Σspend),
//     matching get_period_metrics, not an unweighted mean of per-ad ratios.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  aggregateDailyByAd,
  computeWeightedAggregates,
  type DailyMetricRow,
} from "./creatives-aggregate.ts";

const approx = (a: number, b: number, eps = 1e-6) =>
  assertEquals(Math.abs(a - b) < eps, true, `${a} ≈ ${b}`);

Deno.test("aggregateDailyByAd sums an ad's spend across the picked days", () => {
  const rows: DailyMetricRow[] = [
    { ad_id: "A", spend: 100, impressions: 1000, clicks: 10, purchases: 2, purchase_value: 400 },
    { ad_id: "A", spend: 150, impressions: 2000, clicks: 20, purchases: 3, purchase_value: 600 },
    { ad_id: "B", spend: 50, impressions: 500, clicks: 5, purchases: 1, purchase_value: 90 },
  ];
  const agg = aggregateDailyByAd(rows);
  assertEquals(agg["A"].spend, 250);
  assertEquals(agg["A"].impressions, 3000);
  assertEquals(agg["A"].purchases, 5);
  assertEquals(agg["A"].purchase_value, 1000);
  assertEquals(agg["A"]._days, 2);
  assertEquals(agg["B"].spend, 50);
});

Deno.test("aggregateDailyByAd impression-weights rate metrics (frequency, thumb-stop)", () => {
  const rows: DailyMetricRow[] = [
    { ad_id: "A", impressions: 1000, frequency: 1, thumb_stop_rate: 10 },
    { ad_id: "A", impressions: 3000, frequency: 2, thumb_stop_rate: 30 },
  ];
  const agg = aggregateDailyByAd(rows);
  // weighted freq = (1*1000 + 2*3000) / 4000 = 1.75
  approx(agg["A"]._freq_weighted / agg["A"]._freq_imp, 1.75);
  // weighted tsr = (10*1000 + 30*3000) / 4000 = 25
  approx(agg["A"]._tsr_weighted / agg["A"]._tsr_imp, 25);
});

Deno.test("Bug 1: empty range aggregates to nothing (no lifetime fallback)", () => {
  assertEquals(aggregateDailyByAd([]), {});
  assertEquals(computeWeightedAggregates([]), { total_spend: 0, avg_cpa: 0, avg_roas: 0 });
});

Deno.test("Bug 3: avg ROAS/CPA is spend-weighted, not an unweighted mean of ratios", () => {
  // Big-spend ad at ROAS 2.0, tiny-spend ad at ROAS 5.0.
  const items = [
    { spend: 1000, purchases: 40, purchase_value: 2000 }, // roas 2.0, cpa 25
    { spend: 10, purchases: 5, purchase_value: 50 },       // roas 5.0, cpa 2
  ];
  const { total_spend, avg_roas, avg_cpa } = computeWeightedAggregates(items);
  assertEquals(total_spend, 1010);
  // Weighted: 2050 / 1010 ≈ 2.0297 — NOT the unweighted mean (3.5).
  approx(avg_roas, 2050 / 1010);
  assertEquals(Math.abs(avg_roas - 3.5) > 1, true, "must not be the unweighted mean");
  // Weighted CPA: 1010 / 45 ≈ 22.44 — NOT the unweighted mean (13.5).
  approx(avg_cpa, 1010 / 45);
});

Deno.test("computeWeightedAggregates coerces string/null inputs and avoids div-by-zero", () => {
  const items = [
    { spend: "100", purchases: null, purchase_value: "250" },
    { spend: null, purchases: undefined as unknown as number, purchase_value: null },
  ];
  const r = computeWeightedAggregates(items);
  assertEquals(r.total_spend, 100);
  assertEquals(r.avg_cpa, 0); // zero purchases → no division
  approx(r.avg_roas, 2.5);
});
