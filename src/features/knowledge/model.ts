// Knowledge pages model (consolidation step 4a, port of the Goodo OS knowledge
// correction and publication pages). Rows come from knowledge_sources,
// knowledge_source_versions, knowledge_corrections and
// knowledge_correction_reviews (staff-only row rules, migration 20261110000003).
// The rules here mirror the checked database functions so the page only offers
// actions the database will accept; the database stays the authority.

export type CorrectionClass = "content" | "procedure" | "permission" | "factual";

export interface SourceVersion {
  id: string;
  version: number;
  body: string;
  kind: "create" | "publish" | "rollback";
  correction_id: string | null;
  rolled_back_to: number | null;
  reason: string | null;
  published_by: string;
  created_at: string;
}

export interface CorrectionReview {
  decision: "accepted" | "rejected" | "conflict";
  reason: string;
  reviewer_id: string;
  created_at: string;
}

export interface Correction {
  id: string;
  source_id: string;
  source_version: number;
  proposed_body: string;
  reason: string;
  classification: CorrectionClass;
  submitted_by: string;
  created_at: string;
  review: CorrectionReview | null;
}

export interface KnowledgeSource {
  id: string;
  title: string;
  namespace: string;
  classification: "client" | "staff";
  release_scope: "global" | "client";
  client_slug: string | null;
  citation_url: string | null;
  current_version: number;
  updated_at: string;
  versions: SourceVersion[];
  corrections: Correction[];
}

export type CorrectionStatus = "open" | "accepted" | "rejected" | "conflict" | "published";

export const CLASS_LABEL: Record<CorrectionClass, string> = {
  content: "Content",
  factual: "Factual",
  procedure: "Procedure",
  permission: "Permission",
};

export const STATUS_LABEL: Record<CorrectionStatus, string> = {
  open: "Waiting for review",
  accepted: "Accepted, not published",
  rejected: "Rejected",
  conflict: "Conflict",
  published: "Published",
};

/** Procedure and permission corrections are decisions only (Goodo OS rule). */
export const publishable = (c: Pick<Correction, "classification">) => c.classification === "content" || c.classification === "factual";

export function correctionStatus(c: Correction, source: Pick<KnowledgeSource, "versions">): CorrectionStatus {
  if (source.versions.some((v) => v.correction_id === c.id)) return "published";
  return c.review?.decision ?? "open";
}

export function canReview(c: Correction, me: string | undefined, isBuilder: boolean): boolean {
  if (!me || c.review || c.submitted_by === me) return false;
  return publishable(c) || isBuilder;
}

export function canPublish(c: Correction, source: KnowledgeSource, isBuilder: boolean): boolean {
  return isBuilder && publishable(c) && correctionStatus(c, source) === "accepted" && source.current_version === c.source_version;
}

export const currentVersion = (s: KnowledgeSource): SourceVersion | undefined => s.versions.find((v) => v.version === s.current_version);

export function versionLabel(v: SourceVersion): string {
  if (v.kind === "create") return `Version ${v.version}: added`;
  if (v.kind === "rollback") return `Version ${v.version}: rolled back to version ${v.rolled_back_to}`;
  return `Version ${v.version}: correction published`;
}

/** Plain-language message for a database error code from the checked functions. */
export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "40001":
      return "The source changed since you opened it. Reload and try again.";
    case "42501":
      return "You are not allowed to do that here.";
    case "23505":
      return "That correction already has a review.";
    case "22023":
      return "That change is not allowed (same text, wrong version, or not publishable).";
    case "23514":
      return "Check the fields: a client-wide source needs a client, and text cannot be empty.";
    default:
      return fallback;
  }
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : []);

/** Shapes the nested select into sources with sorted versions and corrections. */
export function toSources(rows: unknown): KnowledgeSource[] {
  return asArray<Record<string, unknown>>(rows).map((r) => ({
    ...(r as unknown as KnowledgeSource),
    versions: asArray<SourceVersion>(r.knowledge_source_versions).sort((a, b) => b.version - a.version),
    corrections: asArray<Record<string, unknown>>(r.knowledge_corrections)
      .map((c) => ({ ...(c as unknown as Correction), review: asArray<CorrectionReview>(c.knowledge_correction_reviews)[0] ?? null }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  }));
}

export function matchesSearch(s: KnowledgeSource, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const body = currentVersion(s)?.body ?? "";
  return `${s.title} ${s.namespace} ${s.client_slug ?? ""} ${body}`.toLowerCase().includes(q);
}
