/**
 * Rules behind the staff Home blocks and the Work page: what is due this week, what is late, the filters,
 * the ClickUp address, and the one calm "clients needing attention" list for the builder.
 */
import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  clickupTaskUrl,
  clientsNeedingAttention,
  dueThisWeek,
  filterWork,
  isLate,
  lateGoodoWork,
  monthStartIso,
  todayIso,
  waitingOnClient,
  type HomeTask,
} from "@/lib/homeData";

const NOW = new Date(2026, 10, 10, 12, 0, 0); // 10 Nov 2026, local
const TODAY = todayIso(NOW);
const day = (n: number) => addDaysIso(TODAY, n);
const fresh = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();

let n = 0;
const task = (over: Partial<HomeTask>): HomeTask => ({
  id: `t${++n}`,
  clickup_task_id: `cu${n}`,
  client_slug: "glow",
  task_name: `Task ${n}`,
  stage: "Production",
  due_date: day(1),
  synced_at: fresh,
  ...over,
});

describe("due this week", () => {
  it("is today through seven days ahead, soonest first, and leaves out late, later and launched cards", () => {
    const tasks = [
      task({ task_name: "later", due_date: day(8) }),
      task({ task_name: "d7", due_date: day(7) }),
      task({ task_name: "today", due_date: day(0) }),
      task({ task_name: "late", due_date: day(-1) }),
      task({ task_name: "launched", due_date: day(2), stage: "Ready to Launch" }),
      task({ task_name: "undated", due_date: null }),
      task({ task_name: "d3", due_date: day(3), stage: "Client Review" }),
    ];
    expect(dueThisWeek(tasks, TODAY).map((t) => t.task_name)).toEqual(["today", "d3", "d7"]);
  });
});

describe("late work", () => {
  it("counts only stages Goodo owns; Client Review is waiting on the client, and launched is never late", () => {
    const tasks = [
      task({ task_name: "edit", stage: "Editing", due_date: day(-2) }),
      task({ task_name: "prep (no stage)", stage: null, due_date: day(-5) }),
      task({ task_name: "review", stage: "Client Review", due_date: day(-9) }),
      task({ task_name: "launched", stage: "Ready to Launch", due_date: day(-9) }),
      task({ task_name: "fine", stage: "Production", due_date: day(0) }),
    ];
    expect(lateGoodoWork(tasks, TODAY).map((t) => t.task_name)).toEqual(["prep (no stage)", "edit"]);
    expect(isLate(tasks[2], TODAY)).toBe(true);
    expect(isLate(tasks[3], TODAY)).toBe(false);
    expect(waitingOnClient(tasks).map((t) => t.task_name)).toEqual(["review"]);
  });
});

describe("Work filters", () => {
  const tasks = [
    task({ client_slug: "glow", task_name: "Glow hook video", stage: "Editing", due_date: day(2) }),
    task({ client_slug: "bloom", task_name: "Bloom unboxing", stage: "Production", due_date: day(-3) }),
    task({ client_slug: "bloom", task_name: "Bloom static ads", stage: "Client Review", due_date: day(20) }),
    task({ client_slug: "glow", task_name: "Glow shoot day", stage: "Production", due_date: null }),
  ];
  const f = (over: Partial<Parameters<typeof filterWork>[1]>) => filterWork(tasks, { view: "all", client: "", stage: "", query: "", ...over }, TODAY).map((t) => t.task_name);

  it("toggles between due this week, overdue and all", () => {
    expect(f({ view: "week" })).toEqual(["Glow hook video"]);
    expect(f({ view: "overdue" })).toEqual(["Bloom unboxing"]);
    expect(f({ view: "all" })).toEqual(["Bloom unboxing", "Glow hook video", "Bloom static ads", "Glow shoot day"]);
  });
  it("filters by client, by stage and by task name, and the filters combine", () => {
    expect(f({ client: "bloom" })).toEqual(["Bloom unboxing", "Bloom static ads"]);
    expect(f({ stage: "Production" })).toEqual(["Bloom unboxing", "Glow shoot day"]);
    expect(f({ query: "  SHOOT " })).toEqual(["Glow shoot day"]);
    expect(f({ client: "glow", stage: "Production" })).toEqual(["Glow shoot day"]);
    expect(f({ client: "glow", query: "bloom" })).toEqual([]);
  });
  it("a card with no stage counts as Preparing Content", () => {
    expect(filterWork([task({ stage: null, task_name: "x" })], { view: "all", client: "", stage: "Preparing Content", query: "", }, TODAY)).toHaveLength(1);
  });
});

describe("ClickUp address", () => {
  it("is built from the stored task id, and absent when there is none", () => {
    expect(clickupTaskUrl({ clickup_task_id: "86abc" })).toBe("https://app.clickup.com/t/86abc");
    expect(clickupTaskUrl({ clickup_task_id: "a b/c" })).toBe("https://app.clickup.com/t/a%20b%2Fc");
    expect(clickupTaskUrl({ clickup_task_id: null })).toBeNull();
  });
});

describe("clients needing attention", () => {
  const names = { glow: "Glow Drip", bloom: "Bloom", tide: "Tide" };
  const base = { tasks: [] as HomeTask[], support: [], budgetAlerts: [], clientNames: names, now: NOW };

  it("is empty when nothing is wrong", () => {
    expect(clientsNeedingAttention({ ...base, tasks: [task({ due_date: day(3) })] })).toEqual([]);
    expect(clientsNeedingAttention(base)).toEqual([]);
  });

  it("makes one line per client with the main reason, late work first, and counts the other reasons", () => {
    const rows = clientsNeedingAttention({
      ...base,
      tasks: [task({ client_slug: "glow", stage: "Editing", due_date: day(-4) }), task({ client_slug: "glow", stage: "Production", due_date: day(-1) })],
      support: [
        { id: "s1", client_slug: "glow", subject: "x", status: "open", next_update_target: day(-2), accountable_user_id: "u1", backup_user_id: null },
        { id: "s2", client_slug: "bloom", subject: "y", status: "open", next_update_target: day(-1), accountable_user_id: "u1", backup_user_id: null },
        { id: "s3", client_slug: "tide", subject: "z", status: "open", next_update_target: day(2), accountable_user_id: "u1", backup_user_id: null },
        { id: "s4", client_slug: "tide", subject: "done", status: "resolved", next_update_target: day(-8), accountable_user_id: "u1", backup_user_id: null },
      ],
    });
    expect(rows.map((r) => r.name)).toEqual(["Bloom", "Glow Drip"]);
    const glow = rows.find((r) => r.name === "Glow Drip")!;
    expect(glow.reason).toContain("2 tasks are late");
    expect(glow.reason).toContain("the oldest was due");
    expect(glow.reason).toContain("1 other thing to check");
    expect(glow.late).toBe(true);
    expect(glow.to).toBe("/clients/glow/work");
    const bloom = rows.find((r) => r.name === "Bloom")!;
    expect(bloom.reason).toBe("1 support update is overdue.");
    expect(bloom.to).toBe("/admin/support?client=bloom");
  });

  it("makes one line, not one per client, when the whole ClickUp board is behind", () => {
    const old = new Date(NOW.getTime() - 20 * 3_600_000).toISOString();
    const rows = clientsNeedingAttention({ ...base, tasks: [task({ client_slug: "glow", synced_at: old, due_date: day(3) }), task({ client_slug: "bloom", synced_at: old, due_date: day(3) })] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "ClickUp sync", to: "/admin/integration-health", late: false });
    expect(rows[0].reason).toContain("20 hours ago");
  });

  it("names a client whose cards fell behind while the rest of the board is fresh", () => {
    const old = new Date(NOW.getTime() - 30 * 3_600_000).toISOString();
    const rows = clientsNeedingAttention({ ...base, tasks: [task({ client_slug: "glow", due_date: day(3) }), task({ client_slug: "bloom", synced_at: old, due_date: day(3) })] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Bloom", to: "/clients/bloom/work", late: false });
  });

  it("adds a budget line for a crossing this month only, saying which level", () => {
    const month = monthStartIso(NOW);
    const last = monthStartIso(new Date(2026, 9, 1));
    expect(clientsNeedingAttention({ ...base, budgetAlerts: [{ id: "a", level: "warning", period_month: last }] })).toEqual([]);
    const warn = clientsNeedingAttention({ ...base, budgetAlerts: [{ id: "a", level: "warning", period_month: month }] });
    expect(warn[0]).toMatchObject({ name: "Operating costs", to: "/admin/operating-costs", late: false });
    expect(warn[0].reason).toContain("warning amount");
    const over = clientsNeedingAttention({ ...base, budgetAlerts: [{ id: "a", level: "warning", period_month: month }, { id: "b", level: "limit", period_month: month }] });
    expect(over[0].reason).toContain("monthly limit");
  });

  it("uses a plain word, not the slug, for a client it has no name for", () => {
    const rows = clientsNeedingAttention({ ...base, clientNames: {}, tasks: [task({ client_slug: "secret-slug", stage: "Editing", due_date: day(-1) })] });
    expect(rows[0].name).toBe("A client");
  });
});
