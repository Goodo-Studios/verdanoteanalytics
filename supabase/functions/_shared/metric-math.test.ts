//   deno test supabase/functions/_shared/metric-math.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  blendedMetricsFromTotals,
  computeBlendedMetrics,
  type MetricRowLike,
  ratioOrNull,
  roundOrNull,
  sumMetricTotals,
} from "./metric-math.ts";

interface Case {
  name: string;
  rows: MetricRowLike[];
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
  cpm: number | null;
}

const cases: Case[] = [
  {
    name: "no rows: every ratio is null",
    rows: [],
    roas: null, cpa: null, ctr: null, cpm: null,
  },
  {
    name: "single row",
    rows: [{ spend: 100, impressions: 10000, clicks: 200, purchases: 4, purchase_value: 400 }],
    roas: 4, cpa: 25, ctr: 2, cpm: 10,
  },
  {
    name: "big and tiny ads are weighted by spend, not averaged per ad",
    rows: [
      { spend: 1000, impressions: 100000, clicks: 1000, purchases: 20, purchase_value: 2000 },
      { spend: 1, impressions: 10, clicks: 5, purchases: 1, purchase_value: 50 },
    ],
    // an unweighted mean of per-ad ROAS would be (2 + 50) / 2 = 26
    roas: 2050 / 1001, cpa: 1001 / 21, ctr: (1005 / 100010) * 100, cpm: (1001 / 100010) * 1000,
  },
  {
    name: "zero-purchase ad does not drag CPA to 0",
    rows: [
      { spend: 100, impressions: 1000, clicks: 10, purchases: 5, purchase_value: 250 },
      { spend: 100, impressions: 1000, clicks: 10, purchases: 0, purchase_value: 0 },
    ],
    // an unweighted mean of per-ad CPA (20 and 0) would be 10
    roas: 1.25, cpa: 40, ctr: 1, cpm: 100,
  },
  {
    name: "spend but zero purchases: cpa is null, roas is 0",
    rows: [{ spend: 50, impressions: 5000, clicks: 25, purchases: 0, purchase_value: 0 }],
    roas: 0, cpa: null, ctr: 0.5, cpm: 10,
  },
  {
    name: "no spend: roas and cpa null",
    rows: [{ spend: 0, impressions: 100, clicks: 1, purchases: 0, purchase_value: 0 }],
    roas: null, cpa: null, ctr: 1, cpm: 0,
  },
  {
    name: "no impressions: ctr and cpm null",
    rows: [{ spend: 10, impressions: 0, clicks: 0, purchases: 1, purchase_value: 30 }],
    roas: 3, cpa: 10, ctr: null, cpm: null,
  },
  {
    name: "strings, nulls and undefined are coerced",
    rows: [
      { spend: "20", impressions: "2000", clicks: "20", purchases: "2", purchase_value: "60" },
      { spend: null, impressions: undefined, clicks: null, purchases: null, purchase_value: null },
      { spend: "abc" },
    ],
    roas: 3, cpa: 10, ctr: 1, cpm: 10,
  },
];

for (const c of cases) {
  Deno.test(`computeBlendedMetrics: ${c.name}`, () => {
    const m = computeBlendedMetrics(c.rows);
    for (const k of ["roas", "cpa", "ctr", "cpm"] as const) {
      const want = c[k];
      const got = m[k];
      if (want === null) assertEquals(got, null, k);
      else assertEquals(got !== null && Math.abs(got - want) < 1e-9, true, `${k}: ${got} vs ${want}`);
    }
  });
}

Deno.test("sumMetricTotals sums every field", () => {
  assertEquals(
    sumMetricTotals([
      { spend: 1, impressions: 2, clicks: 3, purchases: 4, purchase_value: 5 },
      { spend: 10, impressions: 20, clicks: 30, purchases: 40, purchase_value: 50 },
    ]),
    { spend: 11, impressions: 22, clicks: 33, purchases: 44, purchase_value: 55 },
  );
});

Deno.test("blendedMetricsFromTotals keeps the totals alongside the ratios", () => {
  const m = blendedMetricsFromTotals({ spend: 100, impressions: 1000, clicks: 10, purchases: 2, purchase_value: 300 });
  assertEquals(m.spend, 100);
  assertEquals(m.roas, 3);
  assertEquals(m.cpa, 50);
});

Deno.test("ratioOrNull treats zero and negative denominators as no data", () => {
  assertEquals(ratioOrNull(5, 0), null);
  assertEquals(ratioOrNull(5, -1), null);
  assertEquals(ratioOrNull(5, 2), 2.5);
  assertEquals(ratioOrNull(1, 4, 100), 25);
});

Deno.test("roundOrNull rounds and preserves null", () => {
  assertEquals(roundOrNull(null, 2), null);
  assertEquals(roundOrNull(1.2345, 2), 1.23);
  assertEquals(roundOrNull(0, 2), 0);
});
