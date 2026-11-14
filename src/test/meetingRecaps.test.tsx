/**
 * Meeting recaps (consolidation step 4a, port of the Goodo OS page).
 *
 * - Lists clients, loads the selected client's recaps with items and reviews.
 * - "Prepare recap" calls the meeting-recaps function with the client and the
 *   transcript id, shows its error (for example 503 in staging) or the outcome.
 * - A decision or action is confirmed or rejected with a note, against the item's
 *   hash; a question has no review buttons; a reviewed item shows its decision.
 * - toRecaps and dateLabel shape what the database returns.
 * The client wall for the route is in StaffArea.test.tsx; tables and functions in
 * supabase/tests/meeting_recaps_test.sql and supabase/functions/meeting-recaps.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const insert = vi.fn();
const recapRows: { current: unknown[] } = { current: [] };
const calls: Array<{ table: string; ops: string[] }> = [];

function query(table: string) {
  const entry = { table, ops: [] as string[] };
  calls.push(entry);
  const result = () =>
    table === "clients"
      ? { data: [{ slug: "glow", name: "Glow Drip" }], error: null }
      : { data: recapRows.current, error: null };
  const chain: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok),
    insert: (row: unknown) => insert(table, row),
  };
  for (const op of ["select", "eq", "order", "limit"]) {
    chain[op] = (...args: unknown[]) => {
      entry.ops.push(`${op}:${JSON.stringify(args)}`);
      return chain;
    };
  }
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: (table: string) => query(table),
  },
}));

import MeetingRecapsPage from "@/features/meeting-recaps/MeetingRecapsPage";
import { WithClient } from "./clientSelection";
import { dateLabel, reviewable, toRecaps } from "@/features/meeting-recaps/model";

const HASH = "a".repeat(64);
const RECAP = {
  id: "r1",
  client_slug: "glow",
  engagement_id: null,
  transcript_id: "tr_1",
  meeting_started_at: "2026-11-02T15:00:00Z",
  status: "prepared",
  model: "m",
  limitation: "1 excerpt(s) were withheld and never sent to the model.",
  clean_excerpts: 2,
  withheld_excerpts: 1,
  rejected_candidates: 0,
  created_at: "2026-11-02T16:00:00Z",
  meeting_recap_items: [
    { id: "i2", position: 1, kind: "question", summary: "Who approves the script?", citations: [{ excerpt_id: "e2", start: 0, end: 24, quote: "Who approves the script?", speaker: "Pat", started_at: null }], date_status: "not_applicable", date_text: null, date_value: null, missing_information: ["approval_owner"], proposed_action: null, item_hash: HASH, meeting_recap_reviews: [] },
    { id: "i1", position: 0, kind: "action", summary: "Sam sends the brief", citations: [{ excerpt_id: "e1", start: 0, end: 10, quote: "Sam will send the brief by 2026-11-20.", speaker: "Pat", started_at: null }], date_status: "stated", date_text: "2026-11-20", date_value: "2026-11-20", missing_information: [], proposed_action: "set_due_date", item_hash: HASH, meeting_recap_reviews: [] },
    { id: "i3", position: 2, kind: "decision", summary: "Three hooks", citations: [{ excerpt_id: "e1", start: 0, end: 5, quote: "We agreed on three hooks.", speaker: null, started_at: null }], date_status: "not_applicable", date_text: null, date_value: null, missing_information: [], proposed_action: null, item_hash: HASH, meeting_recap_reviews: { id: "v1", decision: "confirmed", reviewer_id: "u1", note: "Matches the call", created_at: "x" } },
  ],
};

beforeEach(() => {
  invoke.mockReset();
  insert.mockReset();
  calls.length = 0;
  recapRows.current = [RECAP];
});

async function pickClient() {
  render(
    <WithClient slug="glow" clients={[{ slug: "glow", name: "Glow Drip" }] as never[]}>
      <MeetingRecapsPage />
    </WithClient>,
  );
}

describe("MeetingRecapsPage", () => {
  it("loads the client's recaps with items in order and their quotes", async () => {
    await pickClient();
    expect(await screen.findByText(/Prepared · transcript tr_1/)).toBeTruthy();
    const recapQuery = calls.find((c) => c.table === "meeting_recaps")!;
    expect(recapQuery.ops).toContain('eq:["client_slug","glow"]');
    expect(screen.getByText("1 excerpt(s) were withheld and never sent to the model.")).toBeTruthy();
    const items = screen.getAllByTestId(/^recap-item-/).map((el) => el.getAttribute("data-testid"));
    expect(items).toEqual(["recap-item-i1", "recap-item-i2", "recap-item-i3"]);
    expect(screen.getByText(/"Sam will send the brief by 2026-11-20\." \(Pat\)/)).toBeTruthy();
    expect(screen.getByText("Due 2026-11-20")).toBeTruthy();
    expect(screen.getByText(/Proposed: set the due date \(recorded only, nothing is sent\)/)).toBeTruthy();
    expect(screen.getByText("Not said: approval owner")).toBeTruthy();
    expect(screen.getByText("Questions stay open.")).toBeTruthy();
    expect(screen.getByText("Confirmed: Matches the call")).toBeTruthy();
    // Only the unreviewed action has review buttons.
    expect(screen.getAllByRole("button", { name: "Confirm" })).toHaveLength(1);
  });

  it("records a review with a note against the item hash", async () => {
    insert.mockResolvedValue({ error: null });
    await pickClient();
    await screen.findByText(/Prepared · transcript tr_1/);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a short note");
    expect(insert).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Review note"), { target: { value: "Heard it on the call" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(insert).toHaveBeenCalledWith("meeting_recap_reviews", { item_id: "i1", decision: "confirmed", confirmed_item_hash: HASH, note: "Heard it on the call" }));
  });

  it("explains a review refused because the item changed", async () => {
    insert.mockResolvedValue({ error: { code: "40001", message: "changed" } });
    await pickClient();
    await screen.findByText(/Prepared · transcript tr_1/);
    fireEvent.change(screen.getByLabelText("Review note"), { target: { value: "no" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed since it was shown");
  });

  it("prepares a recap and shows the function's error when it fails closed", async () => {
    const context = new Response(JSON.stringify({ error: "Fireflies is not connected in this environment: FIREFLIES_API_KEY is not set." }), { status: 503 });
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("non-2xx"), { context }) });
    await pickClient();
    const button = screen.getByRole("button", { name: "Prepare recap" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Fireflies transcript id"), { target: { value: " tr_9 " } });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("FIREFLIES_API_KEY is not set");
    expect(invoke).toHaveBeenCalledWith("meeting-recaps", { body: { client_slug: "glow", transcript_id: "tr_9" } });
  });

  it("shows the outcome of a prepared recap", async () => {
    invoke.mockResolvedValue({ data: { recap_id: "r2", status: "prepared", items: 2 }, error: null });
    await pickClient();
    fireEvent.change(screen.getByLabelText("Fireflies transcript id"), { target: { value: "tr_9" } });
    fireEvent.click(screen.getByRole("button", { name: "Prepare recap" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Recap prepared with 2 items.");
  });

  it("says when a client has no recaps", async () => {
    recapRows.current = [];
    await pickClient();
    expect(await screen.findByText("No recaps for this client yet.")).toBeTruthy();
  });
});

describe("MeetingRecapsPage with no client selected", () => {
  it("asks for a client and loads no recaps", () => {
    render(
      <WithClient slug="">
        <MeetingRecapsPage />
      </WithClient>,
    );
    expect(screen.getByText(/Pick a client in the switcher at the top of the page to see/)).toBeTruthy();
    expect(calls.find((c) => c.table === "meeting_recaps")).toBeUndefined();
  });
});

describe("model", () => {
  it("toRecaps sorts items, takes the review from an array or an object, and defaults arrays", () => {
    const [r] = toRecaps([RECAP]);
    expect(r.items.map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
    expect(r.items[2].review?.decision).toBe("confirmed");
    expect(r.items[0].review).toBeNull();
    expect(toRecaps(null)).toEqual([]);
    expect(toRecaps([{ ...RECAP, meeting_recap_items: null }])[0].items).toEqual([]);
  });

  it("dateLabel and reviewable", () => {
    expect(dateLabel({ date_status: "uncertain", date_text: "next week", date_value: null })).toBe('Timing not exact: "next week"');
    expect(dateLabel({ date_status: "missing", date_text: null, date_value: null })).toBe("No due date said");
    expect(dateLabel({ date_status: "not_applicable", date_text: null, date_value: null })).toBeNull();
    expect(reviewable({ kind: "question", review: null })).toBe(false);
    expect(reviewable({ kind: "action", review: null })).toBe(true);
  });
});
