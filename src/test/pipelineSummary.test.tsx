/**
 * "Waiting on you" summary at the top of the client Content Pipeline board.
 * Counts cards in Client Review and shows the earliest due date among them.
 * Read-only: no buttons, links or inputs.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ContentPipelineView } from "@/components/client/ContentPipeline";
import { waitingOnYou } from "@/lib/pipelineSummary";
import type { PipelineTask } from "@/hooks/usePipelineTasks";

function task(over: Partial<PipelineTask>): PipelineTask {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    task_name: "Asset",
    stage: "Production",
    due_date: null,
    content_type: null,
    updated_at: null,
    ...over,
  };
}

describe("waitingOnYou", () => {
  it("counts only Client Review cards", () => {
    const result = waitingOnYou([
      task({ stage: "Client Review" }),
      task({ stage: "Client Review" }),
      task({ stage: "Editing" }),
      task({ stage: "Ready to Launch" }),
      task({ stage: null }),
    ]);
    expect(result.count).toBe(2);
  });

  it("returns the earliest due date among Client Review cards only", () => {
    const result = waitingOnYou([
      task({ stage: "Client Review", due_date: "2026-11-20" }),
      task({ stage: "Client Review", due_date: "2026-11-12" }),
      task({ stage: "Client Review", due_date: null }),
      // Earlier, but not waiting on the client.
      task({ stage: "Editing", due_date: "2026-11-01" }),
    ]);
    expect(result.nextDueDate).toBe("2026-11-12");
  });

  it("includes a past due date (earliest wins)", () => {
    const result = waitingOnYou([
      task({ stage: "Client Review", due_date: "2026-11-15" }),
      task({ stage: "Client Review", due_date: "2026-10-30" }),
    ]);
    expect(result.nextDueDate).toBe("2026-10-30");
  });

  it("returns a null due date when no Client Review card has one", () => {
    expect(waitingOnYou([task({ stage: "Client Review" })])).toEqual({
      count: 1,
      nextDueDate: null,
    });
  });

  it("handles empty or missing input", () => {
    expect(waitingOnYou([])).toEqual({ count: 0, nextDueDate: null });
    expect(waitingOnYou(undefined)).toEqual({ count: 0, nextDueDate: null });
  });

  it("does not match a stage by case or spacing", () => {
    expect(waitingOnYou([task({ stage: "client review" })]).count).toBe(0);
  });
});

describe("Waiting on you summary on the board", () => {
  it("shows the count and the earliest due date", () => {
    render(
      <ContentPipelineView
        tasks={[
          task({ stage: "Client Review", due_date: "2026-11-20" }),
          task({ stage: "Client Review", due_date: "2026-11-12" }),
          task({ stage: "Production", due_date: "2026-11-01" }),
        ]}
      />,
    );
    const summary = screen.getByTestId("pipeline-waiting-on-you");
    expect(within(summary).getByText(/Waiting on you/i)).toBeInTheDocument();
    expect(within(summary).getByText("2 assets are ready for your review.")).toBeInTheDocument();
    expect(within(summary).getByText("Earliest due date: Nov 12")).toBeInTheDocument();
  });

  it("uses the singular for one asset and omits the date line when there is no due date", () => {
    render(<ContentPipelineView tasks={[task({ stage: "Client Review" })]} />);
    const summary = screen.getByTestId("pipeline-waiting-on-you");
    expect(within(summary).getByText("1 asset is ready for your review.")).toBeInTheDocument();
    expect(within(summary).queryByText(/Earliest due date/)).not.toBeInTheDocument();
  });

  it("says nothing is waiting when no card is in Client Review", () => {
    render(<ContentPipelineView tasks={[task({ stage: "Editing" })]} />);
    const summary = screen.getByTestId("pipeline-waiting-on-you");
    expect(summary).toHaveTextContent("Nothing is waiting on you right now.");
  });

  it("is read-only: no buttons, links or inputs", () => {
    render(<ContentPipelineView tasks={[task({ stage: "Client Review", due_date: "2026-11-12" })]} />);
    const summary = screen.getByTestId("pipeline-waiting-on-you");
    expect(summary.querySelector("button, a, input, textarea, form, [role='button']")).toBeNull();
    expect(summary.querySelector(".cursor-pointer")).toBeNull();
  });

  it("is not shown on the empty board", () => {
    render(<ContentPipelineView tasks={[]} />);
    expect(screen.queryByTestId("pipeline-waiting-on-you")).not.toBeInTheDocument();
  });
});
