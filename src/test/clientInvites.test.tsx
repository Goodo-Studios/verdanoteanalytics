/**
 * Client invites (OS-021), the Team page's builder section.
 *
 * - Ending and excluded clients (Cattasaurus, Marek, Miracle, Royo, inactive) are greyed out and
 *   cannot be picked; a pilot takes exactly two clients and a batch at most five.
 * - Approve text is offered only for unsaved, unapproved text; editing says it clears the approval.
 * - Send asks first, calls client-invite once, and shows the dry run when sending is off.
 * - The guest access button is disabled before the 14-day review date and only records.
 * The rules themselves are in supabase/tests/os_client_invites_test.sql and
 * supabase/functions/client-invite/index.test.ts. Nothing is sent: the function call is a mock.
 */
import { acceptConfirm } from "./adminConfirm";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  status: [] as unknown[],
  rpc: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => {
      h.rpc(name, args);
      return Promise.resolve(name === "os_client_invite_pilot_status" ? { data: h.status, error: null } : { data: null, error: null });
    },
    from: (table: string) => ({
      select: () => {
        const result = () => ({ data: h.tables[table] ?? [], error: null });
        const q = {
          order: () => q,
          maybeSingle: () => Promise.resolve(result()),
          then: (r: (v: unknown) => unknown) => Promise.resolve(result()).then(r),
        };
        return q;
      },
    }),
    functions: { invoke: (...args: unknown[]) => h.invoke(...args) },
  },
}));

import { ClientInvitesSection } from "@/features/team/ClientInvitesSection";
import { batchProblem, blockedReason, reviewDue } from "@/features/team/clientInvitesModel";

const EXCLUDED = ["cattasaurus", "marek", "miracle-brand", "royo-bread"].map((s) => ({ client_slug: s, name_prefix: s.split("-")[0] }));
const client = (slug: string, name: string, over: Record<string, unknown> = {}) => ({ slug, name, status: "active", active: true, ...over });
const BATCH = {
  id: "b1", name: "Pilot one", kind: "pilot", client_slugs: ["alpha", "beta"], created_at: "2026-12-01T00:00:00Z",
  approved_at: "2026-12-02T00:00:00Z", sent_at: null, guest_access_review_after: null, guest_access_removal_confirmed_at: null,
};

beforeEach(() => {
  h.tables = {
    os_client_invite_template: { subject: "Hello", body: "Sign in", approved_at: "2026-12-01T00:00:00Z" },
    clients: [
      client("alpha", "Alpha"), client("beta", "Beta"), client("gamma", "Gamma"), client("delta", "Delta"),
      client("eps", "Epsilon"), client("zeta", "Zeta"),
      client("cattasaurus", "Cattasaurus"), client("marek", "Marek Health"), client("miracle-brand", "Miracle Brand"),
      client("royo-bread", "Royo Bread"), client("old", "Old Co", { active: false }), client("leaving", "Leaving", { status: "Ending October" }),
    ],
    os_invite_excluded_clients: EXCLUDED,
    os_client_invite_batches: [],
    os_client_invites: [],
  };
  h.status = [];
  h.rpc.mockReset();
  h.invoke.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the rules", () => {
  it("blocks the ending list by slug or name, and inactive or ending clients", () => {
    expect(blockedReason(client("royo", "Royo"), EXCLUDED)).toBe("excluded");
    expect(blockedReason(client("rb", "Royo Bread Co"), EXCLUDED)).toBe("excluded");
    expect(blockedReason(client("miracle", "Miracle"), EXCLUDED)).toBe("excluded");
    expect(blockedReason(client("x", "X", { active: false }), EXCLUDED)).toBe("ending");
    expect(blockedReason(client("x", "X", { status: "Ending December" }), EXCLUDED)).toBe("ending");
    expect(blockedReason(client("alpha", "Alpha"), EXCLUDED)).toBeNull();
  });
  it("sizes batches", () => {
    expect(batchProblem("pilot", "P", ["a"])).toMatch(/exactly 2/);
    expect(batchProblem("pilot", "P", ["a", "b"])).toBeNull();
    expect(batchProblem("batch", "B", ["a", "b", "c", "d", "e", "f"])).toMatch(/1 to 5/);
    expect(batchProblem("batch", "B", ["a", "b", "c", "d", "e"])).toBeNull();
  });
  it("is due only on or after the review date", () => {
    expect(reviewDue(null, new Date())).toBe(false);
    expect(reviewDue("2026-12-17T00:00:00Z", new Date("2026-12-16T23:59:00Z"))).toBe(false);
    expect(reviewDue("2026-12-17T00:00:00Z", new Date("2026-12-17T00:00:00Z"))).toBe(true);
  });
});

describe("the section", () => {
  it("greys out excluded and ending clients and stops a pilot at two", async () => {
    render(<ClientInvitesSection />);
    const options = await screen.findByRole("list", { name: "Clients" });
    for (const name of ["Cattasaurus", "Marek Health", "Miracle Brand", "Royo Bread", "Old Co", "Leaving"]) {
      expect(within(options).getByRole("checkbox", { name })).toBeDisabled();
    }
    fireEvent.click(within(options).getByRole("checkbox", { name: "Alpha" }));
    fireEvent.click(within(options).getByRole("checkbox", { name: "Beta" }));
    expect(within(options).getByRole("checkbox", { name: "Gamma" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Batch name"), { target: { value: "Pilot one" } });
    fireEvent.click(screen.getByRole("button", { name: "Create pilot" }));
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("os_client_invite_create_batch", { p_name: "Pilot one", p_kind: "pilot", p_client_slugs: ["alpha", "beta"] }));
  });

  it("offers batches of up to five once a pilot exists", async () => {
    h.tables.os_client_invite_batches = [BATCH];
    render(<ClientInvitesSection />);
    const options = await screen.findByRole("list", { name: "Clients" });
    expect(screen.getByRole("radio", { name: /Batch \(up to 5\)/ })).toBeChecked();
    for (const name of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]) fireEvent.click(within(options).getByRole("checkbox", { name }));
    expect(within(options).getByRole("checkbox", { name: "Zeta" })).toBeDisabled();
  });

  it("says editing clears approval and only approves saved text", async () => {
    h.tables.os_client_invite_template = { subject: "Hello", body: "Sign in", approved_at: null };
    render(<ClientInvitesSection />);
    expect(await screen.findByTestId("template-state")).toHaveTextContent("Not approved");
    const approve = screen.getByRole("button", { name: "Approve text" });
    expect(approve).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Email body"), { target: { value: "New body" } });
    expect(screen.getByText("Saving the text clears its approval.")).toBeTruthy();
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save text" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("os_client_invite_save_template", { p_subject: "Hello", p_body: "New body" }));
  });

  it("asks before sending and shows the dry run when sending is off", async () => {
    h.tables.os_client_invite_batches = [BATCH];
    h.tables.os_client_invites = [
      { id: "i1", batch_id: "b1", client_slug: "alpha", email: "ann@staging.verdanote.test", display_name: "Ann", status: "approved", accepted_at: null },
    ];
    h.invoke.mockResolvedValue({ data: { dry_run: true, would_send: [{ email: "ann@staging.verdanote.test", client_slug: "alpha" }], skipped: [] }, error: null });
    render(<ClientInvitesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Send invites" }));
    expect(h.invoke).not.toHaveBeenCalled();
    await acceptConfirm();
    expect(await screen.findByTestId("send-result")).toHaveTextContent("Dry run: sending is switched off. Nothing was sent.");
    expect(screen.getByTestId("send-result")).toHaveTextContent("ann@staging.verdanote.test");
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledWith("client-invite", { body: { action: "send", batch_id: "b1", redirect_origin: window.location.origin } });
  });

  it("does not offer Send until the email text is approved", async () => {
    h.tables.os_client_invite_template = { subject: "Hello", body: "Sign in", approved_at: null };
    h.tables.os_client_invite_batches = [BATCH];
    h.tables.os_client_invites = [
      { id: "i1", batch_id: "b1", client_slug: "alpha", email: "ann@x.test", display_name: "Ann", status: "approved", accepted_at: null },
    ];
    render(<ClientInvitesSection />);
    expect(await screen.findByRole("button", { name: "Send invites" })).toBeDisabled();
  });

  it("shows pilot status and keeps the guest access button disabled before 14 days", async () => {
    const row = {
      batch_id: "b1", batch_name: "Pilot one", kind: "pilot", client_slug: "alpha", client_name: "Alpha", contacts: 1, sent: 1, accepted: 1,
      client_approval_done: true, batch_sent_at: "2026-12-03T00:00:00Z", guest_access_review_after: "2026-12-17T00:00:00Z",
      guest_access_removal_confirmed_at: null,
    };
    h.status = [row, { ...row, client_slug: "beta", client_name: "Beta", accepted: 0, client_approval_done: false }];
    const { unmount } = render(<ClientInvitesSection now={() => new Date("2026-12-10T00:00:00Z")} />);
    const rows = await screen.findAllByTestId("invite-status-row");
    expect(rows[0]).toHaveTextContent("✓ 1 of 1");
    expect(rows[0]).toHaveTextContent("✓ done");
    expect(rows[1]).toHaveTextContent("○ 0 of 1");
    expect(rows[1]).toHaveTextContent("○ not yet");
    const buttons = screen.getAllByRole("button", { name: /Matthew confirms ClickUp guest access can be removed/ });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBeDisabled();
    unmount();

    render(<ClientInvitesSection now={() => new Date("2026-12-18T00:00:00Z")} />);
    const button = await screen.findByRole("button", { name: /Matthew confirms ClickUp guest access can be removed/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await acceptConfirm();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("os_client_invite_confirm_guest_removal", { p_batch_id: "b1" }));
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
