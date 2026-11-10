// Operations model (consolidation step 4d, port of the Goodo OS operator recovery page
// src/pages/staff/Operations.tsx and backend/services/operatorRecovery.ts). Rows come
// from durable_jobs with their job_audit history (staff-only row rules, migration
// 20261109000005). The rules here mirror the checked database functions replay_job,
// resolve_job_manually and cancel_queued_job; the database stays the authority.
//
// Like Goodo OS, the page never reads a job's payload (message text, channel ids) and
// shows only bounded, scalar parts of a receipt.

export const JOB_SELECT = [
  "id, kind, state, client_slug, engagement_id, attempts, max_attempts, available_at, lease_until, fence, send_started_fence, last_error, receipt, created_at, updated_at",
  "job_audit!job_audit_job_id_fkey(id, action, fence, actor, detail, created_at)",
].join(", ");

export const JOB_LIMIT = 100;
export const AUDIT_LIMIT = 20;
export const NOTE_MIN = 10;
export const NOTE_MAX = 2000;
export const REASON_MIN = 10;
export const REASON_MAX = 500;

export type JobState = "queued" | "leased" | "delivered" | "recovery" | "canceled" | "resolved_manually";

export interface AuditRow {
  id: number;
  action: string;
  fence: number;
  actor: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface JobRow {
  id: string;
  kind: string;
  state: JobState;
  client_slug: string | null;
  engagement_id: string | null;
  attempts: number;
  max_attempts: number;
  available_at: string;
  lease_until: string | null;
  fence: number;
  send_started_fence: number | null;
  last_error: string | null;
  receipt: unknown;
  created_at: string;
  updated_at: string;
  job_audit?: AuditRow[] | null;
}

export type NextStep = "replay" | "cancel" | "wait_for_lease" | "retry_scheduled" | "none";

export interface Job extends Omit<JobRow, "job_audit"> {
  history: AuditRow[];
  attempted: boolean;
  nextStep: NextStep;
  /** Replay and manual resolution apply to a job in recovery. */
  canResolve: boolean;
  manualResolution: { outcome: string; note: string; actor: string; at: string } | null;
}

export type StateFilter = "attention" | "queued" | "running" | "finished" | "all";

export const STATE_FILTERS: Array<{ value: StateFilter; label: string; states: JobState[] | null }> = [
  { value: "attention", label: "Needs recovery", states: ["recovery"] },
  { value: "queued", label: "Queued", states: ["queued"] },
  { value: "running", label: "Running", states: ["leased"] },
  { value: "finished", label: "Finished", states: ["delivered", "canceled", "resolved_manually"] },
  { value: "all", label: "All", states: null },
];

export const STATE_LABEL: Record<JobState, string> = {
  queued: "Queued",
  leased: "Running",
  delivered: "Delivered",
  recovery: "Needs recovery",
  canceled: "Canceled",
  resolved_manually: "Resolved by hand",
};

const KIND_LABEL: Record<string, string> = {
  "slack.reminder": "Slack reminder",
  "slack.owner_alert": "Owner alert",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** Audit actions that mean a worker took the job at least once. */
const ATTEMPT_ACTIONS = new Set(["claimed", "send_started", "retry", "recovery", "manual_replay"]);

/** Same rule as cancel_queued_job: never claimed, never replayed, no send started. */
export function wasAttempted(job: Pick<JobRow, "attempts" | "send_started_fence">, history: AuditRow[]): boolean {
  return job.attempts > 0 || job.send_started_fence !== null || history.some((a) => ATTEMPT_ACTIONS.has(a.action));
}

export function nextStepOf(state: JobState, attempted: boolean): NextStep {
  if (state === "recovery") return "replay";
  if (state === "queued") return attempted ? "retry_scheduled" : "cancel";
  if (state === "leased") return "wait_for_lease";
  return "none";
}

export const NEXT_STEP_LABEL: Record<NextStep, string> = {
  replay: "Check the outside service, then replay it or resolve it by hand.",
  cancel: "Waiting to run. It has never been claimed, so it can still be canceled.",
  wait_for_lease: "A worker holds it. Wait for the lease to end.",
  retry_scheduled: "Waiting to run again. It was claimed before, so it cannot be canceled.",
  none: "Nothing to do.",
};

/** System reason strings: one line, bounded. */
export function boundedCause(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const flat = Array.from(value, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? " " : ch;
  }).join("").replace(/ {2,}/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const SCALAR_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const RECEIPT_KEYS = ["status", "provider", "transport", "ok", "ts"] as const;

/** Receipts are provider JSON. Keep an allow-list of short scalar fields only. */
export function boundedReceipt(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of RECEIPT_KEYS) {
    const v = source[key];
    if (typeof v === "boolean") out[key] = String(v);
    else if (typeof v === "string" && SCALAR_ID.test(v)) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function toJob(row: JobRow): Job {
  const { job_audit, ...rest } = row;
  const history = [...(job_audit ?? [])].sort((a, b) => b.id - a.id);
  const attempted = wasAttempted(row, history);
  const resolution = history.find((a) => a.action === "resolved_manually");
  const detail = (resolution?.detail ?? {}) as Record<string, unknown>;
  return {
    ...rest,
    history: history.slice(0, AUDIT_LIMIT),
    attempted,
    nextStep: nextStepOf(row.state, attempted),
    canResolve: row.state === "recovery",
    manualResolution:
      row.state === "resolved_manually" && resolution
        ? {
            outcome: typeof detail.outcome === "string" ? detail.outcome : "unknown",
            note: typeof detail.note === "string" ? detail.note.slice(0, NOTE_MAX) : "",
            actor: resolution.actor,
            at: resolution.created_at,
          }
        : null,
  };
}

const ACTION_LABEL: Record<string, string> = {
  enqueued: "Queued",
  claimed: "Claimed by a worker",
  send_started: "Outside send started",
  delivered: "Delivered",
  retry: "Failed, will retry",
  recovery: "Moved to recovery",
  canceled: "Canceled by the system",
  manual_cancel: "Canceled by staff",
  manual_replay: "Replayed by staff",
  resolved_manually: "Resolved by hand",
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/** The one-line detail shown next to an audit row: a reason, error, outcome or note. */
export function auditDetail(row: AuditRow): string | null {
  const d = (row.detail ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof d.outcome === "string") parts.push(d.outcome === "effect_confirmed" ? "Effect confirmed" : d.outcome === "abandoned" ? "Abandoned" : d.outcome);
  for (const key of ["note", "reason", "error"] as const) {
    const v = boundedCause(d[key], 300);
    if (v) parts.push(v);
  }
  return parts.length ? parts.join(" · ") : null;
}

export const OUTCOME_LABEL: Record<string, string> = {
  effect_confirmed: "The effect happened (confirmed by hand)",
  abandoned: "Abandoned, the effect did not happen and will not be retried",
};

export function noteError(note: string): string | null {
  const n = note.trim().length;
  if (n < NOTE_MIN) return `Write at least ${NOTE_MIN} characters about what you checked.`;
  if (n > NOTE_MAX) return `Keep the note under ${NOTE_MAX} characters.`;
  return null;
}

export function reasonError(reason: string): string | null {
  const n = reason.trim().length;
  if (n < REASON_MIN) return `Write at least ${REASON_MIN} characters on why it is canceled.`;
  if (n > REASON_MAX) return `Keep the reason under ${REASON_MAX} characters.`;
  return null;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  return new Date(t).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "42501":
      return "You are not allowed to do that here. Only staff act on jobs.";
    case "55000":
      return "The job changed since you opened this (it was claimed, replayed or is no longer in recovery). Reload and check again.";
    case "22023":
      return "Check the fields: the reason or note is too short or too long, or the outcome is missing.";
    case "P0002":
      return "That job no longer exists. Reload the list.";
    default:
      return fallback;
  }
}

/** Who did it: a staff name when the actor is a staff login, otherwise the worker. */
export function actorLabel(actor: string, names: Record<string, string>): string {
  if (names[actor]) return names[actor];
  if (actor === "service") return "System";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(actor)) return "A staff member";
  return `Worker ${actor}`;
}
