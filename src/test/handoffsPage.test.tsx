/**
 * Handoffs (consolidation step 4b, port of the Goodo OS HandoffPacket page).
 *
 * - "Waiting for me" lists packets addressed to the signed-in person, with the
 *   brief, required inputs, deliverable snapshot and source status.
 * - The receiver acknowledges or returns the exact revision (a return needs a
 *   reason); others get no answer buttons.
 * - The owner, the creator or a builder reassigns as the next revision.
 * - Creating a packet sends the role, people, due date, brief and inputs.
 * - model rules.
 * The database rules themselves are in supabase/tests/handoffs_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const data: Record<string, unknown[]> = {};
let auth = { user: { id: "editor-1" }, isBuilder: false };
let source = "current";
let published: unknown[] = [];
const STRATEGY = {
  proposal_id: "sp1", version: 2, title: "Routine strategy", summary: "Lead with the routine", brief: "Film three routines",
  angle: "Morning routine", goal: "Lower CPA", required_inputs: ["Raw footage", "Brand fonts"], published_at: "2026-11-10T00:00:00Z",
};
const STAFF = [
  { user_id: "strat-1", display_name: "Sam Strategist", email: "sam@example.test", role: "employee" },
  { user_id: "editor-1", display_name: "Eda Editor", email: "eda@example.test", role: "employee" },
  { user_id: "editor-2", display_name: null, email: "ed2@example.test", role: "employee" },
];

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
      if (name === "handoff_staff_options") return Promise.resolve({ data: STAFF, error: null });
      if (name === "handoff_source_status") return Promise.resolve({ data: source, error: null });
      if (name === "published_strategy_for_engagement") return Promise.resolve({ data: published, error: null });
      return rpc(name, args);
    },
    from: (table: string) => ({ select: () => chain(() => data[table] ?? []) }),
  },
}));

import HandoffsPage from "@/features/handoffs/HandoffsPage";
import { canAcknowledge, canReassign, errorText, parseInputs, staffName, toPackets } from "@/features/handoffs/model";

const PACKET = {
  id: "p1", engagement_id: "e1", client_slug: "glow", current_revision: 1, status: "ready", receiving_role: "editor",
  receiver_id: "editor-1", accountable_owner_id: "strat-1", due_date: "2026-11-20", created_by: "strat-1",
  handoff_packet_versions: [{
    revision: 1, brief: "Cut a 30 second UGC ad", angle: "Morning routine", goal: "Lower CPA", required_inputs: ["Raw footage", "Brand fonts"],
    assets: [{ deliverableId: "d1", title: "UGC cut", revision: 1, stage: "client_review", reviewUrl: "https://air.inc/r/1", finalDownloadUrl: null }],
    receiving_role: "editor", receiver_id: "editor-1", due_date: "2026-11-20", action: "created", reason: null, created_at: "2026-11-10T00:00:00Z",
  }],
  handoff_acknowledgements: [],
};

beforeEach(() => {
  rpc.mockReset();
  data.handoff_packets = [PACKET];
  data.clients = [{ slug: "glow", name: "Glow Drip" }];
  data.engagements = [{ id: "e1", cycle_number: 1, status: "active" }];
  auth = { user: { id: "editor-1" }, isBuilder: false };
  source = "current";
  published = [];
});

async function waitingForMe() {
  render(<HandoffsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Waiting for me" }));
  return screen.findByRole("region", { name: "Handoff to Editor" });
}

describe("HandoffsPage", () => {
  it("shows the packet with brief, inputs, the deliverable snapshot and source status", async () => {
    const card = await waitingForMe();
    expect(within(card).getByRole("heading")).toHaveTextContent("To Eda Editor as Editor · due 2026-11-20");
    expect(await within(card).findByTestId("packet-p1")).toHaveTextContent("Waiting for the receiver · revision 1 · owner Sam Strategist · Deliverables match the packet");
    expect(within(card).getByText("Cut a 30 second UGC ad")).toBeTruthy();
    expect(within(card).getByText("Brand fonts")).toBeTruthy();
    expect(within(card).getByText(/UGC cut, revision 1 \(client review\)/)).toBeTruthy();
    expect(within(card).queryByText("Reassign")).toBeNull(); // the receiver is not the owner
  });

  it("says when the deliverables have moved on", async () => {
    source = "stale";
    const card = await waitingForMe();
    expect(await within(card).findByText(/Deliverables changed since this packet was written/)).toBeTruthy();
  });

  it("the receiver acknowledges the exact revision", async () => {
    rpc.mockResolvedValue({ data: "acknowledged", error: null });
    const card = await waitingForMe();
    fireEvent.click(within(card).getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("acknowledge_handoff", { p_packet_id: "p1", p_expected_revision: 1, p_action: "acknowledged", p_reason: null }));
  });

  it("a return needs a reason before anything is sent", async () => {
    rpc.mockResolvedValue({ data: "returned", error: null });
    const card = await waitingForMe();
    fireEvent.click(within(card).getByRole("button", { name: "Return with reason" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("Say what is missing");
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.change(within(card).getByLabelText("Return reason"), { target: { value: "No brand fonts attached" } });
    fireEvent.click(within(card).getByRole("button", { name: "Return with reason" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("acknowledge_handoff", { p_packet_id: "p1", p_expected_revision: 1, p_action: "returned", p_reason: "No brand fonts attached" }));
  });

  it("the owner reassigns as the next revision and gets no answer buttons", async () => {
    auth = { user: { id: "strat-1" }, isBuilder: false };
    rpc.mockResolvedValue({ data: 2, error: null });
    const card = await waitingForMe();
    expect(within(card).queryByRole("button", { name: "Acknowledge" })).toBeNull();
    fireEvent.click(within(card).getByText("Reassign"));
    fireEvent.change(within(card).getByLabelText("New receiver"), { target: { value: "editor-2" } });
    fireEvent.change(within(card).getByLabelText("Reassign reason"), { target: { value: "Eda is out" } });
    fireEvent.click(within(card).getByRole("button", { name: "Reassign as revision 2" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("reassign_handoff", {
      p_packet_id: "p1", p_expected_revision: 1, p_receiver_id: "editor-2", p_receiving_role: "editor", p_due_date: "2026-11-20", p_reason: "Eda is out",
    }));
  });

  it("creates a packet for an engagement", async () => {
    auth = { user: { id: "strat-1" }, isBuilder: false };
    rpc.mockResolvedValue({ data: "p2", error: null });
    render(<HandoffsPage />);
    await screen.findByRole("option", { name: "Glow Drip" });
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "glow" } });
    await screen.findByRole("option", { name: "Cycle 1 (active)" });
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
    fireEvent.click(await screen.findByText("Create a handoff packet"));
    fireEvent.change(screen.getByLabelText("Receiver"), { target: { value: "editor-1" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-11-22" } });
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Lower CPA" } });
    fireEvent.change(screen.getByLabelText("Angle"), { target: { value: "Routine" } });
    fireEvent.change(screen.getByLabelText("Brief"), { target: { value: "Cut it" } });
    fireEvent.change(screen.getByLabelText("Required inputs"), { target: { value: "Footage\n\n Fonts " } });
    fireEvent.click(screen.getByRole("button", { name: "Create handoff" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("create_handoff_packet", {
      p_engagement_id: "e1", p_receiving_role: "editor", p_receiver_id: "editor-1", p_accountable_owner_id: "strat-1", p_due_date: "2026-11-22",
      p_brief: "Cut it", p_angle: "Routine", p_goal: "Lower CPA", p_required_inputs: ["Footage", "Fonts"],
      p_strategy_proposal_id: null, p_strategy_proposal_version: null,
    }));
  });

  async function openCreate() {
    auth = { user: { id: "strat-1" }, isBuilder: false };
    rpc.mockResolvedValue({ data: "p2", error: null });
    render(<HandoffsPage />);
    await screen.findByRole("option", { name: "Glow Drip" });
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "glow" } });
    await screen.findByRole("option", { name: "Cycle 1 (active)" });
    fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
    fireEvent.click(await screen.findByText("Create a handoff packet"));
  }

  it("prefills from the published strategy, keeps edits and sends the reference", async () => {
    published = [STRATEGY];
    await openCreate();
    expect(await screen.findByTestId("strategy-prefill")).toHaveTextContent('Prefilled from the published strategy proposal "Routine strategy", version 2');
    expect((screen.getByLabelText("Brief") as HTMLTextAreaElement).value).toBe("Film three routines");
    expect((screen.getByLabelText("Required inputs") as HTMLTextAreaElement).value).toBe("Raw footage\nBrand fonts");
    fireEvent.change(screen.getByLabelText("Brief"), { target: { value: "Film three routines, keep it short" } });
    fireEvent.change(screen.getByLabelText("Receiver"), { target: { value: "editor-1" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-11-22" } });
    fireEvent.click(screen.getByRole("button", { name: "Create handoff" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("create_handoff_packet", {
      p_engagement_id: "e1", p_receiving_role: "editor", p_receiver_id: "editor-1", p_accountable_owner_id: "strat-1", p_due_date: "2026-11-22",
      p_brief: "Film three routines, keep it short", p_angle: "Morning routine", p_goal: "Lower CPA", p_required_inputs: ["Raw footage", "Brand fonts"],
      p_strategy_proposal_id: "sp1", p_strategy_proposal_version: 2,
    }));
  });

  it("start blank clears the prefill and drops the reference", async () => {
    published = [STRATEGY];
    await openCreate();
    fireEvent.click(await screen.findByRole("button", { name: "Start blank" }));
    expect(screen.queryByTestId("strategy-prefill")).toBeNull();
    expect((screen.getByLabelText("Brief") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Create handoff" })).toBeDisabled();
  });

  it("shows where a packet brief started", async () => {
    data.handoff_packets = [{ ...PACKET, handoff_packet_versions: [{ ...PACKET.handoff_packet_versions[0], strategy_proposal_id: "sp1", strategy_proposal_version: 2 }] }];
    const card = await waitingForMe();
    expect(within(card).getByText("Brief started from the published strategy proposal, version 2.")).toBeTruthy();
  });
});

describe("model", () => {
  it("answer and reassign rules", () => {
    const [p] = toPackets([PACKET]);
    expect(canAcknowledge(p, "editor-1")).toBe(true);
    expect(canAcknowledge(p, "strat-1")).toBe(false);
    expect(canAcknowledge({ ...p, status: "acknowledged" }, "editor-1")).toBe(false);
    expect(canReassign(p, "strat-1", false)).toBe(true);
    expect(canReassign(p, "editor-2", false)).toBe(false);
    expect(canReassign(p, "editor-2", true)).toBe(true);
  });

  it("names, inputs and error codes", () => {
    expect(staffName(STAFF, "editor-2")).toBe("ed2@example.test");
    expect(staffName(STAFF, "nobody")).toBe("someone");
    expect(parseInputs(" a \n\nb")).toEqual(["a", "b"]);
    expect(errorText("22023", "x")).toMatch(/do not fit that role/);
    expect(errorText("99999", "fallback")).toBe("fallback");
  });
});
