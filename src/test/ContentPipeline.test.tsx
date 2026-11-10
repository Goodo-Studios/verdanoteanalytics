/**
 * US-007 — Read-only content-pipeline transparency ("what we're making next").
 *
 * Verifies the client-facing ContentPipeline renders in-flight + upcoming work
 * in client language and, critically, that it is strictly READ-ONLY: NO
 * comment / approve / request-changes / upload affordances and no link-out /
 * click-to-open interaction controls render (AC2). It also asserts no internal
 * task IDs or strategist-only fields leak (AC3) and that missing data — empty
 * or errored — degrades to a calm onboarding state (AC4/AC5).
 *
 * Columns are the five client-facing stages (set with the operator 2026-06-02):
 * Preparing Content / Production / Editing / Client Review / Ready to Launch.
 * The display stage on each task is computed upstream by sync-clickup-tasks'
 * STAGE_MAP; this view just buckets by the already-mapped value.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ContentPipelineView } from "@/components/client/ContentPipeline";
import { dueDateLabel, lastSyncedAt } from "@/lib/pipelineBoard";
import type { PipelineTask } from "@/hooks/usePipelineTasks";

const mockTasks: PipelineTask[] = [
  {
    id: "task-internal-id-001",
    task_name: "Spring hero video",
    stage: "Production",
    due_date: "2026-06-15",
    content_type: "Video",
    updated_at: "2026-05-20",
  },
  {
    id: "task-internal-id-002",
    task_name: "Testimonial carousel",
    stage: "Preparing Content",
    due_date: "2026-07-01",
    content_type: "Static",
    updated_at: "2026-05-22",
  },
];

describe("ContentPipeline (US-007)", () => {
  it("renders in-flight + upcoming work in client language (AC1/AC3)", () => {
    render(<ContentPipelineView tasks={mockTasks} isLoading={false} isError={false} />);

    // Items framed by what they are + stage
    expect(screen.getByText("Spring hero video")).toBeInTheDocument();
    expect(screen.getByText("Testimonial carousel")).toBeInTheDocument();
    expect(screen.getAllByText(/Production/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Preparing Content/).length).toBeGreaterThan(0);
  });

  it("renders NO write / interaction controls — strictly read-only (AC2/AC6)", () => {
    const { container } = render(
      <ContentPipelineView tasks={mockTasks} isLoading={false} isError={false} />,
    );

    // No write/interaction affordances of any kind.
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    // No element advertises itself as clickable.
    expect(container.querySelector(".cursor-pointer")).toBeNull();

    // No approve / comment / request-changes / upload labels.
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/approve/i);
    expect(text).not.toMatch(/request changes/i);
    expect(text).not.toMatch(/comment/i);
    expect(text).not.toMatch(/upload/i);
    expect(text).not.toMatch(/reply/i);
  });

  it("never leaks internal task IDs or a link to the task system (AC3)", () => {
    const { container } = render(
      <ContentPipelineView tasks={mockTasks} isLoading={false} isError={false} />,
    );

    const html = container.innerHTML;
    expect(html).not.toContain("task-internal-id-001");
    expect(html).not.toContain("task-internal-id-002");
    expect(html).not.toContain("coda.io");
    expect(html).not.toContain("clickup.com");
  });

  it("lays out the five workflow stages as kanban columns", () => {
    render(<ContentPipelineView tasks={mockTasks} isLoading={false} isError={false} />);

    // All five workflow columns render as headers, even the empty ones
    // (Editing / Client Review / Ready to Launch have no tasks in the mock).
    expect(screen.getByText("Preparing Content")).toBeInTheDocument();
    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("Editing")).toBeInTheDocument();
    expect(screen.getByText("Client Review")).toBeInTheDocument();
    expect(screen.getByText("Ready to Launch")).toBeInTheDocument();

    // Empty columns show the calm placeholder rather than vanishing.
    expect(screen.getAllByText(/Nothing here yet/i).length).toBeGreaterThan(0);
  });

  it("shows recently-launched work in the Ready to Launch column", () => {
    const tasks: PipelineTask[] = [
      { ...mockTasks[0], id: "launch-1", task_name: "Shipped winter promo", stage: "Ready to Launch" },
    ];
    render(<ContentPipelineView tasks={tasks} isLoading={false} isError={false} />);

    // "Ready to Launch" is a real column now (windowed to recent at sync time).
    expect(screen.getByText("Shipped winter promo")).toBeInTheDocument();
    expect(screen.getByText("Ready to Launch")).toBeInTheDocument();
  });

  it("drops unmapped / drifted-stage tasks from the board", () => {
    const tasks: PipelineTask[] = [
      { ...mockTasks[0], id: "drift-1", task_name: "Stale Complete bucket", stage: "Complete" },
      { ...mockTasks[1], id: "drift-2", task_name: "Some future stage", stage: "Brand New Stage" },
      { ...mockTasks[0], id: "active-1", task_name: "Active spring video", stage: "Production" },
    ];
    render(<ContentPipelineView tasks={tasks} isLoading={false} isError={false} />);

    // Mapped task shows; unmapped/drifted raw strings do not.
    expect(screen.getByText("Active spring video")).toBeInTheDocument();
    expect(screen.queryByText("Stale Complete bucket")).not.toBeInTheDocument();
    expect(screen.queryByText("Some future stage")).not.toBeInTheDocument();
    // No leftover "Complete" column header from the prior bucket model.
    expect(screen.queryByText("Complete")).not.toBeInTheDocument();
  });

  it("degrades to onboarding when only unmapped work remains (AC4)", () => {
    const tasks: PipelineTask[] = [
      { ...mockTasks[0], id: "unmapped-only", stage: "Complete" },
    ];
    render(<ContentPipelineView tasks={tasks} isLoading={false} isError={false} />);
    expect(screen.getByText(/Nothing in production right now/i)).toBeInTheDocument();
  });

  it("degrades to a calm onboarding state when there is no data (AC4)", () => {
    render(<ContentPipelineView tasks={[]} isLoading={false} isError={false} />);
    expect(screen.getByText(/Nothing in production right now/i)).toBeInTheDocument();
  });

  it("shows a distinct error state with Try again on a failed load, not the empty state", () => {
    const onRetry = vi.fn();
    render(
      <ContentPipelineView tasks={undefined} isLoading={false} isError={true} onRetry={onRetry} />,
    );
    expect(screen.getByTestId("pipeline-error")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-empty")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing in production right now/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load your pipeline/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("the empty state is not the error state", () => {
    render(<ContentPipelineView tasks={[]} isLoading={false} isError={false} />);
    expect(screen.getByTestId("pipeline-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-error")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});

describe("Content pipeline last updated", () => {
  afterEach(() => vi.useRealTimers());

  it("shows the most recent sync time across the rows in plain words", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    const tasks: PipelineTask[] = [
      { ...mockTasks[0], updated_at: "2026-11-10T07:00:00Z" },
      { ...mockTasks[1], updated_at: "2026-11-10T10:00:00Z" },
    ];
    render(<ContentPipelineView tasks={tasks} isLoading={false} isError={false} />);
    expect(screen.getByTestId("pipeline-last-updated")).toHaveTextContent("Updated 2 hours ago");
  });

  it("omits the line when there are no rows", () => {
    render(<ContentPipelineView tasks={[]} isLoading={false} isError={false} />);
    expect(screen.queryByTestId("pipeline-last-updated")).not.toBeInTheDocument();
  });

  it("lastSyncedAt picks the latest timestamp and ignores missing ones", () => {
    expect(lastSyncedAt([])).toBeNull();
    expect(
      lastSyncedAt([
        { ...mockTasks[0], updated_at: null },
        { ...mockTasks[1], updated_at: "2026-11-09T01:00:00Z" },
        { ...mockTasks[0], updated_at: "2026-11-01T01:00:00Z" },
      ]),
    ).toBe("2026-11-09T01:00:00Z");
  });
});

describe("Content pipeline overdue rule", () => {
  const now = new Date(2026, 10, 10, 9, 0, 0);

  it("never shows an overdue warning on columns Goodo owns, but keeps the date", () => {
    for (const stage of ["Preparing Content", "Production", "Editing"]) {
      const label = dueDateLabel("2026-11-03", stage, now);
      expect(label).toEqual({ text: "Due Nov 3", urgent: false });
    }
  });

  it("shows a gentle late note only in Client Review", () => {
    const label = dueDateLabel("2026-11-03", "Client Review", now);
    expect(label?.urgent).toBe(true);
    expect(label?.text).toBe("Was due Nov 3. Take a look when you can.");
    expect(label?.text).not.toMatch(/overdue/i);
  });

  it("renders no 'Overdue' text on a late Production card", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const tasks: PipelineTask[] = [
      { ...mockTasks[0], id: "late-prod", stage: "Production", due_date: "2026-11-01" },
      { ...mockTasks[0], id: "late-review", task_name: "Review cut", stage: "Client Review", due_date: "2026-11-01" },
    ];
    render(<ContentPipelineView tasks={tasks} isLoading={false} isError={false} />);
    expect(screen.queryByText(/Overdue/i)).not.toBeInTheDocument();
    expect(screen.getByText("Due Nov 1")).toBeInTheDocument();
    expect(screen.getByText("Was due Nov 1. Take a look when you can.")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
