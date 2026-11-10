/**
 * Strategy proposals (consolidation step 4c, port of the Goodo OS StrategyProposals page).
 *
 * - A proposal shows its state, source and fields; a stale source is called out.
 * - Someone other than the author reviews with a note and accepts; the author
 *   gets no review or accept buttons.
 * - An accepted version is published; a new version is written against the one on screen.
 * - Creating a proposal sends the published source and the fields.
 * - model rules.
 * The database rules themselves are in supabase/tests/strategy_proposals_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WithClient } from "./clientSelection";

const rpc = vi.fn();
const data: Record<string, unknown[]> = {};
let auth = { user: { id: "reviewer-1" }, isBuilder: false };

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
    rpc: (name: string, args: unknown) => rpc(name, args),
    from: (table: string) => ({ select: () => chain(() => data[table] ?? []) }),
  },
}));

import StrategyPage from "@/features/strategy/StrategyPage";
import { canAccept, canPublish, canReview, canRevise, errorText, proposalState, sourceCurrent, toProposals } from "@/features/strategy/model";

const VERSION = {
  version: 1, source_subject_id: "s1", source_version: 1, title: "Routine strategy", summary: "Lead with the routine",
  brief: "Film three routines", angle: "Morning routine", goal: "Lower CPA", required_inputs: ["Raw footage", "Brand fonts"],
  created_by: "author-1", created_at: "2026-11-10T00:00:00Z",
};
const PROPOSAL = {
  id: "p1", engagement_id: "e1", client_slug: "glow", current_version: 1, created_by: "author-1",
  strategy_proposal_versions: [VERSION], strategy_proposal_reviews: [], strategy_proposal_acceptances: [], strategy_proposal_publications: [],
};
const SUBJECT = { id: "s1", subject_kind: "idea", title: "Morning routine idea", published_version: 1 };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: "ok", error: null });
  data.clients = [{ slug: "glow", name: "Glow Drip" }];
  data.engagements = [{ id: "e1", cycle_number: 1, status: "active" }];
  data.approval_subjects = [SUBJECT];
  data.strategy_proposals = [PROPOSAL];
  auth = { user: { id: "reviewer-1" }, isBuilder: false };
});

const GLOW = [{ slug: "glow", name: "Glow Drip" }] as never[];

async function openEngagement() {
  render(<WithClient slug="glow" clients={GLOW}><StrategyPage /></WithClient>);
  await screen.findByRole("option", { name: "Cycle 1 (active)" });
  fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
}

describe("StrategyPage", () => {
  it("asks for a client when none is selected", () => {
    render(<WithClient slug="" clients={GLOW}><StrategyPage /></WithClient>);
    expect(screen.getByText(/Pick a client in the switcher at the top of the page to see its strategy proposals/)).toBeTruthy();
  });

  it("shows the proposal with its state, source and fields", async () => {
    await openEngagement();
    const card = await screen.findByRole("region", { name: "Strategy proposal Routine strategy" });
    expect(within(card).getByTestId("proposal-p1")).toHaveTextContent("Waiting for a review · version 1 · based on Morning routine idea version 1");
    expect(within(card).getByText("Film three routines")).toBeTruthy();
    expect(within(card).getByText("Brand fonts")).toBeTruthy();
  });

  it("says when the source has a newer published version", async () => {
    data.approval_subjects = [{ ...SUBJECT, published_version: 2 }];
    await openEngagement();
    const card = await screen.findByRole("region", { name: "Strategy proposal Routine strategy" });
    expect(within(card).getByTestId("proposal-p1")).toHaveTextContent("the source has a newer published version");
  });

  it("a reviewer needs a note, then reviews the exact version", async () => {
    await openEngagement();
    const card = await screen.findByRole("region", { name: "Strategy proposal Routine strategy" });
    fireEvent.click(within(card).getByRole("button", { name: "Mark reviewed" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("Write a review note first");
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.change(within(card).getByLabelText("Review note"), { target: { value: "Fits the idea" } });
    fireEvent.click(within(card).getByRole("button", { name: "Mark reviewed" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("review_strategy_proposal", { p_proposal_id: "p1", p_version: 1, p_decision: "reviewed", p_note: "Fits the idea" }));
  });

  it("the author gets no review or accept buttons", async () => {
    auth = { user: { id: "author-1" }, isBuilder: false };
    data.strategy_proposals = [{ ...PROPOSAL, strategy_proposal_reviews: [{ id: "r1", version: 1, decision: "reviewed", note: "ok", reviewer_id: "reviewer-1", created_at: "2026-11-10T01:00:00Z" }] }];
    await openEngagement();
    const card = await screen.findByRole("region", { name: "Strategy proposal Routine strategy" });
    expect(within(card).queryByRole("button", { name: "Mark reviewed" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Accept version 1" })).toBeNull();
  });

  it("accepts a reviewed version and publishes an accepted one", async () => {
    data.strategy_proposals = [{ ...PROPOSAL, strategy_proposal_reviews: [{ id: "r1", version: 1, decision: "reviewed", note: "ok", reviewer_id: "x", created_at: "2026-11-10T01:00:00Z" }] }];
    await openEngagement();
    let card = await screen.findByRole("region", { name: "Strategy proposal Routine strategy" });
    fireEvent.click(within(card).getByRole("button", { name: "Accept version 1" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("accept_strategy_proposal", { p_proposal_id: "p1", p_version: 1 }));
    rpc.mockClear();
    data.strategy_proposals = [{ ...PROPOSAL, current_version: 1, strategy_proposal_acceptances: [{ version: 1, created_at: "2026-11-10T02:00:00Z" }] }];
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
    card = await screen.findByRole("region", { name: "Strategy proposal Routine strategy" });
    expect(within(card).getByTestId("proposal-p1")).toHaveTextContent("Accepted, not published");
    expect(within(card).queryByRole("button", { name: /Write version/ })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Publish as the engagement strategy" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("publish_strategy_proposal", { p_proposal_id: "p1", p_version: 1 }));
  });

  it("writes the next version against the one on screen", async () => {
    await openEngagement();
    const card = await screen.findByRole("region", { name: "Strategy proposal Routine strategy" });
    fireEvent.click(within(card).getByRole("button", { name: "Write version 2" }));
    fireEvent.change(within(card).getByLabelText("Angle"), { target: { value: "Night routine" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save version 2" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("revise_strategy_proposal", {
      p_proposal_id: "p1", p_expected_version: 1, p_source_subject_id: "s1", p_source_version: 1, p_title: "Routine strategy",
      p_summary: "Lead with the routine", p_brief: "Film three routines", p_angle: "Night routine", p_goal: "Lower CPA", p_required_inputs: ["Raw footage", "Brand fonts"],
    }));
  });

  it("creates a proposal on a published source", async () => {
    data.strategy_proposals = [];
    await openEngagement();
    fireEvent.click(await screen.findByText("Write a strategy proposal"));
    const form = screen.getByText("Write a strategy proposal").closest("details") as HTMLElement;
    fireEvent.change(within(form).getByLabelText("Approved source"), { target: { value: "s1:1" } });
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Routine strategy" } });
    fireEvent.change(within(form).getByLabelText("Summary"), { target: { value: "Lead with the routine" } });
    fireEvent.change(within(form).getByLabelText("Goal"), { target: { value: "Lower CPA" } });
    fireEvent.change(within(form).getByLabelText("Angle"), { target: { value: "Morning routine" } });
    fireEvent.change(within(form).getByLabelText("Brief"), { target: { value: "Film three routines" } });
    fireEvent.change(within(form).getByLabelText("Required inputs"), { target: { value: "Raw footage\n\n Brand fonts " } });
    fireEvent.click(within(form).getByRole("button", { name: "Create proposal" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("create_strategy_proposal", {
      p_engagement_id: "e1", p_source_subject_id: "s1", p_source_version: 1, p_title: "Routine strategy", p_summary: "Lead with the routine",
      p_brief: "Film three routines", p_angle: "Morning routine", p_goal: "Lower CPA", p_required_inputs: ["Raw footage", "Brand fonts"],
    }));
  });

  it("shows the database refusal in plain words", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "stale" } });
    data.strategy_proposals = [{ ...PROPOSAL, strategy_proposal_reviews: [{ id: "r1", version: 1, decision: "reviewed", note: "ok", reviewer_id: "x", created_at: "2026-11-10T01:00:00Z" }] }];
    await openEngagement();
    const card = await screen.findByRole("region", { name: "Strategy proposal Routine strategy" });
    fireEvent.click(within(card).getByRole("button", { name: "Accept version 1" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("newer published version");
  });
});

describe("model", () => {
  const review = (decision: string, created_at: string) => ({ id: created_at, version: 1, decision, note: "n", reviewer_id: "r", created_at });
  it("state follows the latest review, acceptance and publication of the current version", () => {
    const [p] = toProposals([PROPOSAL]);
    expect(proposalState(p)).toBe("proposed");
    const [q] = toProposals([{ ...PROPOSAL, strategy_proposal_reviews: [review("reviewed", "2026-11-10T01:00:00Z"), review("changes_requested", "2026-11-10T02:00:00Z")] }]);
    expect(proposalState(q)).toBe("changes_requested");
    const [a] = toProposals([{ ...PROPOSAL, strategy_proposal_acceptances: [{ version: 1, created_at: "x" }] }]);
    expect(proposalState(a)).toBe("accepted");
    expect(canPublish(a)).toBe(true);
    expect(canRevise(a)).toBe(false);
    const [pub] = toProposals([{ ...PROPOSAL, strategy_proposal_acceptances: [{ version: 1, created_at: "x" }], strategy_proposal_publications: [{ version: 1, created_at: "y" }] }]);
    expect(proposalState(pub)).toBe("published");
    expect(canPublish(pub)).toBe(false);
  });

  it("the author never reviews or accepts; acceptance needs reviewed", () => {
    const [p] = toProposals([PROPOSAL]);
    expect(canReview(p, "author-1")).toBe(false);
    expect(canReview(p, "reviewer-1")).toBe(true);
    expect(canAccept(p, "reviewer-1")).toBe(false);
    const [r] = toProposals([{ ...PROPOSAL, strategy_proposal_reviews: [review("reviewed", "2026-11-10T01:00:00Z")] }]);
    expect(canAccept(r, "reviewer-1")).toBe(true);
    expect(canAccept(r, "author-1")).toBe(false);
  });

  it("source currency and error codes", () => {
    const [p] = toProposals([PROPOSAL]);
    expect(sourceCurrent(p, [SUBJECT as never])).toBe(true);
    expect(sourceCurrent(p, [{ ...SUBJECT, published_version: 2 } as never])).toBe(false);
    expect(sourceCurrent(p, [])).toBe(false);
    expect(errorText("42501", "x")).toMatch(/does not review or accept/);
    expect(errorText("99999", "fallback")).toBe("fallback");
  });
});
