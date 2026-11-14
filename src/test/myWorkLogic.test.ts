/** My work (OS-009) pure helpers: phase marker, late dates, due-date groups, filters, roles. */
import { describe, expect, it } from "vitest";
import {
  clientOptions,
  dueGroup,
  filterMyTasks,
  groupMyTasks,
  isLateDue,
  phaseLabel,
  phaseNumber,
  rolesOf,
  type MyTaskRow,
} from "@/lib/myWork";

const TODAY = "2026-11-12";
const mk = (id: string, over: Partial<MyTaskRow> = {}): MyTaskRow => ({
  id,
  title: id,
  client_slug: "glow",
  status: "editing",
  due_date: TODAY,
  client: { name: "Glow Drip" },
  status_info: { stage: "Editing" },
  ...over,
});

describe("phase marker", () => {
  it("numbers the five stages and labels them", () => {
    expect(phaseNumber("Preparing Content")).toBe(1);
    expect(phaseNumber("Ready to Launch")).toBe(5);
    expect(phaseLabel("Editing")).toBe("Phase 3 of 5: Editing");
  });
  it("gives Other and unknown stages no phase", () => {
    expect(phaseNumber("Other")).toBe(0);
    expect(phaseNumber(null)).toBe(0);
    expect(phaseLabel("Other")).toBe("No phase");
  });
});

describe("late and due groups", () => {
  it("is late only before today", () => {
    expect(isLateDue("2026-11-11", TODAY)).toBe(true);
    expect(isLateDue(TODAY, TODAY)).toBe(false);
    expect(isLateDue(null, TODAY)).toBe(false);
    expect(isLateDue("2026-11-11T10:00:00Z", TODAY)).toBe(true);
  });
  it("puts each date in one group", () => {
    expect(dueGroup("2026-11-01", TODAY)).toBe("overdue");
    expect(dueGroup(TODAY, TODAY)).toBe("today");
    expect(dueGroup("2026-11-13", TODAY)).toBe("week");
    expect(dueGroup("2026-11-18", TODAY)).toBe("week");
    expect(dueGroup("2026-11-19", TODAY)).toBe("later");
    expect(dueGroup(null, TODAY)).toBe("none");
  });
  it("groups in order, sorts by date then title and drops empty groups", () => {
    const groups = groupMyTasks(
      [
        mk("b-late", { due_date: "2026-11-10" }),
        mk("a-late", { due_date: "2026-11-10" }),
        mk("older", { due_date: "2026-11-01" }),
        mk("none", { due_date: null }),
        mk("later", { due_date: "2026-12-01" }),
      ],
      TODAY,
    );
    expect(groups.map((g) => g.id)).toEqual(["overdue", "later", "none"]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["older", "a-late", "b-late"]);
  });
});

describe("filters", () => {
  const rows = [
    mk("a", { client_slug: "glow", status_info: { stage: "Editing" } }),
    mk("b", { client_slug: "bloom", client: { name: "Bloom" }, status_info: { stage: "Production" } }),
    mk("c", { client_slug: "bloom", client: { name: "Bloom" }, status_info: { stage: "Other" } }),
    mk("d", { client_slug: null, client: null, status_info: null }),
  ];
  it("filters by client", () => {
    expect(filterMyTasks(rows, { client: "bloom", phase: "" }).map((t) => t.id)).toEqual(["b", "c"]);
  });
  it("filters by phase, and Other catches no-phase tasks", () => {
    expect(filterMyTasks(rows, { client: "", phase: "Editing" }).map((t) => t.id)).toEqual(["a"]);
    expect(filterMyTasks(rows, { client: "", phase: "Other" }).map((t) => t.id)).toEqual(["c", "d"]);
  });
  it("combines filters", () => {
    expect(filterMyTasks(rows, { client: "bloom", phase: "Production" }).map((t) => t.id)).toEqual(["b"]);
  });
  it("lists clients once, by name", () => {
    expect(clientOptions(rows)).toEqual([
      { value: "bloom", label: "Bloom" },
      { value: "glow", label: "Glow Drip" },
    ]);
  });
});

describe("roles", () => {
  it("names each role the person holds", () => {
    expect(rolesOf(mk("x", { strategist_id: "u1", editor_id: "u1", producer_id: "u2" }), "u1")).toEqual(["Strategist", "Editor"]);
  });
});
