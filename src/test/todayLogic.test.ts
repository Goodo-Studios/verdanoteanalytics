/** Today (OS-010) helpers: next-action order, the short list, N of M done today, builder lists. */
import { describe, expect, it } from "vitest";
import type { MyTaskRow } from "@/lib/myWork";
import { awaitingClientApproval, isForToday, lateAcrossClients, pickToday, SHORT_LIST_MAX, startOfDayIso, todayProgress } from "@/lib/today";

const T = "2026-11-12";
const mk = (id: string, over: Partial<MyTaskRow> = {}): MyTaskRow => ({
  id,
  title: id,
  client_slug: "glow",
  status: "editing",
  due_date: "2026-11-20",
  status_info: { stage: "Editing" },
  ...over,
});

describe("pickToday", () => {
  it("puts late first, then today, then by date with no date last; stuck goes to the end", () => {
    const rows = [
      mk("nodate", { due_date: null }),
      mk("stuck", { due_date: "2026-11-01", is_stuck: true }),
      mk("later", { due_date: "2026-11-30" }),
      mk("today", { due_date: T }),
      mk("late", { due_date: "2026-11-10" }),
    ];
    const { next, rest } = pickToday(rows);
    expect(next?.id).toBe("late");
    expect(rest.map((r) => r.id)).toEqual(["today", "later", "nodate", "stuck"]);
  });

  it("on the same date, a later phase (closer to done) comes first", () => {
    const { next } = pickToday([mk("prep", { status_info: { stage: "Preparing Content" } }), mk("review", { status_info: { stage: "Client Review" } })]);
    expect(next?.id).toBe("review");
  });

  it("leaves out done, read-only and hidden tasks, and caps the short list", () => {
    const many = Array.from({ length: 12 }, (_, i) => mk(`t${String(i).padStart(2, "0")}`));
    const rows = [...many, mk("done", { status: "complete", due_date: "2026-01-01" }), mk("ro", { read_only: true, due_date: "2026-01-01" })];
    const { next, rest } = pickToday(rows, new Set(["t00"]));
    expect(next?.id).toBe("t01");
    expect(rest).toHaveLength(SHORT_LIST_MAX);
    expect(rest.some((r) => ["done", "ro", "t00"].includes(r.id))).toBe(false);
  });

  it("is empty with no tasks", () => {
    expect(pickToday([])).toEqual({ next: null, rest: [] });
  });
});

describe("todayProgress", () => {
  const open = [mk("late", { due_date: "2026-11-01" }), mk("today", { due_date: T }), mk("future"), mk("nodate", { due_date: null })];

  it("counts today's open items (due today or late) plus those done today", () => {
    expect(isForToday(open[2], T)).toBe(false);
    expect(todayProgress(open, 2, T)).toEqual({ done: 2, total: 4, percent: 50, label: "2 of 4 done today" });
  });

  it("an item finished on the page moves N up and keeps M", () => {
    expect(todayProgress(open, 2, T, new Set(["today"]))).toEqual({ done: 3, total: 4, percent: 75, label: "3 of 4 done today" });
  });

  it("is 0 of 0 at 0% with nothing for today", () => {
    expect(todayProgress([mk("future")], 0, T)).toEqual({ done: 0, total: 0, percent: 0, label: "0 of 0 done today" });
  });
});

describe("builder lists", () => {
  const rows = [
    mk("b", { due_date: "2026-11-11" }),
    mk("a", { due_date: "2026-11-02", client_slug: "bloom" }),
    mk("today", { due_date: T }),
    mk("done", { status: "complete", due_date: "2026-11-01" }),
    mk("ro", { read_only: true, due_date: "2026-11-01" }),
    mk("review2", { status_info: { stage: "Client Review" }, due_date: null }),
    mk("review1", { status_info: { stage: "Client Review" }, due_date: "2026-11-15" }),
  ];

  it("late across all clients: open, not read-only, before today, oldest first", () => {
    expect(lateAcrossClients(rows, T).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("approvals outstanding: the Client Review stage, soonest first", () => {
    expect(awaitingClientApproval(rows).map((r) => r.id)).toEqual(["review1", "review2"]);
  });
});

describe("startOfDayIso", () => {
  it("is local midnight of the given day", () => {
    const d = new Date(startOfDayIso(T));
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 11, 12, 0, 0]);
  });
});
