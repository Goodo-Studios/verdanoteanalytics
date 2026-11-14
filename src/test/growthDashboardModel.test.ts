/**
 * Growth Dashboard model: the calculations ported from the old page
 * (repos/private/goodo-growth-dashboard/index.html), checked against what the old
 * code computes for the same inputs. All numbers here are made up.
 */
import { describe, it, expect } from "vitest";
import {
  ACTS,
  EXPORT_CONSOLE_COMMAND,
  callTallyPill,
  computeKpis,
  dealTally,
  emptyPlan,
  fmtMoney,
  fridayOf,
  iso,
  parseGrowthImport,
  planFromRow,
  planSummary,
  progressTiles,
  revenueSeries,
  scoreTiles,
  sheetWeeks,
  stateFromRow,
  status,
  targetSum,
  validatePlan,
  weekRange,
  weeksInMonth,
  withDefaults,
  type GrowthPlan,
} from "@/features/growth-dashboard/model";

function testPlan(over: Partial<GrowthPlan> = {}): GrowthPlan {
  const p = emptyPlan(2026);
  return {
    ...p,
    goal: 10000,
    h1Actuals: [100, 100, 100, 100, 100, 100],
    months: p.months.map((_, i) => ({ rev: 1000, calls: 10 + i, signings: 1 + i, active: 2 * (i + 1), newMrr: 50, base: 40, projects: 10 })),
    ...over,
  };
}

describe("formatting and status, as in the old page", () => {
  it("formats money the same way", () => {
    expect(fmtMoney(123456)).toBe("$123k");
    expect(fmtMoney(2345678)).toBe("$2.35M");
    expect(fmtMoney(500)).toBe("$500");
    expect(fmtMoney(-1500)).toBe("-$2k");
  });

  it("grades a count against a target: hit, within 60%, under, or no target", () => {
    expect(status(5, 5)).toBe("good");
    expect(status(3, 5)).toBe("warn");
    expect(status(2, 5)).toBe("crit");
    expect(status(null, 5)).toBe("na");
    expect(status(3, 0)).toBe("na");
  });

  it("keys each week by its Friday", () => {
    expect(iso(fridayOf(new Date(2026, 10, 9)))).toBe("2026-11-13"); // Monday
    expect(iso(fridayOf(new Date(2026, 10, 13)))).toBe("2026-11-13"); // Friday
    expect(iso(fridayOf(new Date(2026, 10, 14)))).toBe("2026-11-20"); // Saturday
  });

  it("labels a week Monday to Sunday", () => {
    expect(weekRange("2026-07-10")).toEqual(["Jul 6", "12"]);
    expect(weekRange("2026-07-31")).toEqual(["Jul 27", "Aug 2"]);
  });

  it("counts week Fridays per month and lists sheet columns from the first week of July", () => {
    expect(weeksInMonth(6, 2026)).toBe(5);
    expect(weeksInMonth(7, 2026)).toBe(4);
    expect(weeksInMonth(11, 2026)).toBe(4);
    expect(sheetWeeks(withDefaults({}), new Date(2026, 6, 20), 2026)).toEqual(["2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24"]);
  });

  it("fills default weekly targets like the old first load", () => {
    const s = withDefaults({ targets: { liPosts: 9 } });
    expect(s.targets.liPosts).toBe(9);
    expect(s.targets.liConnect).toBe(200);
    expect(Object.keys(s.targets)).toHaveLength(ACTS.length);
    expect(targetSum(withDefaults({}))).toBe(266);
  });
});

describe("progress KPIs", () => {
  const now = new Date(2026, 10, 9, 12, 0, 0); // Monday 9 November 2026

  it("projects the year: H1 + entered months + each missing month at the last entered value", () => {
    const k = computeKpis(withDefaults({ rev: { "6": 500, "8": 700 } }), testPlan(), now);
    // 600 (H1) + 500 + 700 (Aug, missing: last entered) + 700 + 700 + 700 + 700
    expect(k.yearProj).toBe(4600);
    expect(k.gap).toBe(10000 - 4600);
  });

  it("falls back to the plan when no month is entered", () => {
    expect(computeKpis(withDefaults({}), testPlan(), now).yearProj).toBe(600 + 6000);
  });

  it("counts calls this month and in the last seven days, deals and MRR this month", () => {
    const s = withDefaults({
      calls: { "2026-11-02": 1, "2026-11-03": 2, "2026-11-09": 3, "2026-10-31": 4 },
      deals: [
        { id: "a", date: "2026-11-02", client: "A", price: 1000 },
        { id: "b", date: "2026-10-15", client: "B", price: 500 },
      ],
    });
    const k = computeKpis(s, testPlan(), now);
    expect(k.mName).toBe("Nov");
    expect(k.mCalls).toBe(6);
    expect(k.wkCalls).toBe(5);
    expect(k.mTarget).toBe(14);
    expect(k.dealsMo).toBe(1);
    expect(k.mrrMo).toBe(1000);
    expect(k.signTgt).toBe(5);
  });

  it("measures this week's adherence against targets above zero", () => {
    const s = withDefaults({ weeks: { "2026-11-13": { total: null, paid: null, spend: null, acts: { liPosts: 5, twPosts: 1 } } } });
    const k = computeKpis(s, testPlan(), now);
    expect([k.hit, k.appl, k.adh]).toEqual([1, 10, 10]);
  });

  it("clamps months before July to July, as the old page did", () => {
    expect(computeKpis(withDefaults({}), testPlan(), new Date(2026, 2, 15)).mName).toBe("Jul");
  });

  it("shows dashes instead of targets when no plan is stored", () => {
    const tiles = progressTiles(computeKpis(withDefaults({}), null, now), null);
    expect(tiles[0].foot).toBe("goal not set");
    expect(tiles[2].value).toBe("0 / -");
  });
});

describe("tally pills", () => {
  const now = new Date(2026, 10, 15);
  it("call tally: target hit, on track, behind, upcoming", () => {
    expect(callTallyPill(10, 10, 2026, 10, now)).toEqual({ cls: "good", text: "target hit" });
    expect(callTallyPill(5, 10, 2026, 10, now)).toEqual({ cls: "good", text: "on track" });
    expect(callTallyPill(3, 10, 2026, 10, now)).toEqual({ cls: "warn", text: "behind" });
    expect(callTallyPill(2, 10, 2026, 10, now)).toEqual({ cls: "crit", text: "behind" });
    expect(callTallyPill(0, 10, 2026, 11, now)).toEqual({ cls: "na", text: "upcoming" });
    expect(callTallyPill(9, 10, 2026, 9, now)).toEqual({ cls: "warn", text: "behind" });
    expect(callTallyPill(3, null, 2026, 10, now)).toBeNull();
  });

  it("deal tally counts this month's deals against the signing target", () => {
    const s = withDefaults({
      deals: [
        { id: "a", date: "2026-11-02", client: "A", price: 1000 },
        { id: "b", date: "2026-11-05", client: "B", price: 2000 },
        { id: "c", date: "2026-10-05", client: "C", price: 300 },
      ],
    });
    const t = dealTally(s, testPlan(), now);
    expect(t).toMatchObject({ month: "Nov", count: 2, target: 5, value: 3000, allValue: 3300 });
    // 5 * 15/30 = 2.5 expected by today; 2 >= 1.5 is "behind" in amber
    expect(t.pill).toEqual({ cls: "warn", text: "behind" });
  });
});

describe("outputs score", () => {
  it("counts the streak of weeks at 80% of target, the best week and the change from last week", () => {
    const s = withDefaults({
      weeks: {
        "2026-07-03": { total: null, paid: null, spend: null, acts: { liConnect: 100 } },
        "2026-07-10": { total: null, paid: null, spend: null, acts: { liConnect: 220 } },
        "2026-07-17": { total: null, paid: null, spend: null, acts: { liConnect: 213 } },
      },
    });
    const tiles = scoreTiles(s, testPlan({ targetsFrom: "2026-07-10" }));
    expect(tiles.map((t) => t.value)).toEqual(["533", "2 wks", "220", "213"]);
    expect(tiles[3].foot).toBe("▼ 7 vs last week");
  });
});

describe("revenue chart series", () => {
  it("draws H1 actuals, the plan from the end of June, and entered actuals until the first gap", () => {
    const rows = revenueSeries(withDefaults({ rev: { "6": 500, "7": 600, "9": 700 } }), testPlan(), true);
    expect(rows.map((r) => r.actual)).toEqual([100, 200, 300, 400, 500, 600, null, null, null, null, null, null]);
    expect(rows.map((r) => r.plan)).toEqual([null, null, null, null, null, 600, 1600, 2600, 3600, 4600, 5600, 6600]);
    expect(rows.map((r) => r.entered)).toEqual([null, null, null, null, null, 600, 1100, 1700, null, null, null, null]);
    expect(rows.every((r) => r.goal === 10000)).toBe(true);
  });

  it("draws nothing but empty series without a plan", () => {
    const rows = revenueSeries(withDefaults({ rev: { "6": 500 } }), null, true);
    expect(rows.every((r) => r.plan === null && r.actual === null && r.entered === null && r.goal === null)).toBe(true);
  });

  it("summarises the plan the way the old Plan tab tiles did", () => {
    expect(planSummary(testPlan())).toMatchObject({
      goal: 10000,
      projectedFinish: 6600,
      exitRunRate: 1000,
      clientsToSign: 21,
      activeByDec: 12,
      h2Revenue: 6000,
      firstSignings: 1,
      lastSignings: 6,
    });
  });
});

describe("one-time import of the old localStorage export", () => {
  const sample = {
    rev: { "6": 1234, "7": null },
    weeks: { "2026-07-10": { total: null, paid: null, spend: null, acts: { liPosts: 4, oldChannel: 2 } } },
    targets: { liPosts: 6, twPosts: 5, mystery: 3 },
    calls: { "2026-07-08": 2, "2026-07-09": null },
    deals: [{ id: 1720000000000, date: "2026-07-09", client: "Test Co", price: 1500 }],
  };

  it("accepts the old app's shape and reports what it found", () => {
    const r = parseGrowthImport(JSON.stringify(sample));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toEqual({ revMonths: 1, callDays: 1, deals: 1, weeks: 1 });
    expect(r.state.rev).toEqual({ "6": 1234 });
    expect(r.state.deals[0]).toEqual({ id: "1720000000000", date: "2026-07-09", client: "Test Co", price: 1500 });
    expect(r.state.targets.liPosts).toBe(6);
    expect(r.state.targets.liConnect).toBe(200);
    expect(r.state.targets).not.toHaveProperty("mystery");
    expect(r.state.weeks["2026-07-10"].acts).toEqual({ liPosts: 4, oldChannel: 2 });
    expect(r.warnings.join(" ")).toMatch(/oldChannel/);
    expect(r.warnings.join(" ")).toMatch(/mystery/);
  });

  it("accepts the export encoded once more as a JSON string", () => {
    const r = parseGrowthImport(JSON.stringify(JSON.stringify(sample)));
    expect(r.ok).toBe(true);
  });

  it.each([
    ["", /Paste the exported JSON/],
    ["not json", /not valid JSON/],
    ["[1,2]", /JSON object/],
    ["{}", /nothing to import/],
    [JSON.stringify({ rev: { "5": 10 } }), /unknown month "5"/],
    [JSON.stringify({ rev: { "6": "10" } }), /rev for Jul is not a number/],
    [JSON.stringify({ calls: { "2026-13-01": 1 } }), /invalid date "2026-13-01"/],
    [JSON.stringify({ calls: { "2026-07-01": -1 } }), /not a count/],
    [JSON.stringify({ deals: [{ date: "2026-07-01", client: "X" }] }), /deal 1 has no valid monthly price/],
    [JSON.stringify({ deals: {} }), /deals must be a list/],
    [JSON.stringify({ weeks: { "2026-07-10": { acts: { liPosts: "4" } } } }), /not a number/],
  ])("rejects %s", (input, message) => {
    const r = parseGrowthImport(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(message);
  });

  it("documents the console command that reads the old app's localStorage key", () => {
    expect(EXPORT_CONSOLE_COMMAND).toBe("copy(localStorage.getItem('goodo3m_v1'))");
  });

  it("loads an empty stored state, and refuses a malformed one instead of guessing", () => {
    expect(stateFromRow(null).state?.targets.liPosts).toBe(5);
    expect(stateFromRow({ targets: { liPosts: 7 } }).state?.targets.liPosts).toBe(7);
    const bad = stateFromRow({ rev: { "6": "lots" } });
    expect(bad.state).toBeNull();
    expect(bad.error).toMatch(/not a number/);
  });
});

describe("plan validation", () => {
  it("accepts a complete plan", () => {
    expect(validatePlan(testPlan())).toEqual([]);
    expect(planFromRow(testPlan())).not.toBeNull();
  });

  it("rejects missing or negative numbers and bad dates", () => {
    const bad = { ...testPlan(), year: 1999, goal: -1, targetsFrom: "July" };
    bad.months = bad.months.map((m, i) => (i === 2 ? { ...m, rev: NaN } : m));
    const errs = validatePlan(bad);
    expect(errs.join(" ")).toMatch(/Year/);
    expect(errs.join(" ")).toMatch(/Goal/);
    expect(errs.join(" ")).toMatch(/Sep/);
    expect(errs.join(" ")).toMatch(/Targets-from/);
    expect(planFromRow(bad)).toBeNull();
    expect(planFromRow(null)).toBeNull();
  });
});
