// Deliverables and approvals model (consolidation step 4b, port of the Goodo OS
// staff page DeliverablesReview.tsx and the exact-version approvals of ideas and
// shot lists). Rows come from engagement_deliverables, its revisions, decisions and
// round exceptions, and approval_subjects with versions and decisions (staff-only
// row rules, migration 20261110120002). The rules here mirror the checked database
// functions so the page only offers actions the database will accept; the database
// stays the authority.

export type Stage = "not_started" | "client_review" | "changes_requested" | "client_approved" | "internal_qa" | "final_ready" | "withdrawn";
export type Channel = "call" | "slack" | "email";
export type Decision = "approved" | "changes_requested";

export interface Revision {
  revision: number;
  review_url: string;
  air_revision_id: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
}

export interface ClientDecision {
  id: string;
  revision: number;
  decision: Decision;
  client_round: number | null;
  channel: Channel;
  source_note: string;
  recorded_by: string;
  created_at: string;
}

export interface RoundException {
  id: string;
  revision: number;
  status: "pending" | "approved" | "denied";
  reason: string;
  decision_reason: string | null;
}

export interface Deliverable {
  id: string;
  engagement_id: string;
  title: string;
  asset_kind: "video" | "image" | "design" | "document" | "other";
  agreed_item: string | null;
  current_revision: number;
  stage: Stage;
  final_download_url: string | null;
  revisions: Revision[];
  decisions: ClientDecision[];
  exceptions: RoundException[];
}

export interface ApprovalVersion {
  version: number;
  state: "draft" | "published" | "superseded";
  body: string;
  published_at: string | null;
}

export interface ApprovalDecision {
  version: number;
  decision: Decision;
  channel: Channel;
  source_note: string;
}

export interface ApprovalSubject {
  id: string;
  engagement_id: string;
  subject_kind: "idea" | "shot_list";
  title: string;
  current_version: number;
  published_version: number | null;
  versions: ApprovalVersion[];
  decisions: ApprovalDecision[];
}

export const STAGE_LABEL: Record<Stage, string> = {
  not_started: "No revision yet",
  client_review: "Waiting for the client",
  changes_requested: "Client asked for changes",
  client_approved: "Client approved",
  internal_qa: "Internal QA",
  final_ready: "Final, ready to send",
  withdrawn: "Withdrawn",
};

export const CHANNEL_LABEL: Record<Channel, string> = { call: "Call", slack: "Slack", email: "Email" };
export const KIND_LABEL: Record<ApprovalSubject["subject_kind"], string> = { idea: "Idea", shot_list: "Shot list" };

export const currentRevision = (d: Deliverable): Revision | undefined => d.revisions.find((r) => r.revision === d.current_revision);
export const decisionFor = (d: Deliverable, revision: number) => d.decisions.find((x) => x.revision === revision);
export const pendingException = (d: Deliverable) => d.exceptions.find((x) => x.status === "pending" && x.revision === d.current_revision);
export const roundsUsed = (d: Deliverable) => d.decisions.filter((x) => x.decision === "changes_requested").length;

/** A decision can be recorded on the current revision while it waits for the client. */
export const canRecordDecision = (d: Deliverable) => d.stage === "client_review" && !decisionFor(d, d.current_revision);
export const canAddRevision = (d: Deliverable) => d.stage !== "final_ready" && d.stage !== "withdrawn";

export const publishedVersion = (s: ApprovalSubject) => s.versions.find((v) => v.version === s.published_version);
export const latestVersion = (s: ApprovalSubject) => s.versions.find((v) => v.version === s.current_version);
export const canPublish = (s: ApprovalSubject) => latestVersion(s)?.state === "draft";
export const canDecideApproval = (s: ApprovalSubject) =>
  s.published_version !== null && !s.decisions.some((d) => d.version === s.published_version);

/** Plain-language message for a database error code from the checked functions. */
export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "40001":
      return "This changed since you opened it (or it is not the current version). Reload and try again.";
    case "42501":
      return "You are not allowed to do that here.";
    case "22023":
      return "That is not allowed now (closed engagement, final or withdrawn deliverable, already decided, or no rounds left).";
    case "23514":
      return "Check the fields: links must start with https:// and text cannot be empty.";
    case "23505":
      return "That is already recorded.";
    default:
      return fallback;
  }
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : []);

export function toDeliverables(rows: unknown): Deliverable[] {
  return asArray<Record<string, unknown>>(rows).map((r) => ({
    ...(r as unknown as Deliverable),
    revisions: asArray<Revision>(r.engagement_deliverable_revisions).sort((a, b) => b.revision - a.revision),
    decisions: asArray<ClientDecision>(r.engagement_deliverable_decisions).sort((a, b) => b.revision - a.revision),
    exceptions: asArray<RoundException>(r.engagement_deliverable_round_exceptions).sort((a, b) => b.revision - a.revision),
  }));
}

export function toSubjects(rows: unknown): ApprovalSubject[] {
  return asArray<Record<string, unknown>>(rows).map((r) => ({
    ...(r as unknown as ApprovalSubject),
    versions: asArray<ApprovalVersion>(r.approval_subject_versions).sort((a, b) => b.version - a.version),
    decisions: asArray<ApprovalDecision>(r.approval_subject_decisions).sort((a, b) => b.version - a.version),
  }));
}
