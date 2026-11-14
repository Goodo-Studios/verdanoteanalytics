// QA gates model (consolidation step 4b, port of the Goodo OS staff pages
// QaInbox.tsx and QaGateReview.tsx). Rows come from engagement_deliverables with
// their revisions, QA returns, signoffs and confirmations (staff-only row rules,
// migrations 20261110120002 and 20261110120003). The release rule itself lives in
// the database (deliverable_release_status); the page shows its answer and only
// offers actions the checked functions accept.

export type SignoffKind = "strategist_congruency" | "qa_release";

export interface QaReturn {
  id: string;
  revision: number;
  feedback: string;
  status: "open" | "resolved";
  returned_by: string;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface Signoff {
  id: string;
  revision: number;
  signoff_kind: SignoffKind;
  signed_by: string;
  created_at: string;
}

export interface QaItem {
  id: string;
  title: string;
  stage: string;
  current_revision: number;
  client_slug: string;
  cycle_number: number | null;
  review_url: string | null;
  returns: QaReturn[];
  signoffs: Signoff[];
  confirmed: boolean;
}

export interface ReleaseStatus {
  ready: boolean;
  blockers: string[];
}

/** Stages that belong in the QA inbox: a revision exists and it is not final or withdrawn. */
export const INBOX_STAGES = ["internal_qa", "client_approved", "client_review", "changes_requested"];

export const BLOCKER_LABEL: Record<string, string> = {
  no_revision: "No revision yet",
  withdrawn: "Withdrawn",
  already_final: "Already final",
  client_not_approved: "The client has not approved this revision",
  team_not_confirmed: "The team has not confirmed this revision",
  qa_return_open: "A QA return is open",
  strategist_signoff_missing: "Strategist signoff missing",
  qa_signoff_missing: "QA signoff missing",
  same_person_signed_both: "The same person signed off as strategist and QA",
};

export const SIGNOFF_LABEL: Record<SignoffKind, string> = {
  strategist_congruency: "Strategist (matches the brief)",
  qa_release: "QA (ready to release)",
};

export const blockerText = (code: string) => BLOCKER_LABEL[code] ?? code;

export const openReturns = (item: QaItem) => item.returns.filter((r) => r.status === "open" && r.revision === item.current_revision);

/** Signoffs on the current revision made after its last resolved return (the database rule). */
export function currentSignoffs(item: QaItem): Signoff[] {
  const since = item.returns
    .filter((r) => r.revision === item.current_revision && r.status === "resolved" && r.resolved_at)
    .map((r) => r.resolved_at as string)
    .sort()
    .pop();
  return item.signoffs.filter((s) => s.revision === item.current_revision && (!since || s.created_at > since));
}

/** Whether this person may record this kind of signoff now (mirrors record_deliverable_signoff). */
export function canSignOff(item: QaItem, kind: SignoffKind, me: string | undefined, signoffs: Signoff[]): boolean {
  if (!me || openReturns(item).length) return false;
  return !signoffs.some((s) => s.signed_by === me && s.signoff_kind !== kind);
}

/** Inbox order: internal QA first, then client approved, then the rest; oldest revision number last. */
export function sortInbox(items: QaItem[]): QaItem[] {
  const rank = (stage: string) => INBOX_STAGES.indexOf(stage);
  return items.filter((i) => rank(i.stage) >= 0).sort((a, b) => rank(a.stage) - rank(b.stage) || a.title.localeCompare(b.title));
}

export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "40001":
      return "This changed since you opened it (or it is not the current revision). Reload and try again.";
    case "42501":
      return "You are not allowed to do that here.";
    case "22023":
      return "Not allowed now: an open QA return, the same person signing both, or the gate is not passed.";
    case "23505":
      return "That revision is already confirmed.";
    case "23514":
      return "Check the fields: links must start with https:// and text cannot be empty.";
    default:
      return fallback;
  }
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : []);

export function toQaItems(rows: unknown): QaItem[] {
  return asArray<Record<string, unknown>>(rows).map((r) => {
    const current = r.current_revision as number;
    const revisions = asArray<{ revision: number; review_url: string }>(r.engagement_deliverable_revisions);
    const engagement = asArray<{ client_slug: string; cycle_number: number }>(r.engagements)[0];
    return {
      id: r.id as string,
      title: r.title as string,
      stage: r.stage as string,
      current_revision: current,
      client_slug: (r.client_slug as string) ?? engagement?.client_slug ?? "",
      cycle_number: engagement?.cycle_number ?? null,
      review_url: revisions.find((x) => x.revision === current)?.review_url ?? null,
      returns: asArray<QaReturn>(r.engagement_deliverable_qa_returns).sort((a, b) => b.created_at.localeCompare(a.created_at)),
      signoffs: asArray<Signoff>(r.engagement_deliverable_signoffs).sort((a, b) => b.created_at.localeCompare(a.created_at)),
      confirmed: asArray<{ revision: number }>(r.engagement_deliverable_confirmations).some((c) => c.revision === current),
    };
  });
}
