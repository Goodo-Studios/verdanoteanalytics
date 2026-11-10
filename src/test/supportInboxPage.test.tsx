/**
 * Support inbox (consolidation step 4d, port of the Goodo OS staff page). Staff only.
 *
 * - The page opens on open requests, overdue first, and says nothing is sent to the client.
 * - A staff update, resolve and reopen are sent with the revision on screen.
 * - Assigning names a staff member as owner or backup.
 * - Recording a question sends the client, optional engagement, channel, date and owner (me by default).
 * - "Only mine" keeps requests where I am owner or backup; a stale write shows a plain message.
 * - model rules.
 * The database rules are in supabase/tests/support_inbox_test.sql.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const data: Record<string, unknown[]> = {};
const filters: Array<[string, string, unknown]> = [];
const selects: Record<string, string> = {};

function chain(table: string) {
  const q = {
    eq: (c: string, v: unknown) => (filters.push([table, c, v]), q),
    order: () => q,
    limit: () => q,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: data[table] ?? [], error: null }).then(resolve),
  };
  return q;
}

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "me-1" }, isBuilder: false }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      if (name === "handoff_staff_options") {
        return Promise.resolve({ data: [{ user_id: "me-1", display_name: "Mia", email: "m@example.test" }, { user_id: "rae-2", display_name: "Rae", email: "r@example.test" }], error: null });
      }
      return rpc(name, args);
    },
    from: (table: string) => ({ select: (s: string) => ((selects[table] = s), chain(table)) }),
  },
}));

import SupportInboxPage from "@/features/support/SupportInboxPage";
import { isOverdue, newRequestProblem, sortRequests, toRequest, validDate, type RequestRow } from "@/features/support/model";

const req = (over: Partial<RequestRow>): RequestRow => ({
  id: "r1", client_slug: "glow", engagement_id: null, subject: "Launch date", question: "When do ads go live?", channel: "slack", status: "open",
  next_update_target: "2999-01-01", revision: 2, accountable_user_id: "rae-2", backup_user_id: null, created_by: "rae-2",
  created_at: "2026-11-09T10:00:00Z", updated_at: "2026-11-09T10:00:00Z",
  support_history: [
    { id: "h2", event_kind: "response", body: "Told them Thursday", status: "open", revision: 2, actor_id: "rae-2", created_at: "2026-11-09T11:00:00Z" },
    { id: "h1", event_kind: "question", body: "When do ads go live?", status: "open", revision: 1, actor_id: "rae-2", created_at: "2026-11-09T10:00:00Z" },
  ],
  support_assignment_history: [{ id: "a1", assignment_kind: "accountable", assigned_to: "rae-2", revision: 1, assigned_by: "rae-2", created_at: "2026-11-09T10:00:00Z" }],
  ...over,
});

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 3, error: null });
  filters.length = 0;
  data.clients = [{ slug: "glow", name: "Glow Drip" }];
  data.engagements = [{ id: "e1", cycle_number: 1, status: "active" }];
  data.support_requests = [
    req({}),
    req({ id: "r2", subject: "Invoice copy", next_update_target: "2020-01-01", accountable_user_id: "me-1", support_history: [], support_assignment_history: [] }),
  ];
});

describe("SupportInboxPage", () => {
  it("opens on open requests, overdue first, with the no-send note and the history", async () => {
    render(<SupportInboxPage />);
    const items = await screen.findAllByRole("listitem", { name: /Support request/ });
    expect(items.map((i) => i.getAttribute("aria-label"))).toEqual(["Support request Invoice copy", "Support request Launch date"]);
    expect(screen.getByTestId("support-status-r2")).toHaveTextContent("Update overdue");
    expect(screen.getByTestId("support-status-r1")).toHaveTextContent("Open");
    expect(filters).toContainEqual(["support_requests", "status", "open"]);
    expect(selects.support_requests).toMatch(/support_history!support_history_request_id_fkey/);
    expect(screen.getByText(/Nothing here is sent to the client/)).toBeTruthy();
    const launch = items[1];
    expect(within(launch).getByText("Told them Thursday")).toBeTruthy();
    await waitFor(() => expect(within(launch).getByText(/owner Rae/)).toBeTruthy());
    // Dates read as dates, not raw ISO strings, and no internal revision number.
    expect(within(items[0]).getByText(/next update by Jan 1, 2020/)).toBeTruthy();
    expect(items[0].textContent).not.toMatch(/2020-01-01|revision \d/);
  });

  it("records a staff update and a resolution against the revision on screen", async () => {
    render(<SupportInboxPage />);
    const card = await screen.findByRole("listitem", { name: "Support request Launch date" });
    fireEvent.change(within(card).getByLabelText("Update"), { target: { value: "  Ads are live  " } });
    fireEvent.change(within(card).getByLabelText("Next update by"), { target: { value: "2026-11-20" } });
    fireEvent.click(within(card).getByRole("button", { name: "Record staff update" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("record_support_event", { p_request_id: "r1", p_expected_revision: 2, p_event_kind: "response", p_body: "Ads are live", p_next_update_target: "2026-11-20" }),
    );
    fireEvent.click(within(card).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("record_support_event", expect.objectContaining({ p_event_kind: "resolution", p_expected_revision: 2 })));
  });

  it("offers reopen on a resolved request and shows a stale refusal", async () => {
    data.support_requests = [req({ status: "resolved" })];
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "x" } });
    render(<SupportInboxPage />);
    const card = await screen.findByRole("listitem", { name: "Support request Launch date" });
    expect(within(card).queryByRole("button", { name: "Resolve" })).toBeNull();
    fireEvent.change(within(card).getByLabelText("Update"), { target: { value: "Asked again" } });
    fireEvent.click(within(card).getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("record_support_event", expect.objectContaining({ p_event_kind: "reopen", p_next_update_target: null })));
    expect(await within(card).findByRole("alert")).toHaveTextContent(/changed since you opened it/);
  });

  it("assigns a backup", async () => {
    render(<SupportInboxPage />);
    const card = await screen.findByRole("listitem", { name: "Support request Launch date" });
    await within(card).findByRole("option", { name: "Mia" });
    fireEvent.change(within(card).getByLabelText("Role"), { target: { value: "backup" } });
    fireEvent.change(within(card).getByLabelText("Person"), { target: { value: "me-1" } });
    fireEvent.click(within(card).getByRole("button", { name: "Assign" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("assign_support_request", { p_request_id: "r1", p_expected_revision: 2, p_assigned_to: "me-1", p_assignment_kind: "backup" }),
    );
  });

  it("records a new question with me as the default owner", async () => {
    render(<SupportInboxPage />);
    const form = await screen.findByRole("group", { name: "New support request" });
    await within(form).findByRole("option", { name: "Glow Drip" });
    const save = within(form).getByRole("button", { name: "Record question" });
    expect(save).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Client for the request"), { target: { value: "glow" } });
    await within(form).findByRole("option", { name: "Cycle 1 (active)" });
    fireEvent.change(within(form).getByLabelText("Engagement (optional)"), { target: { value: "e1" } });
    fireEvent.change(within(form).getByLabelText("Subject"), { target: { value: " Shoot date " } });
    fireEvent.change(within(form).getByLabelText("Came in by"), { target: { value: "call" } });
    fireEvent.change(within(form).getByLabelText("Client question"), { target: { value: "Can we move the shoot?" } });
    fireEvent.change(within(form).getByLabelText("Next update owed by"), { target: { value: "2026-11-14" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("create_support_request", {
        p_client_slug: "glow", p_engagement_id: "e1", p_subject: "Shoot date", p_question: "Can we move the shoot?", p_channel: "call",
        p_next_update_target: "2026-11-14", p_accountable_user_id: "me-1",
      }),
    );
  });

  it("keeps only my requests when asked", async () => {
    render(<SupportInboxPage />);
    await screen.findAllByRole("listitem", { name: /Support request/ });
    fireEvent.click(screen.getByLabelText(/Only mine/));
    const items = screen.getAllByRole("listitem", { name: /Support request/ });
    expect(items.map((i) => i.getAttribute("aria-label"))).toEqual(["Support request Invoice copy"]);
  });
});

describe("support model", () => {
  it("orders history by revision", () => {
    expect(toRequest(req({})).history.map((h) => h.revision)).toEqual([1, 2]);
  });

  it("flags overdue open requests only", () => {
    expect(isOverdue({ status: "open", next_update_target: "2026-11-09" }, "2026-11-10")).toBe(true);
    expect(isOverdue({ status: "open", next_update_target: "2026-11-10" }, "2026-11-10")).toBe(false);
    expect(isOverdue({ status: "resolved", next_update_target: "2020-01-01" }, "2026-11-10")).toBe(false);
  });

  it("sorts open (overdue, then by date) before resolved", () => {
    const rows = [
      toRequest(req({ id: "res", status: "resolved", updated_at: "2026-11-09T00:00:00Z" })),
      toRequest(req({ id: "later", next_update_target: "2026-12-01" })),
      toRequest(req({ id: "soon", next_update_target: "2026-11-11" })),
      toRequest(req({ id: "late", next_update_target: "2026-11-01" })),
    ];
    expect(sortRequests(rows, "2026-11-10").map((r) => r.id)).toEqual(["late", "soon", "later", "res"]);
  });

  it("checks dates and the new request form", () => {
    expect(validDate("2026-02-29")).toBe(false);
    expect(validDate("2028-02-29")).toBe(true);
    const ok = { clientSlug: "glow", engagementId: "", subject: "S", question: "Q", channel: "call" as const, nextUpdateTarget: "2026-11-14", accountableUserId: "" };
    expect(newRequestProblem(ok)).toBeNull();
    expect(newRequestProblem({ ...ok, clientSlug: "" })).toMatch(/client/);
    expect(newRequestProblem({ ...ok, question: "  " })).toMatch(/question/);
    expect(newRequestProblem({ ...ok, nextUpdateTarget: "soon" })).toMatch(/date/);
  });
});
