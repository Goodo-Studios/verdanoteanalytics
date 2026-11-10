// Invite by email (phase 4, PR 2): pure helpers for the Team page's invite form and invite log. The
// data comes from the invite-user function and list_user_invites() (migration 20261112000002).
// Nothing here talks to the network.

export type InviteRole = "employee" | "builder" | "client";

export const INVITE_ROLE_OPTIONS: { value: InviteRole; label: string }[] = [
  { value: "employee", label: "Employee" },
  { value: "builder", label: "Builder" },
  { value: "client", label: "Client login" },
];

export interface InviteForm {
  name: string;
  email: string;
  role: InviteRole;
  clientSlug: string;
}

export const EMPTY_INVITE_FORM: InviteForm = { name: "", email: "", role: "employee", clientSlug: "" };

/** One row of the invite log, as list_user_invites() returns it. */
export interface InviteLogRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  client_slug: string | null;
  status: "sent" | "revoked";
  sent_count: number;
  created_at: string;
  last_sent_at: string;
  invited_by_name: string;
  accepted: boolean;
  login_exists: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function roleText(role: string): string {
  if (role === "builder") return "a builder";
  if (role === "employee") return "an employee";
  if (role === "client") return "a client login";
  return role;
}

/** The first thing wrong with the form, in plain words, or null when it can be reviewed. */
export function inviteFormProblem(form: InviteForm): string | null {
  const name = form.name.trim();
  if (!name) return "Enter the person's name.";
  if (name.length > 120) return "The name is longer than 120 characters.";
  const email = form.email.trim();
  if (!email) return "Enter their email.";
  if (!EMAIL.test(email) || email.length > 320) return "That does not look like an email address.";
  if (form.role === "client" && !form.clientSlug) return "Choose which client this login is for.";
  return null;
}

/** The sentence on the confirmation step. */
export function confirmationText(form: InviteForm, clientName: string | null): string {
  const as = form.role === "client" ? `${roleText(form.role)} for ${clientName ?? form.clientSlug}` : roleText(form.role);
  return `Send invite to ${form.name.trim()} at ${form.email.trim()}? They will get an email with a link to set their own password, and join as ${as}.`;
}

export type InviteState = "waiting" | "accepted" | "revoked" | "login_removed";

export function inviteState(row: Pick<InviteLogRow, "status" | "accepted" | "login_exists">): InviteState {
  if (row.status === "revoked") return "revoked";
  if (row.accepted) return "accepted";
  if (!row.login_exists) return "login_removed";
  return "waiting";
}

export function inviteStateLabel(row: InviteLogRow): string {
  switch (inviteState(row)) {
    case "accepted":
      return "Accepted";
    case "revoked":
      return "Revoked";
    case "login_removed":
      return "Their login was removed";
    default:
      return row.sent_count > 1 ? `Waiting for them (email sent ${row.sent_count} times)` : "Waiting for them (email sent)";
  }
}

/** Resend and revoke apply only while the person has not accepted. */
export function canActOnInvite(row: Pick<InviteLogRow, "status" | "accepted" | "login_exists">): boolean {
  return inviteState(row) === "waiting";
}

/** Plain text from a failed invite-user call. The function writes messages meant to be shown. */
export async function inviteErrorText(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (body && typeof body.error === "string") return body.error;
    } catch {
      // not JSON: fall through
    }
  }
  return fallback;
}

export const INVITE_GENERIC_ERROR = "The invite could not be sent. Try again, and tell a builder if it keeps happening.";

export const INVITE_NOTE =
  "Invite by email creates the login and sends the person a link to set their own password. Use it for staff and for client logins. The older create-with-a-typed-password form stays in Settings > Admin.";
