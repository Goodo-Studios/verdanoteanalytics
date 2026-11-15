/**
 * Growth Dashboard: month matching is year-aware, and a month that has not started yet
 * reads as upcoming instead of behind.
 */
import { describe, it, expect } from "vitest";
import {
  computeKpis,
  dealTally,
  emptyPlan,
  monthOut,
  withDefaults,
  type GrowthPlan,
} from "@/features/growth-dashboard/model";

const now = new Date(2026, 10, 15);

function testPlan(): GrowthPlan {
  const p = emptyPlan(2026);
  return {
    ...p,
    goal: 10000,
    h1Actuals: [100, 100, 100, 100, 100, 100],
    months: p.months.map((_, i) => ({ rev: 1000, calls: 10 + i, signings: 1 + i, active: 2 * (i + 1), newMrr: 50, base: 40, projects: 10 })),
  };
}

describe("year-aware month matching", () => {
  it("deal tally ignores deals from the same month of another year", () => {
    const s = withDefaults({
      deals: [
        { id: "a", date: "2026-11-02", client: "A", price: 1000 },
        { id: "b", date: "2025-11-05", client: "B", price: 2000 },
      ],
    });
    const t = dealTally(s, testPlan(), now);
    expect(t.count).toBe(1);
    expect(t.value).toBe(1000);
  });

  it("computeKpis counts only plan-year calls and deals", () => {
    const s = withDefaults({
      calls: { "2026-11-03": 4, "2025-11-03": 9 },
      deals: [
        { id: "a", date: "2026-11-02", client: "A", price: 1000 },
        { id: "b", date: "2025-11-05", client: "B", price: 2000 },
      ],
    });
    const k = computeKpis(s, testPlan(), now);
    expect(k.mCalls).toBe(4);
    expect(k.dealsMo).toBe(1);
    expect(k.mrrMo).toBe(1000);
  });

  it("monthOut filters weekly output by year when given one", () => {
    const s = withDefaults({
      weeks: {
        "2026-11-06": { total: null, paid: null, spend: null, acts: { liConnect: 100 } },
        "2025-11-07": { total: null, paid: null, spend: null, acts: { liConnect: 50 } },
      },
    });
    expect(monthOut(s, 10, 2026)).toBe(100);
    expect(monthOut(s, 10, 2025)).toBe(50);
    expect(monthOut(s, 10)).toBe(150);
  });
});

describe("deal tally upcoming state", () => {
  it("shows July as upcoming (not behind) in January through June", () => {
    const s = withDefaults({});
    for (const d of [new Date(2026, 0, 15), new Date(2026, 5, 30)]) {
      const t = dealTally(s, testPlan(), d);
      expect(t.month).toBe("Jul");
      expect(t.pill).toEqual({ cls: "na", text: "upcoming" });
    }
  });

  it("still reports behind once the month has started", () => {
    const t = dealTally(withDefaults({}), testPlan(), new Date(2026, 6, 20));
    expect(t.pill).toEqual({ cls: "crit", text: "behind" });
  });

  it("still reports target hit for an upcoming month that already has enough deals", () => {
    const s = withDefaults({
      deals: Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, date: "2026-07-01", client: "X", price: 1 })),
    });
    expect(dealTally(s, testPlan(), new Date(2026, 0, 15)).pill).toEqual({ cls: "good", text: "target hit" });
  });
});
