/**
 * US-007 — Read-only content-pipeline transparency ("what we're making next").
 *
 * Verifies the client-facing ContentPipeline renders in-flight + upcoming work
 * in client language and, critically, that it is strictly READ-ONLY: NO
 * comment / approve / request-changes / upload affordances and no link-out /
 * click-to-open interaction controls render (AC2). It also asserts no internal
 * task IDs or strategist-only fields leak (AC3) and that missing data — empty
 * or errored — degrades to a calm onboarding state (AC4/AC5).
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
    stage: "Planning",
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
    expect(screen.getAllByText(/Planning/).length).toBeGreaterThan(0);
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

  it("degrades to a calm onboarding state when there is no data (AC4)", () => {
    render(<ContentPipelineView tasks={[]} isLoading={false} isError={false} />);
    expect(screen.getByText(/Nothing in production yet/i)).toBeInTheDocument();
  });

  it("degrades to the same onboarding state on fetch error rather than erroring (AC5)", () => {
    render(
      <ContentPipelineView tasks={undefined} isLoading={false} isError={true} />,
    );
    expect(screen.getByText(/Nothing in production yet/i)).toBeInTheDocument();
  });
});
