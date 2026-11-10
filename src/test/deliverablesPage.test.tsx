/**
 * Deliverables and approvals (consolidation step 4b, port of the Goodo OS
 * DeliverablesReview page and the idea and shot list approvals).
 *
 * - Picking a client and engagement lists deliverables with stage, rounds and the
 *   current review link.
 * - Revisions are added with the revision on screen; decisions are recorded on the
 *   current revision with a channel and note; an exception_pending answer explains
 *   that a builder has to approve an extra round.
 * - Only builders get the exception buttons.
 * - Ideas and shot lists: save a draft with the version on screen, publish the
 *   latest draft, record the client's decision on the published version.
 * - model rules.
 * The database rules themselves are in supabase/tests/deliverables_approvals_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.fn();
const data: Record<string, unknown[]> = {};
let auth = { user: { id: "emp-1" }, isBuilder: false };

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
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => ({ select: () => chain(() => data[table] ?? []) }),
  },
}));

import DeliverablesPage from "@/features/deliverables/DeliverablesPage";
import { canDecideApproval, canPublish, canRecordDecision, errorText, roundsUsed, toDeliverables, toSubjects } from "@/features/deliverables/model";

const rev = (n: number) => ({ revision: n, review_url: `https://air.inc/r/${n}`, air_revision_id: n === 2 ? "air-2" : null, note: null, created_by: "emp-1", created_at: "2026-11-03T00:00:00Z" });
const VIDEO = {
  id: "d1", engagement_id: "e1", title: "Hook video", asset_kind: "video", agreed_item: "Video ads", current_revision: 2, stage: "client_review", final_download_url: null,
  engagement_deliverable_revisions: [rev(1), rev(2)],
  engagement_deliverable_decisions: [{ id: "x1", revision: 1, decision: "changes_requested", client_round: 1, channel: "slack", source_note: "Shorter intro", recorded_by: "emp-1", created_at: "2026-11-04T00:00:00Z" }],
  engagement_deliverable_round_exceptions: [],
};
const STATIC = {
  ...VIDEO, id: "d2", title: "Static ad", current_revision: 1, stage: "client_review", engagement_deliverable_revisions: [rev(1)], engagement_deliverable_decisions: [],
  engagement_deliverable_round_exceptions: { id: "ex1", revision: 1, status: "pending", reason: "Client asked for changes beyond the included rounds: new color", decision_reason: null },
};
const IDEA = {
  id: "s1", engagement_id: "e1", subject_kind: "idea", title: "Founder story", current_version: 2, published_version: 1,
  approval_subject_versions: [
    { version: 1, state: "published", body: "Founder explains why.", published_at: "2026-11-02T00:00:00Z" },
    { version: 2, state: "draft", body: "Founder story, shorter.", published_at: null },
  ],
  approval_subject_decisions: [],
};

beforeEach(() => {
  rpc.mockReset();
  data.clients = [{ slug: "glow", name: "Glow Drip" }];
  data.engagements = [{ id: "e1", cycle_number: 1, status: "active" }];
  data.engagement_deliverables = [VIDEO, STATIC];
  data.approval_subjects = [IDEA];
  auth = { user: { id: "emp-1" }, isBuilder: false };
});

function renderPage(url = "/builder/deliverables") {
  return render(<MemoryRouter initialEntries={[url]}><DeliverablesPage /></MemoryRouter>);
}

async function open() {
  renderPage();
  await screen.findByRole("option", { name: "Glow Drip" });
  fireEvent.change(screen.getByLabelText("Client"), { target: { value: "glow" } });
  await screen.findByRole("option", { name: "Cycle 1 (Active)" });
  fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
  return screen.findByRole("region", { name: "Hook video" });
}

describe("DeliverablesPage", () => {
  it("shows stage, rounds, the current review link and the decision history", async () => {
    const card = await open();
    expect(within(card).getByTestId("stage-d1")).toHaveTextContent("Waiting for the client · revision 2 · 1 client round used · counts against Video ads");
    expect(within(card).getByRole("link", { name: "open revision 2" })).toHaveAttribute("href", "https://air.inc/r/2");
    expect(within(card).getByText(/Revision 1: changes requested \(round 1\) by slack: Shorter intro/)).toBeTruthy();
  });

  it("records the client's decision on the current revision with its channel", async () => {
    rpc.mockResolvedValue({ data: "recorded", error: null });
    const card = await open();
    const group = within(card).getByRole("group", { name: "Client decision on revision 2" });
    fireEvent.change(within(group).getByLabelText("Where the decision came from"), { target: { value: "email" } });
    fireEvent.change(within(group).getByLabelText("Decision note"), { target: { value: "Looks great" } });
    fireEvent.click(within(group).getByRole("button", { name: "Client approved" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("record_deliverable_client_decision", {
      p_deliverable_id: "d1", p_revision: 2, p_decision: "approved", p_channel: "email", p_source_note: "Looks great",
    }));
  });

  it("explains a pending extra round", async () => {
    rpc.mockResolvedValue({ data: "exception_pending", error: null });
    const card = await open();
    fireEvent.change(within(card).getByLabelText("Decision note"), { target: { value: "More changes" } });
    fireEvent.click(within(card).getByRole("button", { name: "Client asked for changes" }));
    expect(await within(card).findByRole("status")).toHaveTextContent("beyond the included client rounds");
  });

  it("adds the next revision with the revision on screen", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const card = await open();
    const add = within(card).getByRole("button", { name: "Add revision 3" });
    expect(add).toBeDisabled();
    fireEvent.change(within(card).getByLabelText("Review link"), { target: { value: "https://air.inc/r/3" } });
    fireEvent.click(add);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("add_deliverable_revision", { p_deliverable_id: "d1", p_expected_revision: 2, p_review_url: "https://air.inc/r/3", p_air_revision_id: null }));
  });

  it("only a builder decides an extra round", async () => {
    await open();
    const stat = screen.getByRole("region", { name: "Static ad" });
    expect(within(stat).getByText("Waiting for a builder.")).toBeTruthy();
    expect(within(stat).queryByRole("group")).toBeNull(); // no decision while the exception is pending
  });

  it("a builder approves an extra round with a reason", async () => {
    auth = { user: { id: "b1" }, isBuilder: true };
    rpc.mockResolvedValue({ data: "approved", error: null });
    await open();
    const stat = screen.getByRole("region", { name: "Static ad" });
    fireEvent.change(within(stat).getByLabelText("Exception reason"), { target: { value: "Goodwill" } });
    fireEvent.click(within(stat).getByRole("button", { name: "Approve one extra round" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("decide_deliverable_round_exception", { p_exception_id: "ex1", p_approve: true, p_reason: "Goodwill" }));
  });

  it("ideas: publish the latest draft and record a decision on the published version", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    await open();
    const idea = screen.getByRole("region", { name: "Founder story" });
    expect(within(idea).getByTestId("subject-s1")).toHaveTextContent("Latest version 2 (draft) · client sees version 1");
    fireEvent.click(within(idea).getByRole("button", { name: "Publish version 2" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("publish_approval_version", { p_subject_id: "s1", p_version: 2 }));
    const group = within(idea).getByRole("group", { name: "Client decision on version 1" });
    fireEvent.change(within(group).getByLabelText("Decision note"), { target: { value: "Yes on the call" } });
    fireEvent.click(within(group).getByRole("button", { name: "Client approved" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("record_approval_decision", { p_subject_id: "s1", p_version: 1, p_decision: "approved", p_channel: "call", p_source_note: "Yes on the call" }));
  });

  it("asks before withdrawing a deliverable, and Cancel sends nothing", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const card = await open();
    fireEvent.click(within(card).getByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Withdraw this deliverable?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole("button", { name: "Withdraw" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("withdraw_engagement_deliverable", { p_deliverable_id: "d1" }));
  });

  it("uses plain labels: Air version and readable deliverable kinds", async () => {
    const card = await open();
    expect(within(card).getByLabelText("Air version")).toBeTruthy();
    expect(within(card).queryByLabelText("Air revision id")).toBeNull();
    const kinds = within(screen.getByLabelText("Deliverable kind")).getAllByRole("option").map((o) => o.textContent);
    expect(kinds).toEqual(["Video", "Image", "Design", "Document", "Other"]);
  });

  it("preselects the client from ?client= and ignores an unknown one", async () => {
    const { unmount } = renderPage("/builder/deliverables?client=glow");
    await screen.findByRole("option", { name: "Glow Drip" });
    expect((screen.getByLabelText("Client") as HTMLSelectElement).value).toBe("glow");
    expect(await screen.findByRole("option", { name: "Cycle 1 (Active)" })).toBeTruthy();
    unmount();
    renderPage("/builder/deliverables?client=nobody");
    await screen.findByRole("option", { name: "Glow Drip" });
    await waitFor(() => expect((screen.getByLabelText("Client") as HTMLSelectElement).value).toBe(""));
  });

  it("adds a deliverable to the engagement", async () => {
    rpc.mockResolvedValue({ data: "d3", error: null });
    await open();
    fireEvent.change(screen.getByLabelText("Deliverable title"), { target: { value: " UGC cut " } });
    fireEvent.change(screen.getByLabelText("Deliverable kind"), { target: { value: "video" } });
    fireEvent.click(screen.getByRole("button", { name: "Add deliverable" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("add_engagement_deliverable", { p_engagement_id: "e1", p_title: "UGC cut", p_asset_kind: "video", p_agreed_item: null }));
  });
});

describe("model", () => {
  it("decision and publish rules", () => {
    const [video, stat] = toDeliverables([VIDEO, STATIC]);
    expect(roundsUsed(video)).toBe(1);
    expect(canRecordDecision(video)).toBe(true);
    expect(canRecordDecision({ ...video, stage: "client_approved" })).toBe(false);
    expect(stat.exceptions[0].id).toBe("ex1");
    const [idea] = toSubjects([IDEA]);
    expect(canPublish(idea)).toBe(true);
    expect(canDecideApproval(idea)).toBe(true);
    expect(canDecideApproval({ ...idea, decisions: [{ version: 1, decision: "approved", channel: "call", source_note: "x" }] })).toBe(false);
    expect(canPublish({ ...idea, current_version: 1 })).toBe(false);
  });

  it("errorText maps database codes", () => {
    expect(errorText("40001", "x")).toMatch(/changed since/);
    expect(errorText("23514", "x")).toMatch(/https/);
    expect(errorText("99999", "fallback")).toBe("fallback");
  });
});
