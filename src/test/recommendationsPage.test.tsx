/**
 * Recommendations (consolidation step 4c, port of the Goodo OS RecommendationOutcomes page).
 *
 * - A recommendation shows its state, decision, linked ads and the latest outcome with
 *   the ad numbers the database stored (no other numbers).
 * - Deciding needs a reason, and accepting a hypothesis and final action, before anything is sent.
 * - Linking sends the ads, owner and window against the version on screen.
 * - Evaluating asks the database; a learning is offered only after a measured outcome.
 * - model rules.
 * The database rules themselves are in supabase/tests/recommendations_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WithClient } from "./clientSelection";

const rpc = vi.fn();
const data: Record<string, unknown[]> = {};
const selects: string[] = [];

function chain(rows: () => unknown[]) {
  const q = {
    eq: () => q,
    order: () => q,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      if (name === "handoff_staff_options") return Promise.resolve({ data: [{ user_id: "emp-1", display_name: "Sam", email: "s@example.test" }], error: null });
      if (name === "recommendation_ad_options") return Promise.resolve({ data: [{ ad_id: "ad1", ad_name: "Routine hook", account_id: "act1" }, { ad_id: "ad2", ad_name: "Bath hook", account_id: "act1" }], error: null });
      return rpc(name, args);
    },
    from: (table: string) => ({ select: (cols: string) => { selects.push(`${table}:${cols}`); return chain(() => data[table] ?? []); } }),
  },
}));

import RecommendationsPage from "@/features/recommendations/RecommendationsPage";
import { canDecide, canLearn, canLink, evidenceTotals, SELECT, toRecommendations } from "@/features/recommendations/model";

const BASE = {
  id: "r1", engagement_id: "e1", client_slug: "glow", category: "creative", title: "Test routine hooks", proposal: "Run three routine hooks",
  state: "proposed", version: 1, recommendation_decisions: [], recommendation_execution_links: [], recommendation_outcomes: [], recommendation_learnings: [],
};
const ACCEPTED = {
  ...BASE, state: "accepted", version: 7,
  recommendation_decisions: [{ id: "d1", recommendation_version: 2, decision: "accepted", reason: "Winner opens on a routine", hypothesis: "Routine openers lower CPA", final_action: "Brief three hooks", evidence: [{ kind: "ad", id: "ad1" }], created_at: "x" }],
  recommendation_execution_links: [{ id: "l1", recommendation_version: 6, ad_ids: ["ad1"], pipeline_task_id: null, accountable_owner_id: "emp-1", review_window_start: "2026-10-01", review_window_end: "2026-10-07" }],
  recommendation_outcomes: [{ id: "o1", recommendation_version: 7, status: "measured", reason: "evidence_complete", evaluated_at: "x",
    recommendation_outcome_evidence: [{ ad_id: "ad1", account_id: "act1", impressions: 1000, spend: 50, clicks: 20, purchases: 2, purchase_value: 120, metric_days: 7, account_last_synced_at: "y" }] }],
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 2, error: null });
  selects.length = 0;
  data.clients = [{ slug: "glow", name: "Glow Drip" }];
  data.engagements = [{ id: "e1", cycle_number: 1, status: "active" }];
  data.pipeline_tasks = [];
  data.recommendations = [BASE];
});

const GLOW = [{ slug: "glow", name: "Glow Drip" }] as never[];

async function open(title = "Test routine hooks") {
  render(<WithClient slug="glow" clients={GLOW}><RecommendationsPage /></WithClient>);
  await screen.findByRole("option", { name: "Cycle 1 (active)" });
  fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
  return screen.findByRole("region", { name: `Recommendation ${title}` });
}

describe("RecommendationsPage", () => {
  it("asks for a client when none is selected", () => {
    render(<WithClient slug="" clients={GLOW}><RecommendationsPage /></WithClient>);
    expect(screen.getByText(/Pick a client in the switcher at the top of the page to see its recommendations/)).toBeTruthy();
  });

  it("loads with explicit relationship names", async () => {
    await open();
    expect(selects).toContain(`recommendations:${SELECT}`);
    expect(SELECT).toContain("recommendation_outcomes!recommendation_outcomes_recommendation_id_fkey(");
  });

  it("accepting needs a hypothesis and final action, then sends the cited ads", async () => {
    const card = await open();
    fireEvent.click(within(card).getByText("Decide"));
    fireEvent.change(within(card).getByLabelText("Reason"), { target: { value: "Winner opens on a routine" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save decision" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("hypothesis and a final action");
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.change(within(card).getByLabelText("Hypothesis"), { target: { value: "Routine openers lower CPA" } });
    fireEvent.change(within(card).getByLabelText("Final action"), { target: { value: "Brief three hooks" } });
    const picker = within(card).getByLabelText("Cited ads") as HTMLSelectElement;
    (picker.options[0] as HTMLOptionElement).selected = true;
    fireEvent.change(picker);
    fireEvent.click(within(card).getByRole("button", { name: "Save decision" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("decide_recommendation", {
      p_recommendation_id: "r1", p_expected_version: 1, p_decision: "accepted", p_reason: "Winner opens on a routine",
      p_hypothesis: "Routine openers lower CPA", p_final_action: "Brief three hooks", p_evidence: [{ kind: "ad", id: "ad1" }],
    }));
  });

  it("a rejection needs only a reason", async () => {
    const card = await open();
    fireEvent.click(within(card).getByText("Decide"));
    fireEvent.change(within(card).getByLabelText("Decision"), { target: { value: "rejected" } });
    fireEvent.change(within(card).getByLabelText("Reason"), { target: { value: "Not this cycle" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save decision" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("decide_recommendation", expect.objectContaining({ p_decision: "rejected", p_hypothesis: null, p_final_action: null, p_evidence: [] })));
  });

  it("links ads with an owner and window, against the version on screen", async () => {
    data.recommendations = [{ ...ACCEPTED, version: 3, recommendation_execution_links: [], recommendation_outcomes: [] }];
    const card = await open();
    fireEvent.click(within(card).getByText("Link the ads that execute it"));
    const picker = within(card).getByLabelText("Linked ads") as HTMLSelectElement;
    (picker.options[1] as HTMLOptionElement).selected = true;
    fireEvent.change(picker);
    fireEvent.change(within(card).getByLabelText("Accountable owner"), { target: { value: "emp-1" } });
    fireEvent.change(within(card).getByLabelText("Window start"), { target: { value: "2026-11-01" } });
    fireEvent.change(within(card).getByLabelText("Window end"), { target: { value: "2026-11-14" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save link" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("link_recommendation_execution", {
      p_recommendation_id: "r1", p_expected_version: 3, p_ad_ids: ["ad2"], p_pipeline_task_id: null, p_accountable_owner_id: "emp-1",
      p_review_window_start: "2026-11-01", p_review_window_end: "2026-11-14",
    }));
  });

  it("shows the stored outcome numbers and offers the learning after a measured outcome", async () => {
    data.recommendations = [ACCEPTED];
    const card = await open();
    const outcome = within(card).getByTestId("outcome-r1");
    expect(outcome).toHaveTextContent("Measured: ready for a person to review");
    expect(outcome).toHaveTextContent("1,000");
    expect(outcome).toHaveTextContent("50.00");
    expect(outcome).toHaveTextContent("120.00");
    fireEvent.change(within(card).getByLabelText("Learning"), { target: { value: "Routine openers held CPA" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save learning" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("review_recommendation_learning", {
      p_recommendation_id: "r1", p_expected_version: 7, p_outcome_id: "o1", p_conclusion: "supported", p_learning: "Routine openers held CPA",
    }));
  });

  it("evaluating asks the database and shows a refusal in plain words", async () => {
    data.recommendations = [{ ...ACCEPTED, recommendation_outcomes: [] }];
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "stale" } });
    const card = await open();
    fireEvent.click(within(card).getByRole("button", { name: "Evaluate from ad data" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("record_recommendation_outcome", { p_recommendation_id: "r1", p_expected_version: 7 }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("evaluate again");
  });
});

describe("model", () => {
  it("decide, link and learn rules", () => {
    const [p] = toRecommendations([BASE]);
    expect(canDecide(p)).toBe(true);
    expect(canLink(p)).toBe(false);
    expect(canLearn(p)).toBe(false);
    const [a] = toRecommendations([ACCEPTED]);
    expect(canDecide(a)).toBe(false);
    expect(canLink(a)).toBe(true);
    expect(canLearn(a)).toBe(true);
    const [done] = toRecommendations([{ ...ACCEPTED, version: 8, recommendation_learnings: [{ id: "x", recommendation_version: 8, outcome_id: "o1", conclusion: "supported", learning: "l" }] }]);
    expect(canLearn(done)).toBe(false);
    const [ins] = toRecommendations([{ ...ACCEPTED, recommendation_outcomes: [{ ...ACCEPTED.recommendation_outcomes[0], status: "insufficient", reason: "insufficient_testing" }] }]);
    expect(canLearn(ins)).toBe(false);
  });

  it("totals are plain sums of the stored rows", () => {
    expect(evidenceTotals([
      { ad_id: "a", account_id: "x", impressions: 10, spend: 1.5, clicks: 1, purchases: 0, purchase_value: 0, metric_days: 1, account_last_synced_at: null },
      { ad_id: "b", account_id: "x", impressions: 5, spend: 2, clicks: 2, purchases: 1, purchase_value: 30, metric_days: 1, account_last_synced_at: null },
    ])).toEqual({ impressions: 15, spend: 3.5, clicks: 3, purchases: 1, purchase_value: 30 });
  });
});
