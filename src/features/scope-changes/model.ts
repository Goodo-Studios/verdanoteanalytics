// Scope changes model (consolidation step 4c, port of the Goodo OS scope lock and
// scope change requests). Rows come from approval_subjects (shot lists) with their
// scope_locks, and scope_change_requests with their evaluations (staff-only row rules,
// migration 20261110200002). The rules here mirror the checked database functions so
// the page only offers actions the database will accept; the database stays the authority.

export interface ShotList {
  id: string;
  title: string;
  published_version: number | null;
  scope_locks: { version: number; locked_at: string }[];
}

export type EvaluationStatus = "needs_review" | "accepted" | "declined";

export interface Evaluation {
  id: string;
  status: EvaluationStatus;
  rationale: string;
  evaluator_id: string;
  created_at: string;
}

export interface ChangeRequest {
  id: string;
  subject_id: string;
  base_version: number;
  requested_change: string;
  channel: "call" | "slack" | "email";
  source_note: string;
  created_at: string;
  scope_change_evaluations: Evaluation[];
}

export type LockStatus = "not_locked" | "locked" | "awaiting_approval";

/** Highest locked version of a shot list, or null. */
export const lockedVersion = (s: ShotList): number | null =>
  s.scope_locks.length ? Math.max(...s.scope_locks.map((l) => l.version)) : null;

/** Locked at the published version, waiting for the client on a newer one, or never locked. */
export function lockStatus(s: ShotList): LockStatus {
  const locked = lockedVersion(s);
  if (locked === null) return "not_locked";
  return s.published_version !== null && s.published_version > locked ? "awaiting_approval" : "locked";
}

export const LOCK_LABEL: Record<LockStatus, string> = {
  not_locked: "Not locked: the client has not approved a published version",
  locked: "Scope locked",
  awaiting_approval: "Scope locked at an earlier version; a newer version waits for the client",
};

export const STATUS_LABEL: Record<EvaluationStatus | "pending", string> = {
  pending: "Not evaluated yet",
  needs_review: "Needs review",
  accepted: "Accepted",
  declined: "Declined",
};

export const latestEvaluation = (r: ChangeRequest): Evaluation | undefined =>
  r.scope_change_evaluations.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

export const isDecided = (r: ChangeRequest) => r.scope_change_evaluations.some((e) => e.status === "accepted" || e.status === "declined");

export const requestStatus = (r: ChangeRequest): EvaluationStatus | "pending" => {
  const decided = r.scope_change_evaluations.find((e) => e.status === "accepted" || e.status === "declined");
  return decided ? decided.status : latestEvaluation(r)?.status ?? "pending";
};

export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "40001":
      return "The locked version changed since you opened this. Reload and try again.";
    case "42501":
      return "You are not allowed to do that here. Only a builder accepts or declines a scope change.";
    case "22023":
      return "Not allowed: the shot list is not locked yet, the request is already decided, or the engagement is closed.";
    case "23514":
      return "Check the fields: none can be empty.";
    default:
      return fallback;
  }
}
