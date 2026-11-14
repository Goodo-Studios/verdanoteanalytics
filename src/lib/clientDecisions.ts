// Rules for the client's approvals and change requests (phase 5b). Pure functions over the rows of
// client_task_decisions that the pages read; nothing here reads or writes data.
//
// A card has at most one current decision (superseded_at null) and any number of earlier ones. A client
// can answer a card in Client Review, change that answer while the card is still there, and approve
// delivered work once. The database enforces this (record_client_decision); the page uses the same rules
// only to decide which buttons to show.
import { format, parseISO } from "date-fns";

export type DecisionKind = "approved" | "changes_requested";

export interface ClientDecision {
  id: string;
  clickup_task_id: string;
  client_slug: string;
  task_name: string | null;
  decision: DecisionKind;
  note: string | null;
  decided_by_label: string;
  decided_at: string;
  superseded_at: string | null;
}

export const MAX_DECISION_NOTE = 1000;
export const REVIEW_STAGE = "Client Review";
export const DELIVERED = "Ready to Launch";

/** Hours a decision counts as new on the staff pages. */
export const NEW_DECISION_HOURS = 48;

export const currentDecision = (decisions: ClientDecision[] | undefined, taskId: string | null | undefined): ClientDecision | null =>
  taskId ? (decisions ?? []).find((d) => d.clickup_task_id === taskId && d.superseded_at === null) ?? null : null;

/** Earlier answers on a card, newest first (the current one is not included). */
export const earlierDecisions = (decisions: ClientDecision[] | undefined, taskId: string | null | undefined): ClientDecision[] =>
  taskId
    ? (decisions ?? [])
        .filter((d) => d.clickup_task_id === taskId && d.superseded_at !== null)
        .sort((a, b) => b.decided_at.localeCompare(a.decided_at))
    : [];

/** Task ids that have a current decision. */
export const decidedTaskIds = (decisions: ClientDecision[] | undefined): Set<string> =>
  new Set((decisions ?? []).filter((d) => d.superseded_at === null).map((d) => d.clickup_task_id));

/** Which buttons a card offers. */
export function decisionOptions(
  stage: string | null | undefined,
  current: ClientDecision | null,
): { approve: boolean; requestChanges: boolean; canChange: boolean } {
  if (stage === REVIEW_STAGE) return { approve: current?.decision !== "approved", requestChanges: true, canChange: current !== null };
  if (stage === DELIVERED && current === null) return { approve: true, requestChanges: false, canChange: false };
  return { approve: false, requestChanges: false, canChange: false };
}

/** Why a note cannot be sent for the given decision, or null when it can. */
export function noteProblem(decision: DecisionKind, note: string): string | null {
  const text = note.trim();
  if (decision === "approved") return null;
  if (!text) return "Please tell us what to change.";
  if (text.length > MAX_DECISION_NOTE) return `Please keep it under ${MAX_DECISION_NOTE} characters.`;
  return null;
}

const day = (iso: string) => format(parseISO(iso), "MMM d");

/** "Alex approved this on Nov 10." for the client's own history line. */
export function decisionLine(d: ClientDecision): string {
  return d.decision === "approved"
    ? `${d.decided_by_label} approved this on ${day(d.decided_at)}.`
    : `${d.decided_by_label} asked for changes on ${day(d.decided_at)}.`;
}

/** Staff wording for one decision. */
export function staffDecisionText(d: Pick<ClientDecision, "decision" | "note" | "decided_by_label">): string {
  return d.decision === "approved" ? `Approved by ${d.decided_by_label}` : `Changes requested by ${d.decided_by_label}: ${d.note ?? ""}`.trim();
}

export function isNewDecision(d: Pick<ClientDecision, "decided_at">, nowMs: number = Date.now()): boolean {
  const t = Date.parse(d.decided_at);
  return Number.isFinite(t) && nowMs - t < NEW_DECISION_HOURS * 3_600_000;
}
