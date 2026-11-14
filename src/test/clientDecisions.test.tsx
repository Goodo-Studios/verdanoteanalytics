/**
 * Phase 5b: the client approves a card or asks for changes inside Verdanote.
 * Rules (lib), the card panel (approve, request changes with and without a note, already decided, change only
 * while in Client Review, wrong client / closed answers from the server), the "waiting on you" counts, and the
 * board refresh after a decision.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { ContentPipelineView } from "@/components/client/ContentPipeline";
import type { PipelineTask } from "@/hooks/usePipelineTasks";
import { waitingOnYou } from "@/lib/pipelineSummary";
import { groupByCycle } from "@/lib/pipelineCycles";
import {
  currentDecision,
  decidedTaskIds,
  decisionOptions,
  earlierDecisions,
  isNewDecision,
  noteProblem,
  staffDecisionText,
  type ClientDecision,
} from "@/lib/clientDecisions";

const NOW = new Date("2099-11-10T12:00:00Z");

const decision = (over: Partial<ClientDecision>): ClientDecision => ({
  id: "d1",
  clickup_task_id: "t-review",
  client_slug: "bearaby",
  task_name: "November Asset 4",
  decision: "approved",
  note: null,
  decided_by_label: "Alex",
  decided_at: "2099-11-09T10:00:00Z",
  superseded_at: null,
  ...over,
});

const card = (over: Partial<PipelineTask>): PipelineTask => ({
  id: "c1",
  clickup_task_id: "t-review",
  task_name: "November Asset 4 - Unboxing cut",
  stage: "Client Review",
  due_date: "2099-11-20",
  content_type: "Video",
  updated_at: "2099-11-09",
  cycle_month: "2099-11-01",
  asset_link: null,
  ...over,
});

describe("decision rules", () => {
  it("finds the current decision and the earlier ones, newest first", () => {
    const all = [
      decision({ id: "a", decided_at: "2099-11-01T00:00:00Z", superseded_at: "2099-11-02T00:00:00Z" }),
      decision({ id: "b", decided_at: "2099-11-02T00:00:00Z", decision: "changes_requested", note: "Shorter", superseded_at: "2099-11-03T00:00:00Z" }),
      decision({ id: "c", decided_at: "2099-11-03T00:00:00Z" }),
      decision({ id: "x", clickup_task_id: "other" }),
    ];
    expect(currentDecision(all, "t-review")?.id).toBe("c");
    expect(earlierDecisions(all, "t-review").map((d) => d.id)).toEqual(["b", "a"]);
    expect(currentDecision(all, null)).toBeNull();
    expect([...decidedTaskIds(all)].sort()).toEqual(["other", "t-review"]);
  });

  it("offers the right buttons by stage", () => {
    expect(decisionOptions("Client Review", null)).toEqual({ approve: true, requestChanges: true, canChange: false });
    expect(decisionOptions("Client Review", decision({}))).toEqual({ approve: false, requestChanges: true, canChange: true });
    expect(decisionOptions("Client Review", decision({ decision: "changes_requested", note: "x" })).approve).toBe(true);
    expect(decisionOptions("Ready to Launch", null)).toEqual({ approve: true, requestChanges: false, canChange: false });
    expect(decisionOptions("Ready to Launch", decision({}))).toEqual({ approve: false, requestChanges: false, canChange: false });
    expect(decisionOptions("Editing", null)).toEqual({ approve: false, requestChanges: false, canChange: false });
  });

  it("requires a note of 1 to 1000 characters for changes only", () => {
    expect(noteProblem("approved", "")).toBeNull();
    expect(noteProblem("changes_requested", "   ")).toMatch(/what to change/);
    expect(noteProblem("changes_requested", "x".repeat(1001))).toMatch(/1000/);
    expect(noteProblem("changes_requested", "Shorter intro")).toBeNull();
  });

  it("words decisions for staff and flags new ones", () => {
    expect(staffDecisionText(decision({}))).toBe("Approved by Alex");
    expect(staffDecisionText(decision({ decision: "changes_requested", note: "Shorter" }))).toBe("Changes requested by Alex: Shorter");
    expect(isNewDecision(decision({ decided_at: "2099-11-09T12:00:00Z" }), NOW.getTime())).toBe(true);
    expect(isNewDecision(decision({ decided_at: "2099-11-01T12:00:00Z" }), NOW.getTime())).toBe(false);
  });
});

describe("waiting on you reflects answers", () => {
  const tasks = [
    card({ id: "1", clickup_task_id: "t1", due_date: "2099-11-12" }),
    card({ id: "2", clickup_task_id: "t2", due_date: "2099-11-15" }),
    card({ id: "3", clickup_task_id: "t3", stage: "Editing" }),
  ];
  it("excludes answered cards from the count and the earliest date", () => {
    expect(waitingOnYou(tasks)).toEqual({ count: 2, nextDueDate: "2099-11-12", answered: 0 });
    expect(waitingOnYou(tasks, new Set(["t1"]))).toEqual({ count: 1, nextDueDate: "2099-11-15", answered: 1 });
    expect(waitingOnYou(tasks, new Set(["t1", "t2"]))).toEqual({ count: 0, nextDueDate: null, answered: 2 });
  });
  it("the cycle header counts only unanswered cards as waiting on you", () => {
    const [group] = groupByCycle(tasks, [], NOW, new Set(["t1"]));
    expect(group.waiting).toBe(1);
  });
});

function renderBoard(opts: { tasks?: PipelineTask[]; decisions?: ClientDecision[]; onDecide?: ReturnType<typeof vi.fn>; failed?: boolean }) {
  const onDecide = opts.onDecide ?? vi.fn().mockResolvedValue({ status: "recorded" });
  render(
    <ContentPipelineView
      tasks={opts.tasks ?? [card({})]}
      decisions={opts.decisions ?? []}
      decisionsFailed={opts.failed}
      onDecide={onDecide}
      now={NOW}
    />,
  );
  return onDecide;
}

describe("the card panel", () => {
  it("approve sends the decision for that card and thanks the client", async () => {
    const onDecide = renderBoard({});
    fireEvent.click(screen.getByTestId("decision-approve"));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ taskId: "t-review", decision: "approved" }));
    expect(await screen.findByTestId("decision-thanks")).toHaveTextContent("Thank you");
  });

  it("request changes needs a note: with none it asks and sends nothing", async () => {
    const onDecide = renderBoard({});
    fireEvent.click(screen.getByTestId("decision-request-changes"));
    fireEvent.click(screen.getByTestId("decision-send-changes"));
    expect(await screen.findByTestId("decision-error")).toHaveTextContent("Please tell us what to change.");
    fireEvent.change(screen.getByTestId("decision-note"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("decision-send-changes"));
    expect(screen.getByTestId("decision-error")).toHaveTextContent("tell us what to change");
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("request changes with a note sends the trimmed note", async () => {
    const onDecide = renderBoard({});
    fireEvent.click(screen.getByTestId("decision-request-changes"));
    fireEvent.change(screen.getByTestId("decision-note"), { target: { value: "  Shorter intro please  " } });
    fireEvent.click(screen.getByTestId("decision-send-changes"));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ taskId: "t-review", decision: "changes_requested", note: "Shorter intro please" }));
  });

  it("limits the note to 1000 characters", () => {
    renderBoard({});
    fireEvent.click(screen.getByTestId("decision-request-changes"));
    const box = screen.getByTestId("decision-note") as HTMLTextAreaElement;
    expect(box).toHaveAttribute("maxlength", "1000");
    fireEvent.change(box, { target: { value: "x".repeat(1200) } });
    expect(box.value).toHaveLength(1000);
  });

  it("an already decided card shows the answer and no buttons until the client asks to change it", () => {
    renderBoard({ decisions: [decision({})] });
    expect(screen.getByTestId("decision-current")).toHaveTextContent("Alex approved this on Nov 9.");
    expect(screen.queryByTestId("decision-approve")).toBeNull();
    expect(screen.queryByTestId("decision-request-changes")).toBeNull();
    fireEvent.click(screen.getByTestId("decision-change"));
    expect(screen.getByTestId("decision-request-changes")).toBeInTheDocument();
    expect(screen.queryByTestId("decision-approve")).toBeNull();
  });

  it("shows the earlier answers as history", () => {
    renderBoard({
      decisions: [
        decision({ id: "old", decision: "changes_requested", note: "Shorter intro", superseded_at: "2099-11-09T09:00:00Z", decided_at: "2099-11-08T09:00:00Z" }),
        decision({ id: "new" }),
      ],
    });
    expect(screen.getByTestId("decision-history")).toHaveTextContent("Earlier answers (1)");
    expect(screen.getByTestId("decision-history")).toHaveTextContent("Note: Shorter intro");
  });

  it("delivered work offers Approve once, and no change after it is decided", () => {
    const delivered = card({ id: "d", clickup_task_id: "t-done", stage: "Ready to Launch", delivered_at: "2099-11-05", due_date: null });
    const { unmount } = render(<ContentPipelineView tasks={[delivered]} decisions={[]} onDecide={vi.fn()} now={NOW} />);
    expect(screen.getByTestId("decision-approve")).toBeInTheDocument();
    expect(screen.queryByTestId("decision-request-changes")).toBeNull();
    unmount();
    render(<ContentPipelineView tasks={[delivered]} decisions={[decision({ clickup_task_id: "t-done" })]} onDecide={vi.fn()} now={NOW} />);
    expect(screen.queryByTestId("decision-change")).toBeNull();
    expect(screen.getByTestId("decision-current")).toBeInTheDocument();
  });

  it("a card in another stage has no buttons", () => {
    renderBoard({ tasks: [card({ stage: "Editing" })] });
    expect(screen.queryByTestId("decision-panel")).toBeNull();
  });

  it("shows the server's plain message when the card is not the client's or is closed", async () => {
    const onDecide = vi.fn().mockRejectedValue(new Error("We could not find that asset."));
    renderBoard({ onDecide });
    fireEvent.click(screen.getByTestId("decision-approve"));
    expect(await screen.findByTestId("decision-error")).toHaveTextContent("We could not find that asset.");
  });

  it("pauses the buttons when the earlier answers could not load", () => {
    renderBoard({ failed: true });
    expect(screen.queryByTestId("decision-approve")).toBeNull();
    expect(screen.getByTestId("pipeline-decisions-failed")).toBeInTheDocument();
  });

  it("the summary counts only cards still waiting, and thanks the client when all are answered", () => {
    renderBoard({ decisions: [decision({})] });
    expect(screen.getByTestId("pipeline-waiting-on-you")).toHaveTextContent("Thank you. Everything you have reviewed is with our team now.");
  });

  it("without onDecide (read-only and staff views) there is no panel at all", () => {
    render(<ContentPipelineView tasks={[card({})]} decisions={[decision({})]} now={NOW} />);
    expect(screen.queryByTestId("decision-panel")).toBeNull();
  });

  it("uses no em dashes in client wording", () => {
    renderBoard({ decisions: [decision({ decision: "changes_requested", note: "Shorter" })] });
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(8212));
  });
});

describe("the board refreshes after a decision", () => {
  it("useRecordDecision posts to client-decision and invalidates the board, the answers and the counts", async () => {
    vi.resetModules();
    const apiFetch = vi.fn().mockResolvedValue({ success: true, status: "recorded" });
    vi.doMock("@/lib/api", () => ({ apiFetch }));
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: {} }));
    vi.doMock("@/hooks/useHomeData", () => ({ useStaffHomeAccess: () => ({ enabled: false }) }));
    const { useRecordDecision } = await import("@/hooks/useClientDecisions");
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    let mutate!: ReturnType<typeof useRecordDecision>["mutateAsync"];
    function Probe() {
      mutate = useRecordDecision().mutateAsync;
      return null;
    }
    render(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    );
    await act(async () => {
      await mutate({ taskId: "t-review", decision: "approved" });
    });
    expect(apiFetch).toHaveBeenCalledWith("client-decision", "", { method: "POST", body: JSON.stringify({ taskId: "t-review", decision: "approved" }) });
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(["client-decisions", "pipeline-tasks", "pipeline-delivered"]));
    vi.doUnmock("@/lib/api");
    vi.doUnmock("@/integrations/supabase/client");
    vi.doUnmock("@/hooks/useHomeData");
  });
});
