/**
 * Invite by email (phase 4 PR 2), the Team page's invite form and invite log.
 *
 * - The form asks for name, email, role and (client logins) the client, says what is missing, and
 *   puts a confirmation step ("Send invite to name at email?") before anything is sent.
 * - Sending calls the invite-user function once; the plain message of a refusal (already has a login,
 *   already invited, email service limiting) is shown and nothing else is claimed.
 * - The log shows waiting, accepted, revoked and removed-login states; resend and revoke only for a
 *   waiting invite, revoke after a confirm.
 * - A prepared invite fills the form and is closed once the real invite is sent.
 * - Empty and error states of the log.
 * The function's own rules are in supabase/functions/invite-user/index.test.ts and the database
 * rules in supabase/tests/user_invites_test.sql. No invite is sent: the function call is a mock.
 */
import { acceptConfirm, confirmDialogText, declineConfirm } from "./adminConfirm";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invites: { data: [] as unknown, error: null as null | { code?: string; message: string } },
  clients: [] as unknown[],
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) => Promise.resolve(name === "list_user_invites" ? h.invites : { data: null, error: null }),
    from: () => ({
      select: () => {
        const q = { order: () => q, then: (r: (v: unknown) => unknown) => Promise.resolve({ data: h.clients, error: null }).then(r) };
        return q;
      },
    }),
    functions: { invoke: (...args: unknown[]) => h.invoke(...args) },
  },
}));

import { InviteSection } from "@/features/team/InviteSection";
import {
  canActOnInvite,
  confirmationText,
  inviteErrorText,
  inviteFormProblem,
  inviteState,
  inviteStateLabel,
  type InviteLogRow,
} from "@/features/team/inviteModel";

const log = (over: Partial<InviteLogRow> = {}): InviteLogRow => ({
  id: "i1", email: "pat@example.test", display_name: "Pat Lee", role: "employee", client_slug: null, status: "sent", sent_count: 1,
  created_at: "2026-11-01T09:00:00Z", last_sent_at: "2026-11-01T09:00:00Z", invited_by_name: "Bea Builder", accepted: false, login_exists: true, ...over,
});

const fill = (name: string, email: string) => {
  fireEvent.change(screen.getByLabelText("Invitee name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Invitee email"), { target: { value: email } });
};

beforeEach(() => {
  h.invites = { data: [], error: null };
  h.clients = [{ slug: "glow", name: "Glow Drip", active: true }, { slug: "old", name: "Old Co", active: false }];
  h.invoke.mockReset();
  h.invoke.mockResolvedValue({ data: { invite: {} }, error: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the form", () => {
  it("says what is missing and only then lets the invite be reviewed", async () => {
    render(<InviteSection prefill={null} onSent={() => {}} />);
    const review = await screen.findByRole("button", { name: "Review invite" });
    expect(review).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Invitee name"), { target: { value: "Pat Lee" } });
    expect(screen.getByText("Enter their email.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Invitee email"), { target: { value: "pat@" } });
    expect(screen.getByText("That does not look like an email address.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Invitee email"), { target: { value: "pat@example.test" } });
    expect(review).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Invitee role"), { target: { value: "client" } });
    expect(screen.getByText("Choose which client this login is for.")).toBeTruthy();
    expect(review).toBeDisabled();
    expect(within(screen.getByLabelText("Invitee client")).queryByRole("option", { name: "Old Co" })).toBeNull();
  });

  it("asks 'Send invite to name at email?' and sends nothing until it is confirmed", async () => {
    render(<InviteSection prefill={null} onSent={() => {}} />);
    await screen.findByRole("button", { name: "Review invite" });
    fill("  Pat Lee ", " pat@example.test ");
    fireEvent.click(screen.getByRole("button", { name: "Review invite" }));
    expect(screen.getByTestId("invite-confirm-text")).toHaveTextContent("Send invite to Pat Lee at pat@example.test? They will get an email with a link to set their own password, and join as an employee.");
    expect(h.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Invitee name")).toHaveValue("  Pat Lee ");
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("sends one invite-user call for a staff invite, then clears the form and tells the builder", async () => {
    const onSent = vi.fn();
    render(<InviteSection prefill={null} onSent={onSent} />);
    await screen.findByRole("button", { name: "Review invite" });
    fill("Pat Lee", "pat@example.test");
    fireEvent.change(screen.getByLabelText("Invitee role"), { target: { value: "builder" } });
    fireEvent.click(screen.getByRole("button", { name: "Review invite" }));
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Invite sent to Pat Lee at pat@example.test.");
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledWith("invite-user", {
      body: { action: "invite", email: "pat@example.test", display_name: "Pat Lee", role: "builder", client_slug: undefined, redirect_origin: window.location.origin },
    });
    expect(onSent).toHaveBeenCalledWith(null);
    expect(screen.getByLabelText("Invitee name")).toHaveValue("");
  });

  it("a client invite names the client in the confirmation and in the call", async () => {
    render(<InviteSection prefill={null} onSent={() => {}} />);
    await screen.findByRole("button", { name: "Review invite" });
    fill("Cam Client", "cam@example.test");
    fireEvent.change(screen.getByLabelText("Invitee role"), { target: { value: "client" } });
    fireEvent.change(screen.getByLabelText("Invitee client"), { target: { value: "glow" } });
    fireEvent.click(screen.getByRole("button", { name: "Review invite" }));
    expect(screen.getByTestId("invite-confirm-text")).toHaveTextContent("join as a client login for Glow Drip");
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(h.invoke).toHaveBeenCalled());
    expect(h.invoke.mock.calls[0][1].body).toMatchObject({ role: "client", client_slug: "glow" });
  });

  it("shows the function's plain refusal, keeps the form, and does not claim it was sent", async () => {
    const onSent = vi.fn();
    const refusal = new Response(JSON.stringify({ error: "pat@example.test already has a login. Nothing was sent.", code: "already_has_login" }), { status: 409 });
    h.invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: refusal }) });
    render(<InviteSection prefill={null} onSent={onSent} />);
    await screen.findByRole("button", { name: "Review invite" });
    fill("Pat Lee", "pat@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Review invite" }));
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("pat@example.test already has a login. Nothing was sent.");
    expect(screen.queryByText(/Invite sent to/)).toBeNull();
    expect(onSent).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Invitee email")).toHaveValue("pat@example.test");
  });

  it("falls back to a plain sentence when the answer has no message", async () => {
    h.invoke.mockResolvedValue({ data: null, error: new Error("network") });
    render(<InviteSection prefill={null} onSent={() => {}} />);
    await screen.findByRole("button", { name: "Review invite" });
    fill("Pat Lee", "pat@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Review invite" }));
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The invite could not be sent.");
  });

  it("a prepared invite fills the form and is handed back to be closed once the real invite is sent", async () => {
    const onSent = vi.fn();
    render(<InviteSection prefill={{ preparedId: "prep-1", name: "Wren Waiting", email: "wren@example.test", role: "employee" }} onSent={onSent} />);
    expect(await screen.findByLabelText("Invitee name")).toHaveValue("Wren Waiting");
    fireEvent.click(screen.getByRole("button", { name: "Review invite" }));
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledWith("prep-1"));
  });
});

describe("the log", () => {
  it("says so when nothing was sent, and says when the list could not load", async () => {
    const { unmount } = render(<InviteSection prefill={null} onSent={() => {}} />);
    expect(await screen.findByText("No invites have been sent yet.")).toBeTruthy();
    unmount();
    h.invites = { data: null, error: { code: "XX000", message: "down" } };
    render(<InviteSection prefill={null} onSent={() => {}} />);
    expect(await screen.findByText("The invite list could not load.")).toBeTruthy();
    expect(screen.queryByText("No invites have been sent yet.")).toBeNull();
  });

  it("shows who invited whom and each invite's state, with resend and revoke only for a waiting one", async () => {
    h.invites = {
      data: [
        log({ id: "w", display_name: "Wren Waiting", email: "wren@example.test", sent_count: 2 }),
        log({ id: "a", display_name: "Avery Accepted", email: "avery@example.test", role: "client", client_slug: "glow", accepted: true }),
        log({ id: "r", display_name: "Rex Revoked", email: "rex@example.test", status: "revoked" }),
        log({ id: "g", display_name: "Gale Gone", email: "gale@example.test", login_exists: false }),
      ],
      error: null,
    };
    render(<InviteSection prefill={null} onSent={() => {}} />);
    const rows = await screen.findAllByTestId("invite-log-row");
    expect(rows.map((r) => within(r).getByTestId("invite-state").textContent)).toEqual([
      "Waiting for them (email sent 2 times)", "Accepted", "Revoked", "Their login was removed",
    ]);
    expect(rows[1]).toHaveTextContent("As a client login for glow · invited by Bea Builder on Nov 1, 2026");
    expect(within(rows[0]).getByRole("button", { name: "Resend the invite to wren@example.test" })).toBeTruthy();
    for (const r of rows.slice(1)) expect(within(r).queryByRole("button")).toBeNull();
  });

  it("resends and tells the builder, and shows the function's message when it is too soon", async () => {
    h.invites = { data: [log()], error: null };
    render(<InviteSection prefill={null} onSent={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Resend the invite to pat@example.test" }));
    expect(await screen.findByRole("status")).toHaveTextContent("The invite email was sent again to pat@example.test.");
    expect(h.invoke).toHaveBeenCalledWith("invite-user", { body: { action: "resend", invite_id: "i1", redirect_origin: window.location.origin } });
    const tooSoon = new Response(JSON.stringify({ error: "That invite was sent a moment ago. Wait a minute before sending it again." }), { status: 429 });
    h.invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("x"), { context: tooSoon }) });
    fireEvent.click(screen.getByRole("button", { name: "Resend the invite to pat@example.test" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wait a minute before sending it again.");
  });

  it("revokes only after a confirm that says the login is removed", async () => {
    h.invites = { data: [log()], error: null };
    render(<InviteSection prefill={null} onSent={() => {}} />);
    const button = await screen.findByRole("button", { name: "Revoke the invite for pat@example.test" });
    fireEvent.click(button);
    await declineConfirm();
    expect(h.invoke).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(await confirmDialogText()).toContain("Their login is removed and the link in their email stops working.");
    await acceptConfirm();
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("invite-user", { body: { action: "revoke", invite_id: "i1", redirect_origin: window.location.origin } }));
  });
});

describe("inviteModel", () => {
  it("checks the form", () => {
    const ok = { name: "Pat", email: "pat@example.test", role: "employee" as const, clientSlug: "" };
    expect(inviteFormProblem(ok)).toBeNull();
    expect(inviteFormProblem({ ...ok, name: "  " })).toBe("Enter the person's name.");
    expect(inviteFormProblem({ ...ok, name: "x".repeat(121) })).toContain("120");
    expect(inviteFormProblem({ ...ok, email: "" })).toBe("Enter their email.");
    expect(inviteFormProblem({ ...ok, email: "a b@c.d" })).toContain("does not look like");
    expect(inviteFormProblem({ ...ok, role: "client" })).toContain("which client");
    expect(inviteFormProblem({ ...ok, role: "client", clientSlug: "glow" })).toBeNull();
  });

  it("words the confirmation and the states", () => {
    expect(confirmationText({ name: "Pat", email: "p@x.test", role: "builder", clientSlug: "" }, null)).toContain("join as a builder.");
    expect(inviteState({ status: "sent", accepted: false, login_exists: true })).toBe("waiting");
    expect(inviteState({ status: "revoked", accepted: true, login_exists: true })).toBe("revoked");
    expect(inviteStateLabel(log({ sent_count: 1 }))).toBe("Waiting for them (email sent)");
    expect(canActOnInvite({ status: "sent", accepted: false, login_exists: true })).toBe(true);
    expect(canActOnInvite({ status: "sent", accepted: true, login_exists: true })).toBe(false);
    expect(canActOnInvite({ status: "sent", accepted: false, login_exists: false })).toBe(false);
  });

  it("reads the message out of a failed call, and falls back", async () => {
    const res = new Response(JSON.stringify({ error: "Plain message." }), { status: 409 });
    expect(await inviteErrorText({ context: res }, "fallback")).toBe("Plain message.");
    expect(await inviteErrorText({ context: new Response("not json", { status: 500 }) }, "fallback")).toBe("fallback");
    expect(await inviteErrorText(new Error("x"), "fallback")).toBe("fallback");
  });
});
