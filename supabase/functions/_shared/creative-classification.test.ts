// F6 classifier regression tests.
//
//   deno test supabase/functions/_shared/creative-classification.test.ts
//
// Covers the four labels, their precedence (fatiguing beats a still-high-ROAS
// winner), the sub-minSpend gate, and relative-change edge cases (prior=0).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classCounts,
  classifyAll,
  classifyOne,
  DEFAULT_CLASSIFICATION_CONFIG as CFG,
  relChange,
  type ClassificationInput,
} from "./creative-classification.ts";

// A neutral, healthy baseline: high spend, ROAS just under winner threshold,
// flat trend, low frequency. Individual tests override the fields they exercise.
function baseline(overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  return {
    ad_id: "A",
    spend: 1000,
    roas: 1.5,
    cpa: 20,
    ctr: 2,
    thumb_stop_rate: 20,
    purchases: 50,
    frequency: 1.5,
    recent_spend: 500,
    prior_spend: 500,
    recent_roas: 1.5,
    prior_roas: 1.5,
    recent_ctr: 2,
    prior_ctr: 2,
    recent_cpa: 20,
    prior_cpa: 20,
    ...overrides,
  };
}

Deno.test("relChange: prior<=0 yields 0 (no divide-by-zero blow-up)", () => {
  assertEquals(relChange(5, 0), 0);
  assertEquals(relChange(0, 0), 0);
  assertEquals(Math.abs(relChange(1.2, 1.0) - 0.2) < 1e-9, true);
});

Deno.test("sub-minSpend ad is always neutral", () => {
  const r = classifyOne(baseline({ spend: 50, roas: 10 }), 0.99, CFG);
  assertEquals(r.klass, "neutral");
});

Deno.test("winner: high spend + strong ROAS", () => {
  const r = classifyOne(baseline({ roas: 3.0 }), 0.9, CFG);
  assertEquals(r.klass, "winner");
});

Deno.test("winner is SPEND-FIRST: top-spend ad wins with mediocre ROAS + flat trend", () => {
  // roas 1.5 (below roasWinner 2.0), thumbstop 20 (below 30), flat trend.
  // Winners are decided by spend first, not ROAS — a top-spend, non-fatiguing ad
  // is a Winner regardless of efficiency.
  const r = classifyOne(baseline({ roas: 1.5, thumb_stop_rate: 20 }), 0.9, CFG);
  assertEquals(r.klass, "winner");
});

Deno.test("winner: high spend, low ROAS but strong thumbstop", () => {
  const r = classifyOne(baseline({ roas: 1.2, thumb_stop_rate: 35 }), 0.9, CFG);
  assertEquals(r.klass, "winner");
});

Deno.test("high ROAS but LOW relative spend is NOT a winner (spend-first)", () => {
  // Not high spend (percentile below highSpendPercentile) and flat trend => neutral.
  const r = classifyOne(baseline({ roas: 3.0 }), 0.1, CFG);
  assertEquals(r.klass, "neutral");
});

Deno.test("fatiguing beats winner: high ROAS but CTR collapsing", () => {
  const r = classifyOne(
    baseline({ roas: 3.0, recent_ctr: 1.0, prior_ctr: 2.0 }), // -50% CTR
    0.9,
    CFG,
  );
  assertEquals(r.klass, "fatiguing");
});

Deno.test("fatiguing: CPA rising past threshold", () => {
  const r = classifyOne(
    baseline({ recent_cpa: 30, prior_cpa: 20 }), // +50% CPA
    0.5,
    CFG,
  );
  assertEquals(r.klass, "fatiguing");
});

Deno.test("fatiguing: frequency saturated even with flat trend", () => {
  const r = classifyOne(baseline({ frequency: 5 }), 0.5, CFG);
  assertEquals(r.klass, "fatiguing");
});

Deno.test("rising: improving ROAS trend on a spending ad without winner scale", () => {
  const r = classifyOne(
    baseline({ roas: 1.4, recent_roas: 1.8, prior_roas: 1.4 }), // +28% ROAS
    0.4, // not high spend
    CFG,
  );
  assertEquals(r.klass, "rising");
});

Deno.test("rising: improving CTR trend", () => {
  const r = classifyOne(
    baseline({ recent_ctr: 2.6, prior_ctr: 2.0 }), // +30% CTR
    0.4,
    CFG,
  );
  assertEquals(r.klass, "rising");
});

Deno.test("classifyAll computes spend percentile within the spending cohort", () => {
  const rows: ClassificationInput[] = [
    baseline({ ad_id: "low", spend: 150, roas: 3.0 }),   // lowest spender
    baseline({ ad_id: "mid", spend: 5000, roas: 3.0 }),
    baseline({ ad_id: "high", spend: 20000, roas: 3.0 }), // top spender
    // A long tail of sub-minSpend ads must NOT dilute the cohort.
    baseline({ ad_id: "tail1", spend: 5 }),
    baseline({ ad_id: "tail2", spend: 5 }),
  ];
  const map = classifyAll(rows, CFG);
  // Top spender clears the 0.6 percentile with strong ROAS => winner.
  assertEquals(map.get("high")!.klass, "winner");
  // Lowest spender (percentile 0) with strong ROAS but flat trend => neutral.
  assertEquals(map.get("low")!.klass, "neutral");
  // Sub-scale tail is neutral.
  assertEquals(map.get("tail1")!.klass, "neutral");
});

Deno.test("classCounts tallies labels", () => {
  const rows: ClassificationInput[] = [
    baseline({ ad_id: "w", spend: 20000, roas: 3.0 }),
    baseline({ ad_id: "f", spend: 5000, frequency: 6 }),
    baseline({ ad_id: "n", spend: 200 }),
  ];
  const counts = classCounts(classifyAll(rows, CFG).values());
  assertEquals(counts.winner, 1);
  assertEquals(counts.fatiguing, 1);
  assertEquals(counts.neutral, 1);
  assertEquals(counts.rising, 0);
});
