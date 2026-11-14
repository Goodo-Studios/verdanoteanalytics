// Input rules of the client-decision function, kept apart so they can be tested without a request.
export const MAX_NOTE_LENGTH = 1000;
export const DECISIONS = ["approved", "changes_requested"] as const;
export type Decision = (typeof DECISIONS)[number];

export interface DecisionInput {
  taskId: string;
  decision: Decision;
  /** Trimmed plain text, 1 to 1000 characters for changes_requested; null for approved. */
  note: string | null;
}

export type DecisionCheck = { ok: true; value: DecisionInput } | { ok: false; error: string };

// ClickUp task ids are short alphanumeric strings ("86bbxq25b"); the demo ones use letters, digits and dashes.
const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function checkDecisionInput(body: unknown): DecisionCheck {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "The request could not be read." };
  const { taskId, decision, note } = body as Record<string, unknown>;
  if (typeof taskId !== "string" || !TASK_ID.test(taskId)) return { ok: false, error: "Which asset is this for?" };
  if (decision !== "approved" && decision !== "changes_requested") return { ok: false, error: "Please choose approve or request changes." };
  if (note !== undefined && note !== null && typeof note !== "string") return { ok: false, error: "The note could not be read." };
  const text = typeof note === "string" ? note.trim() : "";
  if (decision === "changes_requested") {
    if (!text) return { ok: false, error: "Please tell us what to change." };
    if (text.length > MAX_NOTE_LENGTH) return { ok: false, error: `Please keep the note under ${MAX_NOTE_LENGTH} characters.` };
    return { ok: true, value: { taskId, decision, note: text } };
  }
  return { ok: true, value: { taskId, decision, note: null } };
}

/** A plain name for the history line: the part of the email before the @, never the address itself. */
export function decisionLabel(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0].replace(/[._+-]+/g, " ").trim();
  if (!local) return "A team member";
  const name = local.split(" ")[0];
  return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 60) || "A team member";
}
