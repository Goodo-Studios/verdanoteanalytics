/**
 * Winner selection — SPEND FIRST, and in lockstep with the Library classifier.
 *
 * Regression: the Overview / client "What's working" surface gated winners on a
 * ROAS threshold (roas >= 2.0) while the Creative Library classifier gated on
 * relative spend. Same account, same day, two different winner sets — and the
 * ROAS gate contradicted the spend-first rule outright.
 *
 * The equivalence block below is the load-bearing part: it runs the real
 * classifier over the same fixtures and asserts both agree, so the frontend
 * mirror cannot silently drift from `classifyAll`.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_HIGH_SPEND_PERCENTILE,
  DEFAULT_MIN_SPEND,
  selectWinners,
  spendPercentiles,
} from "@/lib/winnerSelection";
import {
  DEFAULT_CLASSIFICATION_CONFIG,
  classifyAll,
  selectWinnersBySpend,
} from "../../supabase/functions/_shared/creative-classification.ts";

/** A non-fatiguing ad: flat trend, low frequency — so spend alone decides. */
const ad = (ad_id: string, spend: number, roas: number) => ({
  ad_id,
  spend,
  roas,
  cpa: 20,
  purchases: Math.max(1, Math.round(spend / 20)),
  ctr: 1.5,
  thumb_stop_rate: 20,
  frequency: 1.2,
  recent_spend: spend / 2,
  prior_spend: spend / 2,
  recent_roas: roas,
  prior_roas: roas,
  recent_ctr: 1.5,
  prior_ctr: 1.5,
  recent_cpa: 20,
  prior_cpa: 20,
});

// Ten ads spanning the spend range, with ROAS deliberately INVERTED against
// spend: the biggest spenders are the least efficient. Under the old ROAS gate
// the winners were the cheap efficient ads; under spend-first they are the
// big-budget ones. No fixture can satisfy both.
const COHORT = [
  ad("a1", 100, 5.0), ad("a2", 200, 4.5), ad("a3", 400, 4.0),
  ad("a4", 800, 3.5), ad("a5", 1200, 3.0), ad("a6", 2000, 2.5),
  ad("a7", 3000, 1.8), ad("a8", 5000, 1.4), ad("a9", 8000, 1.1),
  ad("a10", 12000, 0.9),
];

describe("defaults match the classifier", () => {
  it("uses the same minSpend and high-spend percentile", () => {
    expect(DEFAULT_MIN_SPEND).toBe(DEFAULT_CLASSIFICATION_CONFIG.minSpend);
    expect(DEFAULT_HIGH_SPEND_PERCENTILE).toBe(
      DEFAULT_CLASSIFICATION_CONFIG.highSpendPercentile,
    );
  });
});

describe("selectWinners is spend-first", () => {
  it("picks the biggest spenders even though they have the WORST roas", () => {
    const winners = selectWinners(COHORT).map((c) => c.ad_id);
    expect(winners).toContain("a10"); // 12000 spend, 0.9x roas
    expect(winners).toContain("a9");
    expect(winners).not.toContain("a1"); // 100 spend, 5.0x roas
  });

  it("does not let a high roas rescue a low spender", () => {
    const winners = selectWinners([...COHORT, ad("star", 120, 12.0)]);
    expect(winners.map((c) => c.ad_id)).not.toContain("star");
  });

  it("ranks winners by spend, biggest bet first", () => {
    const spends = selectWinners(COHORT).map((c) => c.spend);
    expect(spends).toEqual([...spends].sort((a, b) => b - a));
  });

  it("excludes ads below the minimum spend entirely", () => {
    const winners = selectWinners([...COHORT, ad("tiny", 5, 9.0)]);
    expect(winners.map((c) => c.ad_id)).not.toContain("tiny");
  });

  it("honours an explicit fatigue exclusion at the top of the spend range", () => {
    const top = selectWinners(COHORT)[0].ad_id;
    const winners = selectWinners(COHORT, { excludeAdIds: new Set([top]) });
    expect(winners.map((c) => c.ad_id)).not.toContain(top);
  });

  it("returns nothing when no ad clears the minimum spend", () => {
    expect(selectWinners([ad("x", 10, 4), ad("y", 20, 3)])).toEqual([]);
  });

  it("returns nothing for an empty list", () => {
    expect(selectWinners([])).toEqual([]);
  });
});

describe("spendPercentiles mirrors classifyAll's cohort rule", () => {
  it("excludes sub-minSpend ads from the cohort", () => {
    // A long tail of tiny ads must not drag the real ads' percentiles up.
    const withTail = [100, 200, 400, 800, ...Array(50).fill(1)];
    const pct = spendPercentiles(withTail);
    expect(pct(100)).toBe(0);
    expect(pct(800)).toBe(0.75);
  });

  it("returns 0.5 when every ad in the cohort spent the same", () => {
    const pct = spendPercentiles([500, 500, 500]);
    expect(pct(500)).toBe(0.5);
  });

  it("returns 0 for an empty cohort", () => {
    expect(spendPercentiles([])(100)).toBe(0);
  });
});

describe("equivalence with the Library classifier", () => {
  const classifierWinners = (rows: typeof COHORT) =>
    [...classifyAll(rows, DEFAULT_CLASSIFICATION_CONFIG).values()]
      .filter((r) => r.klass === "winner")
      .map((r) => r.ad_id)
      .sort();

  it("agrees on the winner set for the inverted-roas cohort", () => {
    expect(selectWinners(COHORT).map((c) => c.ad_id).sort())
      .toEqual(classifierWinners(COHORT));
  });

  it("agrees when every ad spends the same", () => {
    const flat = ["f1", "f2", "f3", "f4"].map((id) => ad(id, 500, 2.0));
    expect(selectWinners(flat).map((c) => c.ad_id).sort())
      .toEqual(classifierWinners(flat));
  });

  it("agrees when only one ad clears the minimum spend", () => {
    const sparse = [ad("big", 5000, 1.0), ad("t1", 10, 8), ad("t2", 20, 7)];
    expect(selectWinners(sparse).map((c) => c.ad_id).sort())
      .toEqual(classifierWinners(sparse));
  });

  it("agrees across a wide randomised-ish spread", () => {
    const spread = Array.from({ length: 40 }, (_, i) =>
      ad(`s${i}`, (i % 7) * 900 + i * 37 + 50, 4 - i * 0.05));
    expect(selectWinners(spread).map((c) => c.ad_id).sort())
      .toEqual(classifierWinners(spread));
  });
});

describe("equivalence with the shared report-side selector", () => {
  // selectWinnersBySpend is what the reports / scheduled-reports edge functions
  // now call, so this pins the exported client number to the exported server one.
  const cases: Array<[string, typeof COHORT]> = [
    ["the inverted-roas cohort", COHORT],
    ["a flat cohort", ["f1", "f2", "f3", "f4"].map((id) => ad(id, 500, 2.0))],
    ["a single qualifying ad", [ad("big", 5000, 1.0), ad("t1", 10, 8)]],
    ["everything below minimum spend", [ad("t1", 10, 8), ad("t2", 20, 7)]],
    ["a wide spread", Array.from({ length: 40 }, (_, i) =>
      ad(`s${i}`, (i % 7) * 900 + i * 37 + 50, 4 - i * 0.05))],
  ];

  for (const [name, rows] of cases) {
    it(`returns the same winners as the server for ${name}`, () => {
      expect(selectWinners(rows).map((c) => c.ad_id))
        .toEqual(selectWinnersBySpend(rows).map((c) => c.ad_id));
    });
  }
});
