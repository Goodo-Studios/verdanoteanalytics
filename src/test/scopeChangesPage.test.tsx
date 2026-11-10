/**
 * Scope changes (consolidation step 4c, port of the Goodo OS scope lock and change requests).
 *
 * - A shot list shows whether its scope is locked, and at which version.
 * - A change request is recorded against the locked version with its channel.
 * - Staff mark "needs review" with a rationale; only a builder sees accept and decline.
 * - A decided request offers no more buttons.
 * - model rules.
 * The database rules themselves are in supabase/tests/scope_changes_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    rpc: (name: string, args: unknown) => rpc(name, args),
    from: (table: string) => ({ select: () => chain(() => data[table] ?? []) }),
  },
}));

import ScopeChangesPage from "@/features/scope-changes/ScopeChangesPage";
import { isDecided, lockStatus, lockedVersion, requestStatus } from "@/features/scope-changes/model";

const SHOT_LIST = { id: "s1", title: "Kitchen shot list", published_version: 2, scope_locks: [{ version: 2, locked_at: "2026-11-10T00:00:00Z" }] };
const REQUEST = {
  id: "r1", subject_id: "s1", base_version: 2, requested_change: "Add a car shot", channel: "call", source_note: "Idea pitch call",
  created_at: "2026-11-10T01:00:00Z", scope_change_evaluations: [],
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: "ok", error: null });
  data.clients = [{ slug: "glow", name: "Glow Drip" }];
  data.engagements = [{ id: "e1", cycle_number: 1, status: "active" }];
  data.approval_subjects = [SHOT_LIST];
  data.scope_change_requests = [REQUEST];
  auth = { user: { id: "emp-1" }, isBuilder: false };
});

async function open() {
  render(<ScopeChangesPage />);
  await screen.findByRole("option", { name: "Glow Drip" });
  fireEvent.change(screen.getByLabelText("Client"), { target: { value: "glow" } });
  await screen.findByRole("option", { name: "Cycle 1 (active)" });
  fireEvent.change(screen.getByLabelText("Engagement"), { target: { value: "e1" } });
  return screen.findByRole("region", { name: "Shot list Kitchen shot list" });
}

describe("ScopeChangesPage", () => {
  it("shows the lock and the requests", async () => {
    const card = await open();
    expect(within(card).getByTestId("lock-s1")).toHaveTextContent("Scope locked · locked version 2 · published version 2");
    expect(within(card).getByTestId("request-r1")).toHaveTextContent("Not evaluated yet · against version 2 · via call: Idea pitch call");
  });

  it("records a request against the locked version", async () => {
    data.scope_change_requests = [];
    const card = await open();
    fireEvent.click(within(card).getByText("Record a change request"));
    fireEvent.change(within(card).getByLabelText("Requested change"), { target: { value: " Add a bathroom shot " } });
    fireEvent.change(within(card).getByLabelText("Channel"), { target: { value: "slack" } });
    fireEvent.change(within(card).getByLabelText("Source note"), { target: { value: "Client channel thread" } });
    fireEvent.click(within(card).getByRole("button", { name: "Record against version 2" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("request_scope_change", {
      p_subject_id: "s1", p_base_version: 2, p_requested_change: "Add a bathroom shot", p_channel: "slack", p_source_note: "Client channel thread",
    }));
  });

  it("an unlocked shot list takes no requests", async () => {
    data.approval_subjects = [{ ...SHOT_LIST, scope_locks: [] }];
    data.scope_change_requests = [];
    const card = await open();
    expect(within(card).getByTestId("lock-s1")).toHaveTextContent("Not locked");
    expect(within(card).queryByText("Record a change request")).toBeNull();
  });

  it("an employee marks needs review with a rationale and gets no accept or decline", async () => {
    const card = await open();
    const row = within(card).getByRole("listitem", { name: "Scope change Add a car shot" });
    expect(within(row).queryByRole("button", { name: "Accept" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Needs review" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("Write a rationale first");
    fireEvent.change(within(row).getByLabelText("Rationale"), { target: { value: "Check the shoot budget" } });
    fireEvent.click(within(row).getByRole("button", { name: "Needs review" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("evaluate_scope_change", { p_request_id: "r1", p_status: "needs_review", p_rationale: "Check the shoot budget" }));
  });

  it("a builder declines; a decided request offers nothing more", async () => {
    auth = { user: { id: "b-1" }, isBuilder: true };
    const card = await open();
    const row = within(card).getByRole("listitem", { name: "Scope change Add a car shot" });
    fireEvent.change(within(row).getByLabelText("Rationale"), { target: { value: "Next cycle" } });
    fireEvent.click(within(row).getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("evaluate_scope_change", { p_request_id: "r1", p_status: "declined", p_rationale: "Next cycle" }));
  });

  it("shows a refusal in plain words", async () => {
    auth = { user: { id: "b-1" }, isBuilder: true };
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "decided" } });
    const card = await open();
    const row = within(card).getByRole("listitem", { name: "Scope change Add a car shot" });
    fireEvent.change(within(row).getByLabelText("Rationale"), { target: { value: "x" } });
    fireEvent.click(within(row).getByRole("button", { name: "Accept" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("already decided");
  });
});

describe("model", () => {
  it("lock status", () => {
    expect(lockedVersion({ ...SHOT_LIST, scope_locks: [{ version: 1, locked_at: "a" }, { version: 3, locked_at: "b" }] })).toBe(3);
    expect(lockStatus(SHOT_LIST)).toBe("locked");
    expect(lockStatus({ ...SHOT_LIST, published_version: 3 })).toBe("awaiting_approval");
    expect(lockStatus({ ...SHOT_LIST, scope_locks: [] })).toBe("not_locked");
  });

  it("request status prefers the final decision", () => {
    const ev = (status: string, created_at: string) => ({ id: created_at, status, rationale: "r", evaluator_id: "x", created_at });
    const r = { ...REQUEST, scope_change_evaluations: [ev("needs_review", "2026-11-10T02:00:00Z")] } as never;
    expect(requestStatus(r)).toBe("needs_review");
    expect(isDecided(r)).toBe(false);
    const d = { ...REQUEST, scope_change_evaluations: [ev("accepted", "2026-11-10T02:00:00Z"), ev("needs_review", "2026-11-10T01:00:00Z")] } as never;
    expect(requestStatus(d)).toBe("accepted");
    expect(isDecided(d)).toBe(true);
  });
});
