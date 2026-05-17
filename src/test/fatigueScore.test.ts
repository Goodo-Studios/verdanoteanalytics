import { describe, it, expect } from "vitest";
import { computeFatigue, computeFatigueMap } from "@/lib/fatigueScore";
import type { WoWTrend } from "@/hooks/useWoWTrends";

const flat: WoWTrend = { thisWeekRoas: 2.0, priorWeekRoas: 2.0, pctChange: 0, direction: "flat", label: "flat" };
const bigDrop: WoWTrend = { thisWeekRoas: 1.0, priorWeekRoas: 2.5, pctChange: -60, direction: "down", label: "-60%" };
const smallDrop: WoWTrend = { thisWeekRoas: 1.8, priorWeekRoas: 2.0, pctChange: -10, direction: "down", label: "-10%" };
const insufficient: WoWTrend = { thisWeekRoas: 0, priorWeekRoas: 0, pctChange: 0, direction: "insufficient", label: "n/a" };

describe("computeFatigue", () => {
  it("returns score 0 and level ok for a brand-new creative with no signals", () => {
    const result = computeFatigue({ frequency: 1, roas: 2.0 });
    expect(result.score).toBe(0);
    expect(result.level).toBe("ok");
    expect(result.reasons).toHaveLength(0);
  });

  it("adds +50 for frequency > 5", () => {
    const result = computeFatigue({ frequency: 6, roas: 2.0 });
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.reasons.some((r) => r.includes("High frequency"))).toBe(true);
  });

  it("adds +30 for frequency between 3 and 5", () => {
    const result = computeFatigue({ frequency: 4, roas: 2.0 });
    expect(result.score).toBe(30);
    expect(result.reasons.some((r) => r.includes("Rising frequency"))).toBe(true);
  });

  it("adds +25 and +20 for ROAS drop > 20%", () => {
    // drop of 60% triggers both the >20% (+25) and >15% (+20) rules
    const result = computeFatigue({ frequency: 0, roas: 1.0 }, bigDrop);
    expect(result.score).toBe(45);
    expect(result.reasons.some((r) => r.includes("ROAS declined"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("CTR declining"))).toBe(true);
  });

  it("adds only +20 for ROAS drop between 15% and 20%", () => {
    const trend: WoWTrend = { ...flat, pctChange: -17, direction: "down" };
    const result = computeFatigue({ frequency: 0, roas: 1.5 }, trend);
    expect(result.score).toBe(20);
  });

  it("ignores insufficient WoW trend", () => {
    const result = computeFatigue({ frequency: 0, roas: 2.0 }, insufficient);
    expect(result.score).toBe(0);
  });

  it("adds +10 for 14-20 consecutive spend days", () => {
    const result = computeFatigue({ frequency: 0, roas: 2.0 }, flat, 15);
    expect(result.score).toBe(10);
  });

  it("adds +20 for 21+ consecutive spend days", () => {
    const result = computeFatigue({ frequency: 0, roas: 2.0 }, flat, 21);
    expect(result.score).toBe(20);
  });

  it("clamps score at 100", () => {
    const result = computeFatigue({ frequency: 6, roas: 1.0 }, bigDrop, 21);
    expect(result.score).toBe(100);
  });

  it("handles zero/null inputs without throwing", () => {
    expect(() => computeFatigue({ frequency: null, roas: null } as any)).not.toThrow();
  });

  it("level is high at score >= 60", () => {
    const result = computeFatigue({ frequency: 6, roas: 2.0 }, flat, 21);
    expect(result.score).toBe(70);
    expect(result.level).toBe("high");
  });

  it("level is warning at score 40-59", () => {
    // frequency=4 (+30) + 14 days (+10) = 40
    const result = computeFatigue({ frequency: 4, roas: 2.0 }, flat, 14);
    expect(result.score).toBe(40);
    expect(result.level).toBe("warning");
  });
});

describe("computeFatigueMap", () => {
  it("returns empty map for empty creatives", () => {
    expect(computeFatigueMap([]).size).toBe(0);
  });

  it("computes scores for multiple creatives", () => {
    const creatives = [
      { ad_id: "a1", frequency: 6, roas: 1.0 },
      { ad_id: "a2", frequency: 1, roas: 3.0 },
    ];
    const result = computeFatigueMap(creatives);
    expect(result.get("a1")!.score).toBeGreaterThanOrEqual(50);
    expect(result.get("a2")!.score).toBe(0);
  });

  // M-8 regression: consecutive day count should use max date in dataset, not new Date().
  // This test verifies the current behavior: if daily data ends 2 days ago, consecutive count is 0
  // because the code anchors to `new Date()` (today). A future fix would anchor to max date.
  it("consecutive count is 0 when dataset ends before today (new Date() anchor)", () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const dailyMetrics = [
      { ad_id: "a1", date: twoDaysAgo.toISOString().split("T")[0], spend: 100 },
      { ad_id: "a1", date: threeDaysAgo.toISOString().split("T")[0], spend: 100 },
    ];
    const creatives = [{ ad_id: "a1", frequency: 0, roas: 2.0 }];
    const result = computeFatigueMap(creatives, undefined, dailyMetrics);
    // With new Date() anchor, today is not present → consecutive streak = 0
    expect(result.get("a1")!.score).toBe(0);
  });
});
