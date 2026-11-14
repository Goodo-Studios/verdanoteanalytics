/**
 * Learning (consolidation step 4c, port of the Goodo OS learning editor, review,
 * withdrawal and self-service pages).
 *
 * - A lesson shows its version, review stage and what still blocks publication.
 * - Only the assigned reviewer accepts, then approves or rejects.
 * - A builder publishes a lesson that passes every check and withdraws it with a reason.
 * - A draft is saved against the version on screen with the reviewer and checks.
 * - The weekly tally is recorded for the Monday of the chosen week; snapshots show stored numbers.
 * - model rules.
 * The database rules themselves are in supabase/tests/learning_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const data: Record<string, unknown[]> = {};
let auth = { user: { id: "rev-1" }, isBuilder: false };

function chain(rows: () => unknown[]) {
  const q = {
    eq: () => q,
    order: () => q,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
  };
  return q;
}

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      if (name === "handoff_staff_options") return Promise.resolve({ data: [{ user_id: "rev-1", display_name: "Rae", email: "r@example.test" }, { user_id: "auth-1", display_name: "Ann", email: "a@example.test" }], error: null });
      return rpc(name, args);
    },
    from: (table: string) => ({ select: () => chain(() => data[table] ?? []) }),
  },
}));

import LearningPage from "@/features/learning/LearningPage";
import { WithClient } from "./clientSelection";
import { canAccept, canDecide, mondayOf, publicationBlockers, reviewStage, toLessons } from "@/features/learning/model";

const V1 = {
  version: 1, summary: "How to film at home", steps: ["Face a window"], checklist: ["Clean lens"], source_refs: ["https://example.test/guide"],
  applicability: ["standard"], source_clearance: "cleared", client_use_rights: "client_approved", blocking_gaps: [], assigned_reviewer: "rev-1", authored_by: "auth-1",
};
const LESSON = {
  id: "m1", client_slug: "glow", module_key: "filming-at-home", title: "Filming at home", current_version: 1, published_version: null, active: false,
  learning_module_versions: [V1], learning_reviews: [], learning_history: [],
};
const review = (action: string) => ({ id: action, version: 1, action, reviewer_id: "rev-1", note: null });

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 1, error: null });
  data.clients = [{ slug: "glow", name: "Glow Drip" }];
  data.learning_modules = [LESSON];
  data.engagements = [{ id: "e1", cycle_number: 1, status: "active" }];
  data.learning_support_weeks = [];
  data.learning_self_service_snapshots = [];
  auth = { user: { id: "rev-1" }, isBuilder: false };
});

const CLIENTS = [{ slug: "glow", name: "Glow Drip" }] as never[];
const page = (slug: string) => (
  <WithClient slug={slug} clients={CLIENTS}>
    <LearningPage />
  </WithClient>
);

async function openLesson() {
  render(page("glow"));
  return screen.findByRole("region", { name: "Lesson Filming at home" });
}

describe("LearningPage lessons", () => {
  it("the assigned reviewer accepts the version for review", async () => {
    const card = await openLesson();
    expect(within(card).getByTestId("lesson-m1")).toHaveTextContent("Version 1 · Waiting for the reviewer to accept it for review");
    fireEvent.click(within(card).getByRole("button", { name: "Accept for review" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("review_learning_version", { p_module_id: "m1", p_version: 1, p_action: "accepted", p_note: null }));
  });

  it("someone else gets no review buttons", async () => {
    auth = { user: { id: "auth-1" }, isBuilder: false };
    data.learning_modules = [{ ...LESSON, learning_reviews: [review("accepted")] }];
    const card = await openLesson();
    expect(within(card).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Accept for review" })).toBeNull();
  });

  it("a builder sees what blocks publication, then publishes an approved lesson", async () => {
    auth = { user: { id: "b-1" }, isBuilder: true };
    data.learning_modules = [{ ...LESSON, learning_module_versions: [{ ...V1, source_refs: ["http://example.test"] }], learning_reviews: [review("accepted"), review("approved")] }];
    const { rerender } = render(page("glow"));
    let card = await screen.findByRole("region", { name: "Lesson Filming at home" });
    expect(within(card).getByTestId("blockers-m1")).toHaveTextContent("source links must be https");
    expect(within(card).queryByRole("button", { name: "Publish version 1" })).toBeNull();
    data.learning_modules = [{ ...LESSON, learning_reviews: [review("accepted"), review("approved")] }];
    rerender(page(""));
    rerender(page("glow"));
    card = await screen.findByRole("region", { name: "Lesson Filming at home" });
    fireEvent.click(within(card).getByRole("button", { name: "Publish version 1" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("publish_learning_version", { p_module_id: "m1", p_version: 1 }));
  });

  it("a builder withdraws a published lesson with a reason", async () => {
    auth = { user: { id: "b-1" }, isBuilder: true };
    data.learning_modules = [{ ...LESSON, active: true, published_version: 1, learning_reviews: [review("accepted"), review("approved")] }];
    const card = await openLesson();
    expect(within(card).getByRole("button", { name: "Withdraw" })).toBeDisabled();
    fireEvent.change(within(card).getByLabelText("Withdrawal reason"), { target: { value: "Process changed" } });
    fireEvent.click(within(card).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("withdraw_learning_module", { p_module_id: "m1", p_reason: "Process changed" }));
  });

  it("saves the next draft against the version on screen", async () => {
    auth = { user: { id: "auth-1" }, isBuilder: false };
    const card = await openLesson();
    fireEvent.click(within(card).getByText("Write version 2"));
    fireEvent.change(within(card).getByLabelText("Steps"), { target: { value: "Face a window\n\n Hold the phone upright " } });
    fireEvent.click(within(card).getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_learning_draft", {
      p_module_id: "m1", p_expected_version: 1, p_summary: "How to film at home", p_steps: ["Face a window", "Hold the phone upright"],
      p_checklist: ["Clean lens"], p_source_refs: ["https://example.test/guide"], p_applicability: ["standard"], p_source_clearance: "cleared",
      p_client_use_rights: "client_approved", p_blocking_gaps: [], p_assigned_reviewer: "rev-1",
    }));
  });
});

describe("LearningPage self-service", () => {
  async function openEngagement() {
    render(page("glow"));
    fireEvent.click(screen.getByRole("button", { name: "Self-service" }));
    await screen.findByRole("option", { name: "Cycle 1 (active)" });
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
  }

  it("records the tally for the Monday of the chosen week", async () => {
    await openEngagement();
    fireEvent.change(await screen.findByLabelText("Week"), { target: { value: "2026-11-12" } });
    fireEvent.change(screen.getByLabelText("Questions"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Record week of 2026-11-09" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("record_learning_support_week", {
      p_engagement_id: "e1", p_week_start: "2026-11-09", p_observation_status: "observed", p_recurring_how_to_questions: 3, p_data_origin: "pilot_observation",
    }));
  });

  it("shows a stored snapshot with its missing weeks and usage note", async () => {
    data.learning_self_service_snapshots = [{
      id: "s1", baseline_start: "2026-09-07", baseline_end: "2026-09-20", pilot_start: "2026-09-21", pilot_end: "2026-10-04",
      baseline_questions: 4, baseline_weeks_observed: 1, baseline_weeks_missing: 1, baseline_rate: 4, pilot_questions: 3, pilot_weeks_observed: 2,
      pilot_weeks_missing: 0, pilot_rate: 1.5, comparison: "better", pilot_status: "complete", data_origin: "synthetic_fixture",
      usage_note: "Lesson opens are not measured.", created_at: "x",
    }];
    await openEngagement();
    const snap = await screen.findByTestId("snapshot-s1");
    expect(snap).toHaveTextContent("4 questions over 1 observed weeks (1 missing), rate 4 per week");
    expect(snap).toHaveTextContent("Repeat support: better · pilot complete · data synthetic fixture. Lesson opens are not measured.");
  });
});

describe("LearningPage with no client selected", () => {
  it("asks for a client on both tabs and loads no lessons", () => {
    render(page(""));
    expect(screen.getByText(/Pick a client in the switcher at the top of the page to see/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Lesson Filming at home" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Self-service" }));
    expect(screen.getByText(/Pick a client in the switcher at the top of the page to see/)).toBeTruthy();
  });
});

describe("model", () => {
  it("review stages and who may act", () => {
    const [l] = toLessons([LESSON]);
    expect(reviewStage(l)).toBe("waiting");
    expect(canAccept(l, "rev-1")).toBe(true);
    expect(canAccept(l, "auth-1")).toBe(false);
    const [r] = toLessons([{ ...LESSON, learning_reviews: [review("accepted")] }]);
    expect(reviewStage(r)).toBe("in_review");
    expect(canDecide(r, "rev-1")).toBe(true);
    const [x] = toLessons([{ ...LESSON, learning_module_versions: [{ ...V1, assigned_reviewer: null }] }]);
    expect(reviewStage(x)).toBe("no_reviewer");
  });

  it("publication blockers match the database checks", () => {
    const [ok] = toLessons([{ ...LESSON, learning_reviews: [review("accepted"), review("approved")] }]);
    expect(publicationBlockers(ok)).toEqual([]);
    const [bad] = toLessons([{ ...LESSON, learning_module_versions: [{ ...V1, source_clearance: "pending", blocking_gaps: ["legal"], steps: [] }] }]);
    expect(publicationBlockers(bad)).toEqual(["not approved by the assigned reviewer", "sources not cleared", "blocking gaps listed", "no steps"]);
  });

  it("monday of a week", () => {
    expect(mondayOf("2026-11-12")).toBe("2026-11-09");
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09");
  });
});
