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
 * Columns mirror the live Coda workflow (set with the operator 2026-06-02):
 * Preparing Content / Production / Editing / Client Review / Ready to Launch.
 * The display stage on each task is computed upstream by sync-coda-tasks'
 * STAGE_MAP; this view just buckets by the already-mapped value.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ContentPipelineView } from "@/components/client/ContentPipeline";
import type { CodaTask } from "@/hooks/useCodaTasks";

const mockTasks: CodaTask[] = [
  {
    id: "task-internal-id-001",
    task_name: "Spring hero video",
    stage: "Production",
    due_date: "2026-06-15",
    content_type: "Video",
    coda_url: "https://coda.io/d/internal-secret-doc",
    brief: "Spring hero brief",
    updated_at: "2026-05-20",
  },
  {
    id: "task-internal-id-002",
    task_name: "Testimonial carousel",
    stage: "Preparing Content",
    due_date: "2026-07-01",
    content_type: "Static",
    coda_url: "https://coda.io/d/another-internal-doc",
    brief: null,
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

  it("never leaks internal task IDs or the internal Coda URL (AC3)", () => {
    const { container } = render(
      <ContentPipelineView tasks={mockTasks} isLoading={false} isError={false} />,
    );

    const html = container.innerHTML;
    expect(html).not.toContain("task-internal-id-001");
    expect(html).not.toContain("task-internal-id-002");
    expect(html).not.toContain("coda.io");
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
    const tasks: CodaTask[] = [
      { ...mockTasks[0], id: "launch-1", task_name: "Shipped winter promo", stage: "Ready to Launch" },
    ];
    render(<ContentPipelineView tasks={tasks} isLoading={false} isError={false} />);

    // "Ready to Launch" is a real column now (windowed to recent at sync time).
    expect(screen.getByText("Shipped winter promo")).toBeInTheDocument();
    expect(screen.getByText("Ready to Launch")).toBeInTheDocument();
  });

  it("drops unmapped / drifted-stage tasks from the board", () => {
    const tasks: CodaTask[] = [
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
    const tasks: CodaTask[] = [
      { ...mockTasks[0], id: "unmapped-only", stage: "Complete" },
    ];
    render(<ContentPipelineView tasks={tasks} isLoading={false} isError={false} />);
    expect(screen.getByText(/Nothing in production right now/i)).toBeInTheDocument();
  });

  it("degrades to a calm onboarding state when there is no data (AC4)", () => {
    render(<ContentPipelineView tasks={[]} isLoading={false} isError={false} />);
    expect(screen.getByText(/Nothing in production right now/i)).toBeInTheDocument();
  });

  it("degrades to the same onboarding state on fetch error rather than erroring (AC5)", () => {
    render(
      <ContentPipelineView tasks={undefined} isLoading={false} isError={true} />,
    );
    expect(screen.getByText(/Nothing in production right now/i)).toBeInTheDocument();
  });
});
