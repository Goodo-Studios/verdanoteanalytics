/**
 * Phase 5, client view: the board grouped by cycle. A header per cycle with "N of M delivered", a
 * progress bar and the dates when known; the current cycle open with the five columns, earlier
 * cycles collapsed and still holding their delivered tasks (with the delivery day when it is stored,
 * and no date when it is not); clean card titles; still strictly read-only.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContentPipelineView } from "@/components/client/ContentPipeline";
import type { PipelineTask } from "@/hooks/usePipelineTasks";

let n = 0;
const task = (over: Partial<PipelineTask> = {}): PipelineTask => ({
  id: `internal-id-${++n}`,
  task_name: "Hook test",
  stage: "Production",
  due_date: null,
  content_type: null,
  updated_at: null,
  cycle_month: null,
  delivered_at: null,
  ...over,
});
const NOW = new Date(2026, 10, 10, 12, 0, 0); // 10 November 2026

const tasks: PipelineTask[] = [
  task({ task_name: "November Asset 1 - Founder story", content_type: "UGC Video", stage: "Ready to Launch", cycle_month: "2026-11-01", delivered_at: "2026-11-05" }),
  task({ task_name: "November Asset 2 - Gifting angle", stage: "Client Review", cycle_month: "2026-11-01", due_date: "2026-11-14" }),
  task({ task_name: "November Asset 3", content_type: "Static", stage: "Editing", cycle_month: "2026-11-01" }),
  task({ task_name: "November Asset 4 - Pillow talk", stage: "Production", cycle_month: "2026-11-01" }),
  // October: finished more than 30 days ago, so it comes from the delivered list.
  task({ task_name: "October Asset 1 - Spring teaser", stage: "Ready to Launch", cycle_month: "2026-10-01", delivered_at: "2026-10-02" }),
  task({ task_name: "October Asset 2 - Unboxing", stage: "Ready to Launch", cycle_month: "2026-10-01", delivered_at: null }),
  task({ task_name: "October Asset 3 - Retargeting", stage: "Ready to Launch", cycle_month: "2026-10-01", delivered_at: "2026-10-20" }),
];

const cycle = (key: string) => {
  const el = document.querySelector<HTMLDetailsElement>(`[data-testid="pipeline-cycle"][data-cycle="${key}"]`);
  if (!el) throw new Error(`no cycle ${key} on the page`);
  return el;
};
const render_ = (over: Partial<Parameters<typeof ContentPipelineView>[0]> = {}) =>
  render(<ContentPipelineView tasks={tasks} isLoading={false} isError={false} now={NOW} {...over} />);

describe("the board by cycle", () => {
  it("shows a header per cycle with the delivered count and a progress bar", () => {
    render_();
    expect(within(cycle("2026-11-01")).getByTestId("pipeline-cycle-label")).toHaveTextContent("November");
    expect(within(cycle("2026-11-01")).getByTestId("pipeline-cycle-count")).toHaveTextContent("1 of 4 delivered");
    expect(within(cycle("2026-10-01")).getByTestId("pipeline-cycle-count")).toHaveTextContent("3 of 3 delivered");
    const bar = within(cycle("2026-11-01")).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(bar).toHaveAccessibleName("November: 1 of 4 delivered");
    expect(within(cycle("2026-10-01")).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("opens the current cycle and collapses the earlier one", () => {
    render_();
    expect(cycle("2026-11-01").open).toBe(true);
    expect(cycle("2026-11-01")).toHaveAttribute("data-status", "current");
    expect(cycle("2026-10-01").open).toBe(false);
    expect(cycle("2026-10-01")).toHaveAttribute("data-status", "past");
  });

  it("lists the current cycle first, then earlier cycles", () => {
    render_();
    const order = screen.getAllByTestId("pipeline-cycle").map((el) => el.getAttribute("data-cycle"));
    expect(order).toEqual(["2026-11-01", "2026-10-01"]);
  });

  it("shows the five columns for the current cycle only", () => {
    render_();
    const current = cycle("2026-11-01");
    for (const col of ["Preparing Content", "Production", "Editing", "Client Review", "Ready to Launch"]) {
      expect(within(current).getByText(col)).toBeInTheDocument();
    }
    expect(within(cycle("2026-10-01")).queryByText("Preparing Content")).toBeNull();
  });

  it("keeps a past cycle's delivered tasks, as a timeline with the delivery day, oldest first", () => {
    render_();
    const rows = within(cycle("2026-10-01")).getAllByTestId("pipeline-timeline-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Spring teaser"),
      expect.stringContaining("Retargeting"),
      expect.stringContaining("Unboxing"),
    ]);
    expect(rows[0]).toHaveTextContent("Delivered Oct 2");
    expect(rows[1]).toHaveTextContent("Delivered Oct 20");
  });

  it("leaves the date off a delivered task whose delivery day is not stored", () => {
    render_();
    const unboxing = within(cycle("2026-10-01")).getAllByTestId("pipeline-timeline-row").find((r) => r.textContent?.includes("Unboxing"))!;
    expect(unboxing.textContent).not.toMatch(/Delivered/);
    expect(unboxing.textContent).not.toMatch(/\b(Oct|Nov)\s+\d/);
    // The same in the current cycle's Ready to Launch column.
    const undated = [task({ task_name: "November Asset 9 - Undated", stage: "Ready to Launch", cycle_month: "2026-11-01" })];
    const { container } = render(<ContentPipelineView tasks={undated} isLoading={false} isError={false} now={NOW} />);
    const card = container.querySelector('[data-testid="pipeline-task"]')!;
    expect(card.textContent).toContain("Undated");
    expect(card.textContent).not.toMatch(/Delivered|Due/);
  });

  it("shows delivered work in the current cycle's Ready to Launch column with its delivery day", () => {
    render_();
    const column = within(cycle("2026-11-01")).getByText("Founder story").closest('[data-testid="pipeline-task"]')!;
    expect(column).toHaveAttribute("data-stage", "Ready to Launch");
    expect(column).toHaveTextContent("Delivered Nov 5");
  });

  it("shows clean card titles with the asset number as a small label, never 'Untitled task'", () => {
    render_();
    const current = cycle("2026-11-01");
    expect(within(current).getByText("Founder story")).toBeInTheDocument();
    expect(within(current).getByText("Asset 1 · UGC Video")).toBeInTheDocument();
    // "November Asset 3" has nothing after the prefix: it says what it is instead.
    expect(within(current).getByText("November creative")).toBeInTheDocument();
    expect(within(current).getByText("Asset 3 · Static")).toBeInTheDocument();
    expect(screen.queryByText(/November Asset/)).toBeNull();
    expect(screen.queryByText(/untitled/i)).toBeNull();
  });

  it("shows the cycle dates only when an engagement of that month is known", () => {
    render_({ engagements: [{ start_date: "2026-10-20", day45_date: "2026-12-03", status: "active" }] });
    expect(within(cycle("2026-10-01")).getByTestId("pipeline-cycle-meta")).toHaveTextContent("Oct 20 to Dec 3");
    expect(within(cycle("2026-11-01")).queryByText(/to Dec/)).toBeNull();
    expect(screen.queryAllByText(/Started/)).toHaveLength(0);
  });

  it("flags work that is waiting on the client and keeps that cycle open even when it is earlier", () => {
    const later = [
      task({ task_name: "December Asset 1", stage: "Production", cycle_month: "2026-12-01" }),
      task({ task_name: "November Asset 2 - Cut for review", stage: "Client Review", cycle_month: "2026-11-01" }),
      task({ task_name: "October Asset 1 - Done", stage: "Ready to Launch", cycle_month: "2026-10-01", delivered_at: "2026-10-04" }),
    ];
    render(<ContentPipelineView tasks={later} isLoading={false} isError={false} now={new Date(2026, 11, 5, 12)} />);
    expect(cycle("2026-12-01").open).toBe(true);
    expect(cycle("2026-11-01").open).toBe(true);
    expect(within(cycle("2026-11-01")).getByTestId("pipeline-cycle-meta")).toHaveTextContent("1 waiting on you");
    expect(cycle("2026-10-01").open).toBe(false);
  });

  it("labels a cycle that is still to come", () => {
    render(
      <ContentPipelineView
        tasks={[task({ cycle_month: "2026-11-01" }), task({ cycle_month: "2026-12-01" })]}
        isLoading={false}
        isError={false}
        now={NOW}
      />,
    );
    expect(within(cycle("2026-12-01")).getByText("Coming up")).toBeInTheDocument();
    expect(cycle("2026-12-01").open).toBe(false);
  });

  it("says when earlier cycles could not load, and still shows the board", () => {
    render_({ pastCyclesFailed: true });
    expect(screen.getByTestId("pipeline-past-failed")).toHaveTextContent("Earlier cycles could not load");
    expect(screen.getByTestId("content-pipeline")).toBeInTheDocument();
  });

  it("an empty list is the calm empty state, an error is not", () => {
    const { unmount } = render(<ContentPipelineView tasks={[]} isLoading={false} isError={false} now={NOW} />);
    expect(screen.getByTestId("pipeline-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-cycle")).toBeNull();
    unmount();
    render(<ContentPipelineView tasks={undefined} isLoading={false} isError now={NOW} />);
    expect(screen.getByTestId("pipeline-error")).toBeInTheDocument();
  });

  it("stays read-only: no write controls, no links, no internal ids, no review or approve wording", () => {
    const { container } = render_();
    expect(container.querySelector("button, a, input, textarea, form, select")).toBeNull();
    const html = container.innerHTML;
    for (const t of tasks) expect(html).not.toContain(t.id);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/approve|request changes|comment|upload|reply/i);
    expect(html).not.toMatch(/clickup\.com|air\.inc/i);
    expect(text).not.toContain(String.fromCharCode(0x2014));
    expect(text).not.toContain(String.fromCharCode(0x2013));
  });
});
