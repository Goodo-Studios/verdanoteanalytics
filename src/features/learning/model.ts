// Learning model (consolidation step 4c, port of the Goodo OS staff pages
// LearningEditor, LearningReview, LearningWithdraw and LearningSelfService). Rows come
// from learning_modules with their versions, reviews and history, and from the weekly
// support tallies and snapshots (staff-only row rules, migration 20261110200005). The
// rules here mirror the checked database functions; the database stays the authority.

export const MODULE_SELECT = [
  "*",
  "learning_module_versions!learning_module_versions_module_id_fkey(*)",
  "learning_reviews!learning_reviews_module_id_fkey(*)",
  "learning_history!learning_history_module_id_fkey(*)",
].join(", ");

export interface LessonVersion {
  version: number;
  summary: string;
  steps: string[];
  checklist: string[];
  source_refs: string[];
  applicability: string[];
  source_clearance: "pending" | "cleared" | "source_blocked";
  client_use_rights: "internal_draft_only" | "client_approved" | "prohibited";
  blocking_gaps: string[];
  assigned_reviewer: string | null;
  authored_by: string;
}

export interface LessonReview {
  id: string;
  version: number;
  action: "accepted" | "approved" | "rejected";
  reviewer_id: string;
  note: string | null;
}

export interface LessonHistory {
  id: string;
  version: number;
  action: "published" | "withdrawn";
  reason: string | null;
  created_at: string;
}

export interface Lesson {
  id: string;
  client_slug: string;
  module_key: string;
  title: string;
  current_version: number;
  published_version: number | null;
  active: boolean;
  versions: LessonVersion[];
  reviews: LessonReview[];
  history: LessonHistory[];
}

export interface SupportWeek {
  week_start: string;
  observation_status: "observed" | "missing" | "unknown";
  recurring_how_to_questions: number;
  data_origin: "synthetic_fixture" | "pilot_observation";
}

export interface Snapshot {
  id: string;
  baseline_start: string;
  baseline_end: string;
  pilot_start: string;
  pilot_end: string;
  baseline_questions: number;
  baseline_weeks_observed: number;
  baseline_weeks_missing: number;
  baseline_rate: number | null;
  pilot_questions: number;
  pilot_weeks_observed: number;
  pilot_weeks_missing: number;
  pilot_rate: number | null;
  comparison: "better" | "same" | "worse" | "missing";
  pilot_status: "complete" | "incomplete";
  data_origin: string;
  usage_note: string;
  created_at: string;
}

export const currentVersion = (l: Lesson) => l.versions.find((v) => v.version === l.current_version);
const reviewsOf = (l: Lesson) => l.reviews.filter((r) => r.version === l.current_version);

export type ReviewStage = "no_reviewer" | "waiting" | "in_review" | "approved" | "rejected";
export function reviewStage(l: Lesson): ReviewStage {
  const v = currentVersion(l);
  if (!v || !v.assigned_reviewer) return "no_reviewer";
  const r = reviewsOf(l);
  if (r.some((x) => x.action === "approved")) return "approved";
  if (r.some((x) => x.action === "rejected")) return "rejected";
  return r.some((x) => x.action === "accepted") ? "in_review" : "waiting";
}

export const STAGE_LABEL: Record<ReviewStage, string> = {
  no_reviewer: "No reviewer assigned",
  waiting: "Waiting for the reviewer to accept it for review",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
};

/** What still blocks publication of the current version (the same checks as the database). */
export function publicationBlockers(l: Lesson): string[] {
  const v = currentVersion(l);
  if (!v) return ["no draft yet"];
  const out: string[] = [];
  if (reviewStage(l) !== "approved") out.push("not approved by the assigned reviewer");
  if (v.source_clearance !== "cleared") out.push("sources not cleared");
  if (v.client_use_rights !== "client_approved") out.push("not approved for client use");
  if (v.blocking_gaps.length) out.push("blocking gaps listed");
  if (!v.steps.length) out.push("no steps");
  if (!v.checklist.length) out.push("no checklist");
  if (!v.applicability.length) out.push("no applicability");
  if (!v.source_refs.length || v.source_refs.some((r) => !r.startsWith("https://"))) out.push("source links must be https");
  if (l.active && l.published_version === l.current_version) out.push("already published");
  return out;
}

export const canAccept = (l: Lesson, me?: string) => !!me && currentVersion(l)?.assigned_reviewer === me && reviewStage(l) === "waiting";
export const canDecide = (l: Lesson, me?: string) => !!me && currentVersion(l)?.assigned_reviewer === me && reviewStage(l) === "in_review";

export const lines = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);

/** Monday of the week that holds the given ISO date. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "40001":
      return "This lesson changed since you opened it. Reload and try again.";
    case "42501":
      return "You are not allowed to do that here. Only the assigned reviewer reviews, and only a builder publishes or withdraws.";
    case "22023":
      return "Not allowed: check the review order, the publication checks, the reviewer, or that a reason is given.";
    case "23505":
      return "That already exists (lesson key or week).";
    case "23514":
      return "Check the fields: the key is lower case with dashes, a week starts on a Monday, text cannot be empty.";
    default:
      return fallback;
  }
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : []);

export function toLessons(rows: unknown): Lesson[] {
  return asArray<Record<string, unknown>>(rows).map((r) => ({
    id: r.id as string,
    client_slug: r.client_slug as string,
    module_key: r.module_key as string,
    title: r.title as string,
    current_version: r.current_version as number,
    published_version: (r.published_version as number | null) ?? null,
    active: !!r.active,
    versions: asArray<LessonVersion>(r.learning_module_versions),
    reviews: asArray<LessonReview>(r.learning_reviews),
    history: asArray<LessonHistory>(r.learning_history).sort((a, b) => b.created_at.localeCompare(a.created_at)),
  }));
}
