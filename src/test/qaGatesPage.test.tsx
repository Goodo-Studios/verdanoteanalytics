/**
 * QA gates (consolidation step 4b, port of the Goodo OS QaInbox and QaGateReview
 * pages).
 *
 * - The inbox lists deliverables on their way to release (internal QA first) and
 *   leaves out final, withdrawn and not started ones.
 * - Opening one shows the release gate from deliverable_release_status.
 * - Signoff buttons follow the two-person rule; an open return hides them and
 *   offers resolution; returning a revision sends the exact revision and feedback.
 * - The final link is offered only when the gate is passed.
 * - model rules.
 * The database rules themselves are in supabase/tests/qa_gates_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const data: Record<string, unknown[]> = {};
let auth = { user: { id: "emp-1" }, isBuilder: false };
let gate: { ready: boolean; blockers: string[] } = { ready: false, blockers: [] };

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => (name === "deliverable_release_status" ? Promise.resolve({ data: gate, error: null }) : rpc(name, args)),
    from: (table: string) => ({ select: () => ({ order: () => Promise.resolve({ data: data[table] ?? [], error: null }) }) }),
  },
}));

import QaGatesPage from "@/features/qa-gates/QaGatesPage";
import { canSignOff, currentSignoffs, errorText, sortInbox, toQaItems } from "@/features/qa-gates/model";

const base = {
  client_slug: "glow", engagements: { client_slug: "glow", cycle_number: 1 },
  engagement_deliverable_revisions: [{ revision: 1, review_url: "https://air.inc/r/1" }, { revision: 2, review_url: "https://air.inc/r/2" }],
  engagement_deliverable_qa_returns: [], engagement_deliverable_signoffs: [], engagement_deliverable_confirmations: [],
};
const HERO = {
  ...base, id: "d1", title: "Hero video", stage: "client_approved", current_revision: 2,
  engagement_deliverable_confirmations: [{ revision: 2 }],
  engagement_deliverable_signoffs: [{ id: "s1", revision: 2, signoff_kind: "strategist_congruency", signed_by: "emp-1", created_at: "2026-11-05T00:00:00Z" }],
};
const RETURNED = {
  ...base, id: "d2", title: "Static set", stage: "internal_qa", current_revision: 1,
  engagement_deliverable_qa_returns: [{ id: "r1", revision: 1, feedback: "Logo cut off", status: "open", returned_by: "emp-2", resolution_note: null, resolved_at: null, created_at: "2026-11-05T00:00:00Z" }],
};
const FINAL = { ...base, id: "d3", title: "Done video", stage: "final_ready", current_revision: 1 };
const NEW = { ...base, id: "d4", title: "Not started", stage: "not_started", current_revision: 0 };

beforeEach(() => {
  rpc.mockReset();
  data.engagement_deliverables = [HERO, RETURNED, FINAL, NEW];
  auth = { user: { id: "emp-1" }, isBuilder: false };
  gate = { ready: false, blockers: ["qa_signoff_missing"] };
});

async function openItem(name: RegExp) {
  render(<QaGatesPage />);
  fireEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("region", { name: /Release gate for/ });
}

describe("QaGatesPage", () => {
  it("lists the inbox with internal QA first and leaves out final and not started work", async () => {
    render(<QaGatesPage />);
    const list = await screen.findByRole("list", { name: "QA inbox" });
    await waitFor(() => expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Static set · glow cycle 1 · revision 1 · internal qa · return open",
      "Hero video · glow cycle 1 · revision 2 · client approved",
    ]));
  });

  it("shows what is missing and follows the two-person rule for signoffs", async () => {
    const region = await openItem(/Hero video/);
    expect(await within(region).findByRole("list", { name: "Still missing" })).toHaveTextContent("QA signoff missing");
    // emp-1 signed as strategist, so no QA button for them and no second strategist button.
    expect(within(region).queryByRole("button", { name: /Sign off/ })).toBeNull();
    expect(within(region).queryByRole("button", { name: "Confirm team review" })).toBeNull();
    expect(within(region).queryByLabelText("Final download link")).toBeNull();
  });

  it("another person signs off QA on the exact revision", async () => {
    auth = { user: { id: "emp-2" }, isBuilder: false };
    rpc.mockResolvedValue({ data: "s2", error: null });
    const region = await openItem(/Hero video/);
    fireEvent.click(await within(region).findByRole("button", { name: "Sign off: QA (ready to release)" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("record_deliverable_signoff", { p_deliverable_id: "d1", p_revision: 2, p_signoff_kind: "qa_release" }));
  });

  it("an open return hides signoffs and can be resolved with a note", async () => {
    rpc.mockResolvedValue({ data: "r1", error: null });
    const region = await openItem(/Static set/);
    expect(within(region).queryByRole("button", { name: /Sign off/ })).toBeNull();
    const ret = within(region).getByTestId("return-r1");
    fireEvent.change(within(ret).getByLabelText("Resolution note"), { target: { value: "Logo moved" } });
    fireEvent.click(within(ret).getByRole("button", { name: "Resolve return" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("resolve_deliverable_qa_return", { p_return_id: "r1", p_note: "Logo moved" }));
  });

  it("returns the exact revision to the strategist with feedback", async () => {
    rpc.mockResolvedValue({ data: "r9", error: null });
    const region = await openItem(/Hero video/);
    fireEvent.change(within(region).getByLabelText("Return feedback"), { target: { value: "Music too loud" } });
    fireEvent.click(within(region).getByRole("button", { name: "Return to strategist" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("return_deliverable_to_strategist", { p_deliverable_id: "d1", p_revision: 2, p_feedback: "Music too loud" }));
  });

  it("offers the final link only when the gate is passed, and explains a refusal", async () => {
    gate = { ready: true, blockers: [] };
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "not ready" } });
    const region = await openItem(/Hero video/);
    expect(await within(region).findByRole("status")).toHaveTextContent("Ready to send.");
    fireEvent.change(within(region).getByLabelText("Final download link"), { target: { value: "https://air.inc/final/1" } });
    fireEvent.click(within(region).getByRole("button", { name: "Mark final, ready to send" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("mark_deliverable_final_ready", { p_deliverable_id: "d1", p_revision: 2, p_final_download_url: "https://air.inc/final/1" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("the gate is not passed");
  });
});

describe("model", () => {
  it("signoffs after the last resolved return, and the two-person rule", () => {
    const [hero] = toQaItems([HERO]);
    expect(currentSignoffs(hero)).toHaveLength(1);
    const resolved = { ...hero, returns: [{ id: "r", revision: 2, feedback: "x", status: "resolved" as const, returned_by: "e", resolution_note: "y", resolved_at: "2026-11-06T00:00:00Z", created_at: "2026-11-04T00:00:00Z" }] };
    expect(currentSignoffs(resolved)).toHaveLength(0);
    expect(canSignOff(hero, "qa_release", "emp-1", currentSignoffs(hero))).toBe(false);
    expect(canSignOff(hero, "qa_release", "emp-2", currentSignoffs(hero))).toBe(true);
    expect(canSignOff(hero, "qa_release", undefined, [])).toBe(false);
  });

  it("sorts the inbox and drops stages outside it", () => {
    expect(sortInbox(toQaItems([HERO, RETURNED, FINAL, NEW])).map((i) => i.id)).toEqual(["d2", "d1"]);
  });

  it("errorText maps database codes", () => {
    expect(errorText("23505", "x")).toMatch(/already confirmed/);
    expect(errorText("99999", "fallback")).toBe("fallback");
  });
});
