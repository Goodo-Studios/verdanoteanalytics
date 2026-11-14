// Client invites (OS-021): pure rules for the staff section. The database enforces the same rules
// (migration 20261203080001_os_client_invites.sql); these only shape what the page offers.

export interface InviteClient {
  slug: string;
  name: string;
  status: string | null;
  active: boolean;
}

export interface ExcludedClient {
  client_slug: string;
  name_prefix: string;
}

export interface InviteTemplate {
  subject: string;
  body: string;
  approved_at: string | null;
}

export interface InviteBatch {
  id: string;
  name: string;
  kind: "pilot" | "batch";
  client_slugs: string[];
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
  guest_access_review_after: string | null;
  guest_access_removal_confirmed_at: string | null;
}

export interface ClientInvite {
  id: string;
  batch_id: string;
  client_slug: string;
  email: string;
  display_name: string;
  status: "draft" | "approved" | "sent" | "accepted";
  accepted_at: string | null;
}

export interface PilotStatusRow {
  batch_id: string;
  batch_name: string;
  kind: "pilot" | "batch";
  client_slug: string;
  client_name: string;
  contacts: number;
  sent: number;
  accepted: number;
  client_approval_done: boolean;
  batch_sent_at: string | null;
  guest_access_review_after: string | null;
  guest_access_removal_confirmed_at: string | null;
}

export const PILOT_SIZE = 2;
export const BATCH_MAX = 5;
const ENDING = /(ending|ended|inactive|churn|cancel)/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Why a client cannot be invited, or null. Mirrors os_client_invite_blocked. */
export function blockedReason(c: InviteClient, excluded: ExcludedClient[]): "excluded" | "ending" | null {
  const slug = c.slug.toLowerCase();
  const name = c.name.trim().toLowerCase();
  if (excluded.some((e) => e.client_slug === slug || name.startsWith(e.name_prefix) || slug.startsWith(`${e.name_prefix}-`))) return "excluded";
  if (!c.active || ENDING.test(c.status ?? "")) return "ending";
  return null;
}

export function blockedLabel(reason: "excluded" | "ending"): string {
  return reason === "excluded" ? "not invited (ending client list)" : "ending or inactive";
}

/** What is wrong with a new batch, or null when it can be created. */
export function batchProblem(kind: "pilot" | "batch", name: string, picked: string[]): string | null {
  if (!name.trim()) return "Name the batch.";
  if (kind === "pilot" && picked.length !== PILOT_SIZE) return `A pilot has exactly ${PILOT_SIZE} clients.`;
  if (kind === "batch" && (picked.length < 1 || picked.length > BATCH_MAX)) return `A batch has 1 to ${BATCH_MAX} clients.`;
  return null;
}

export function canPickMore(kind: "pilot" | "batch", picked: string[]): boolean {
  return picked.length < (kind === "pilot" ? PILOT_SIZE : BATCH_MAX);
}

export function contactProblem(email: string, name: string): string | null {
  if (!name.trim()) return "Enter the contact's name.";
  if (!EMAIL.test(email.trim())) return "Enter a valid email address.";
  return null;
}

/** True when the 14-day review date has passed. */
export function reviewDue(reviewAfter: string | null, now: Date): boolean {
  return !!reviewAfter && now.getTime() >= new Date(reviewAfter).getTime();
}

/** Turns a database or function error into plain text. */
export function inviteDbError(e: { code?: string; message?: string } | null | undefined): string {
  if (!e) return "Something went wrong. Try again.";
  if (e.code === "42501") return "Only a builder can do that.";
  return e.message || "Something went wrong. Try again.";
}
