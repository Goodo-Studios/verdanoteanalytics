/**
 * Phase 5, client view: work grouped by cycle. Covers the grouping (month boundaries, rows with no
 * dates, empty cycles), the counts, the header dates from engagements, the card titles and the
 * landing rule for a client with no ad account.
 */
import { describe, expect, it } from "vitest";
import {
  cardTitle,
  clientLanding,
  cycleDates,
  cycleKeyOf,
  deliveredCountText,
  deliveredLine,
  formatCycleDates,
  groupByCycle,
  type CycleTask,
} from "@/lib/pipelineCycles";

let n = 0;
const task = (over: Partial<CycleTask> = {}): CycleTask => ({
  id: `t${++n}`,
  task_name: "Hook test",
  stage: "Production",
  due_date: null,
  content_type: null,
  updated_at: null,
  cycle_month: null,
  delivered_at: null,
  ...over,
});
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

describe("groupByCycle", () => {
  it("groups by the stored cycle month: current first, then earlier cycles newest first", () => {
    const groups = groupByCycle(
      [
        task({ cycle_month: "2026-09-01", stage: "Ready to Launch" }),
        task({ cycle_month: "2026-11-01" }),
        task({ cycle_month: "2026-10-01", stage: "Ready to Launch" }),
        task({ cycle_month: "2026-11-01", stage: "Ready to Launch" }),
      ],
      [],
      at(2026, 11, 10),
    );
    expect(groups.map((g) => [g.key, g.status])).toEqual([
      ["2026-11-01", "current"],
      ["2026-10-01", "past"],
      ["2026-09-01", "past"],
    ]);
    expect(groups[0].label).toBe("November");
  });

  it("counts delivered of total and the percent, and rounds the percent to a whole number", () => {
    const [g] = groupByCycle(
      [
        task({ cycle_month: "2026-11-01", stage: "Ready to Launch" }),
        task({ cycle_month: "2026-11-01", stage: "Ready to Launch" }),
        task({ cycle_month: "2026-11-01", stage: "Client Review" }),
      ],
      [],
      at(2026, 11, 10),
    );
    expect(g.total).toBe(3);
    expect(g.delivered).toBe(2);
    expect(g.waiting).toBe(1);
    expect(g.inProgress).toBe(1);
    expect(g.percent).toBe(67);
    expect(deliveredCountText(g)).toBe("2 of 3 delivered");
  });

  it("handles month boundaries: the last day of a month and the first of the next fall in different cycles, and the year rolls", () => {
    const tasks = [
      task({ cycle_month: "2026-12-01" }),
      task({ cycle_month: "2027-01-01" }),
      task({ cycle_month: "2026-11-01", stage: "Ready to Launch" }),
    ];
    // 30 November: November is current, December and January are still to come (soonest first).
    expect(groupByCycle(tasks, [], at(2026, 11, 30)).map((g) => [g.key, g.status])).toEqual([
      ["2026-11-01", "current"],
      ["2026-12-01", "upcoming"],
      ["2027-01-01", "upcoming"],
    ]);
    // 1 December: the current cycle moves to December; November becomes past.
    expect(groupByCycle(tasks, [], at(2026, 12, 1)).map((g) => [g.key, g.status])).toEqual([
      ["2026-12-01", "current"],
      ["2027-01-01", "upcoming"],
      ["2026-11-01", "past"],
    ]);
    // 1 January: the year is part of the label of an older cycle.
    const jan = groupByCycle(tasks, [], at(2027, 1, 1));
    expect(jan[0].key).toBe("2027-01-01");
    expect(jan.find((g) => g.key === "2026-11-01")!.label).toBe("November 2026");
  });

  it("when every cycle is still ahead, the soonest is the current one", () => {
    const groups = groupByCycle([task({ cycle_month: "2027-02-01" }), task({ cycle_month: "2027-01-01" })], [], at(2026, 11, 10));
    expect(groups.map((g) => [g.key, g.status])).toEqual([
      ["2027-01-01", "current"],
      ["2027-02-01", "upcoming"],
    ]);
  });

  it("opens the current cycle, collapses past ones, and keeps an earlier cycle open while it waits on the client", () => {
    const groups = groupByCycle(
      [
        task({ cycle_month: "2026-12-01" }),
        task({ cycle_month: "2026-11-01", stage: "Client Review" }),
        task({ cycle_month: "2026-10-01", stage: "Ready to Launch" }),
        task({ cycle_month: "2027-03-01" }),
      ],
      [],
      at(2026, 12, 5),
    );
    const open = Object.fromEntries(groups.map((g) => [g.key, g.defaultOpen]));
    expect(open).toEqual({ "2026-12-01": true, "2026-11-01": true, "2026-10-01": false, "2027-03-01": false });
  });

  it("a row with no cycle month falls back to the month of its due date, then of its delivery day", () => {
    expect(cycleKeyOf({ cycle_month: null, due_date: "2026-11-20", delivered_at: null })).toBe("2026-11-01");
    expect(cycleKeyOf({ cycle_month: null, due_date: null, delivered_at: "2026-09-30" })).toBe("2026-09-01");
    expect(cycleKeyOf({ cycle_month: "2026-10-01", due_date: "2026-11-20", delivered_at: null })).toBe("2026-10-01");
  });

  it("rows with no dates at all go to 'Other work', after the dated cycles", () => {
    const groups = groupByCycle([task({ cycle_month: "2026-11-01" }), task({ task_name: "Loose card" })], [], at(2026, 11, 10));
    expect(groups.map((g) => [g.key, g.label, g.status])).toEqual([
      ["2026-11-01", "November", "current"],
      ["other", "Other work", "other"],
    ]);
  });

  it("when only undated rows exist they are the current group, not hidden", () => {
    const groups = groupByCycle([task({ task_name: "Loose card" })], [], at(2026, 11, 10));
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe("current");
    expect(groups[0].defaultOpen).toBe(true);
  });

  it("empty input gives no cycles, and a cycle with no tasks is never made up", () => {
    expect(groupByCycle([], [], at(2026, 11, 10))).toEqual([]);
    expect(groupByCycle(undefined, undefined, at(2026, 11, 10))).toEqual([]);
    expect(groupByCycle(null, [{ start_date: "2026-11-02", day45_date: "2026-12-16", status: "active" }], at(2026, 11, 10))).toEqual([]);
  });

  it("leaves off cards whose stage is not one of the five columns, and counts a card with no stage as the first", () => {
    const groups = groupByCycle(
      [
        task({ cycle_month: "2026-11-01", stage: "Complete" }),
        task({ cycle_month: "2026-11-01", stage: null }),
      ],
      [],
      at(2026, 11, 10),
    );
    expect(groups[0].total).toBe(1);
    expect(groupByCycle([task({ cycle_month: "2026-11-01", stage: "Brand New Stage" })], [], at(2026, 11, 10))).toEqual([]);
  });
});

describe("cycle dates from engagements", () => {
  const sprint = { start_date: "2026-10-20", day45_date: "2026-12-03", status: "active" };

  it("uses the one engagement that started in the cycle's month", () => {
    expect(cycleDates("2026-10-01", [sprint])).toEqual({ start: "2026-10-20", end: "2026-12-03" });
    expect(formatCycleDates(cycleDates("2026-10-01", [sprint]))).toBe("Oct 20 to Dec 3");
  });

  it("shows only a start for an engagement with no end", () => {
    expect(formatCycleDates(cycleDates("2026-11-01", [{ start_date: "2026-11-03", day45_date: null, status: "active" }]))).toBe("Started Nov 3");
  });

  it("shows no dates when no engagement, two engagements or only a cancelled one match", () => {
    expect(cycleDates("2026-11-01", [sprint])).toBeNull();
    expect(cycleDates("2026-10-01", [sprint, { ...sprint, start_date: "2026-10-02" }])).toBeNull();
    expect(cycleDates("2026-10-01", [{ ...sprint, status: "cancelled" }])).toBeNull();
    expect(cycleDates("2026-10-01", [{ start_date: null, day45_date: null, status: "planned" }])).toBeNull();
    expect(cycleDates("other", [sprint])).toBeNull();
    expect(cycleDates("2026-10-01", undefined)).toBeNull();
    expect(formatCycleDates(null)).toBeNull();
  });

  it("puts the dates on the group", () => {
    const [g] = groupByCycle([task({ cycle_month: "2026-10-01" })], [sprint], at(2026, 11, 10));
    expect(g.dates).toEqual({ start: "2026-10-20", end: "2026-12-03" });
  });
});

describe("card titles", () => {
  const t = (task_name: string | null, content_type: string | null = null, cycle_month: string | null = null) =>
    cardTitle({ task_name, content_type, cycle_month });

  it("strips the '{Month} Asset {N}' prefix and moves the number to the label", () => {
    expect(t("November Asset 3 - Softcurve Pillow Pregnancy", "UGC Video")).toEqual({
      title: "Softcurve Pillow Pregnancy",
      label: "Asset 3 · UGC Video",
    });
    expect(t("Nov Asset 12: Founder story")).toEqual({ title: "Founder story", label: "Asset 12" });
    expect(t("October 2026 Asset 4 | Gifting angle")).toEqual({ title: "Gifting angle", label: "Asset 4" });
    expect(t("Sept. Asset 7 - Lifestyle")).toEqual({ title: "Lifestyle", label: "Asset 7" });
  });

  it("strips a prefix without a month and a client name in front of it", () => {
    expect(t("Asset 9 - Summer promo")).toEqual({ title: "Summer promo", label: "Asset 9" });
    expect(t("Barriere - October Asset 12 - Pillow talk")).toEqual({ title: "Pillow talk", label: "Asset 12" });
  });

  it("says what it is when nothing readable follows the prefix, never 'Untitled task'", () => {
    expect(t("November Asset 8", "Static")).toEqual({ title: "November creative", label: "Asset 8 · Static" });
    expect(t("Asset 8", null, "2026-10-01")).toEqual({ title: "October creative", label: "Asset 8" });
    expect(t("Dec Asset 2 - ")).toEqual({ title: "December creative", label: "Asset 2" });
    expect(t("Asset 5")).toEqual({ title: "New creative", label: "Asset 5" });
  });

  it("handles a missing or blank name with context from the type and the cycle", () => {
    expect(t(null, "UGC Video", "2026-11-01")).toEqual({ title: "November creative", label: "UGC Video" });
    expect(t("   ", null)).toEqual({ title: "New creative", label: "" });
    for (const input of [null, "", "  ", "Asset 1", "November Asset 1"]) {
      expect(t(input).title).not.toMatch(/untitled/i);
      expect(t(input).title.length).toBeGreaterThan(0);
    }
  });

  it("keeps a name that has no asset prefix as it is", () => {
    expect(t("Spring hero video", "Video")).toEqual({ title: "Spring hero video", label: "Video" });
  });

  it("does not mistake another word for a month", () => {
    expect(t("Decorated Asset 4 - Shelf")).toEqual({ title: "Shelf", label: "Asset 4" });
    expect(t("Marching band asset 4 hook")).toEqual({ title: "hook", label: "Asset 4" });
  });
});

describe("delivered line", () => {
  it("shows the stored delivery day and nothing when it is not stored", () => {
    expect(deliveredLine({ delivered_at: "2026-11-12" })).toBe("Delivered Nov 12");
    expect(deliveredLine({ delivered_at: "2026-11-12T10:00:00Z" })).toBe("Delivered Nov 12");
    expect(deliveredLine({ delivered_at: null })).toBeNull();
    expect(deliveredLine({ delivered_at: "" })).toBeNull();
    expect(deliveredLine({})).toBeNull();
  });
});

describe("client landing", () => {
  const base = { isClient: true, accountsLoading: false, accountCount: 0, linksLoading: false, linkCount: 0 };

  it("sends a client with no ad account but a client link to the pipeline", () => {
    expect(clientLanding({ ...base, linkCount: 1 })).toBe("pipeline");
  });

  it("keeps a client with an ad account on the metrics page, whether or not it has links", () => {
    expect(clientLanding({ ...base, accountCount: 1 })).toBe("metrics");
    expect(clientLanding({ ...base, accountCount: 2, linkCount: 1 })).toBe("metrics");
  });

  it("leaves a client with neither where it was", () => {
    expect(clientLanding(base)).toBe("metrics");
  });

  it("waits, rather than flash the empty metrics page, while accounts or links load", () => {
    expect(clientLanding({ ...base, accountsLoading: true })).toBe("wait");
    expect(clientLanding({ ...base, linksLoading: true })).toBe("wait");
    // Accounts answered and non-empty: no need to wait for the links.
    expect(clientLanding({ ...base, accountCount: 1, linksLoading: true })).toBe("metrics");
  });

  it("never redirects staff", () => {
    expect(clientLanding({ ...base, isClient: false, linkCount: 1 })).toBe("metrics");
    expect(clientLanding({ ...base, isClient: false, accountsLoading: true })).toBe("metrics");
  });
});
