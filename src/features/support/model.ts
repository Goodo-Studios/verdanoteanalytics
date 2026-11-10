// Support inbox model (consolidation step 4d, port of the Goodo OS staff page
// src/pages/staff/SupportInbox.tsx and backend/services/support.ts). Rows come from
// support_requests with their history and assignment history (staff-only row rules,
// migration 20261111000004). The rules here mirror the checked database functions; the
// database stays the authority. Nothing in this area sends anything to a client.

export const REQUEST_SELECT = [
  "*",
  "support_history!support_history_request_id_fkey(*)",
  "support_assignment_history!support_assignment_history_request_id_fkey(*)",
].join(", ");

export const CHANNELS = [
  { value: "call", label: "Call" },
  { value: "slack", label: "Slack" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
] as const;
export type Channel = (typeof CHANNELS)[number]["value"];

export interface HistoryRow {
  id: string;
  event_kind: "question" | "response" | "resolution" | "reopen";
  body: string;
  status: "open" | "resolved";
  revision: number;
  actor_id: string;
  created_at: string;
}

export interface AssignmentRow {
  id: string;
  assignment_kind: "accountable" | "backup";
  assigned_to: string;
  revision: number;
  assigned_by: string;
  created_at: string;
}

export interface RequestRow {
  id: string;
  client_slug: string;
  engagement_id: string | null;
  subject: string;
  question: string;
  channel: Channel;
  status: "open" | "resolved";
  next_update_target: string;
  revision: number;
  accountable_user_id: string;
  backup_user_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  support_history?: HistoryRow[] | null;
  support_assignment_history?: AssignmentRow[] | null;
}

export interface SupportRequest extends Omit<RequestRow, "support_history" | "support_assignment_history"> {
  history: HistoryRow[];
  assignments: AssignmentRow[];
}

export function toRequest(row: RequestRow): SupportRequest {
  const { support_history, support_assignment_history, ...rest } = row;
  return {
    ...rest,
    history: [...(support_history ?? [])].sort((a, b) => a.revision - b.revision),
    assignments: [...(support_assignment_history ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
  };
}

export type StatusFilter = "open" | "resolved" | "all";

/** Today as YYYY-MM-DD in the browser's time zone. */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** An open request whose next update date has passed. */
export function isOverdue(r: Pick<SupportRequest, "status" | "next_update_target">, on: string = today()): boolean {
  return r.status === "open" && r.next_update_target < on;
}

/** Open first (overdue first, then by next update date), then resolved by last change. */
export function sortRequests(rows: SupportRequest[], on: string = today()): SupportRequest[] {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.status === "open") {
      const ao = isOverdue(a, on), bo = isOverdue(b, on);
      if (ao !== bo) return ao ? -1 : 1;
      return a.next_update_target.localeCompare(b.next_update_target);
    }
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export const EVENT_LABEL: Record<HistoryRow["event_kind"], string> = {
  question: "Question",
  response: "Staff update",
  resolution: "Resolved",
  reopen: "Reopened",
};

export function channelLabel(c: string): string {
  return CHANNELS.find((x) => x.value === c)?.label ?? c;
}

export function personLabel(id: string | null, names: Record<string, string>): string {
  if (!id) return "nobody";
  return names[id] ?? "a staff member";
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
}

export interface NewRequestForm {
  clientSlug: string;
  engagementId: string;
  subject: string;
  question: string;
  channel: Channel;
  nextUpdateTarget: string;
  accountableUserId: string;
}

export function newRequestProblem(f: NewRequestForm): string | null {
  if (!f.clientSlug) return "Choose the client.";
  if (!f.subject.trim() || f.subject.length > 240) return "The subject is 1 to 240 characters.";
  if (!f.question.trim() || f.question.length > 4000) return "Write the client's question (up to 4000 characters).";
  if (!validDate(f.nextUpdateTarget)) return "Pick the date the next update is owed.";
  return null;
}

export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "40001":
      return "This request changed since you opened it. Reload and try again.";
    case "42501":
      return "Only staff can work the support inbox.";
    case "22023":
      return "Not allowed: check the fields, the request's status, or that the person is a staff member.";
    case "P0002":
      return "That client or request no longer exists. Reload.";
    default:
      return fallback;
  }
}

export const NO_SEND_NOTE =
  "Nothing here is sent to the client. Reply through your usual channel, then record what you said as a staff update.";
