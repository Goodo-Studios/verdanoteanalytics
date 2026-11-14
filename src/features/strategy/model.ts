// Strategy proposals model (consolidation step 4c, port of the Goodo OS staff page
// StrategyProposals.tsx). Rows come from strategy_proposals with their versions,
// reviews, acceptances and publications (staff-only row rules, migration
// 20261110200001). The rules here mirror the checked database functions so the page
// only offers actions the database will accept; the database stays the authority.

export interface ProposalVersion {
  version: number;
  source_subject_id: string;
  source_version: number;
  title: string;
  summary: string;
  brief: string;
  angle: string;
  goal: string;
  required_inputs: string[];
  created_by: string;
  created_at: string;
}

export interface ProposalReview {
  id: string;
  version: number;
  decision: "reviewed" | "changes_requested";
  note: string;
  reviewer_id: string;
  created_at: string;
}

export interface VersionMark {
  version: number;
  created_at: string;
}

export interface Proposal {
  id: string;
  engagement_id: string;
  client_slug: string;
  current_version: number;
  created_by: string;
  versions: ProposalVersion[];
  reviews: ProposalReview[];
  acceptances: VersionMark[];
  publications: VersionMark[];
}

export interface SourceSubject {
  id: string;
  subject_kind: "idea" | "shot_list";
  title: string;
  published_version: number | null;
}

export type ProposalState = "proposed" | "changes_requested" | "reviewed" | "accepted" | "published";

export const STATE_LABEL: Record<ProposalState, string> = {
  proposed: "Waiting for a review",
  changes_requested: "Changes requested",
  reviewed: "Reviewed, waiting for acceptance",
  accepted: "Accepted, not published",
  published: "Published as the engagement strategy",
};

export const currentVersion = (p: Proposal) => p.versions.find((v) => v.version === p.current_version);

/** Latest review of one version (newest first). */
export const latestReview = (p: Proposal, version: number) =>
  p.reviews.filter((r) => r.version === version).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

export function proposalState(p: Proposal): ProposalState {
  const v = p.current_version;
  if (p.publications.some((x) => x.version === v)) return "published";
  if (p.acceptances.some((x) => x.version === v)) return "accepted";
  const review = latestReview(p, v);
  if (!review) return "proposed";
  return review.decision === "reviewed" ? "reviewed" : "changes_requested";
}

/** The source is current when the idea or shot list still has that version published. */
export function sourceCurrent(p: Proposal, subjects: SourceSubject[]): boolean {
  const v = currentVersion(p);
  if (!v) return false;
  const s = subjects.find((x) => x.id === v.source_subject_id);
  return !!s && s.published_version === v.source_version;
}

const isAuthor = (p: Proposal, me: string | undefined) => !!me && currentVersion(p)?.created_by === me;

export const canReview = (p: Proposal, me: string | undefined) => {
  const s = proposalState(p);
  return !!me && !isAuthor(p, me) && (s === "proposed" || s === "changes_requested" || s === "reviewed");
};
export const canAccept = (p: Proposal, me: string | undefined) => !!me && !isAuthor(p, me) && proposalState(p) === "reviewed";
export const canPublish = (p: Proposal) => proposalState(p) === "accepted";
export const canRevise = (p: Proposal) => {
  const s = proposalState(p);
  return s !== "accepted" && s !== "published";
};

/** Required inputs, one per line. */
export function parseInputs(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "40001":
      return "This changed since you opened it, or the idea or shot list it is based on has a newer published version. Reload and try again.";
    case "42501":
      return "You are not allowed to do that here. The author of a version does not review or accept it.";
    case "22023":
      return "Not allowed yet: acceptance needs a review, publication needs acceptance, and an accepted version is not revised. Inputs need one entry per line.";
    case "23514":
      return "Check the fields: none can be empty.";
    case "P0002":
      return "That idea or shot list is not on this engagement.";
    default:
      return fallback;
  }
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : []);

export function toProposals(rows: unknown): Proposal[] {
  return asArray<Record<string, unknown>>(rows).map((r) => ({
    id: r.id as string,
    engagement_id: r.engagement_id as string,
    client_slug: r.client_slug as string,
    current_version: r.current_version as number,
    created_by: r.created_by as string,
    versions: asArray<ProposalVersion>(r.strategy_proposal_versions).sort((a, b) => b.version - a.version),
    reviews: asArray<ProposalReview>(r.strategy_proposal_reviews),
    acceptances: asArray<VersionMark>(r.strategy_proposal_acceptances),
    publications: asArray<VersionMark>(r.strategy_proposal_publications),
  }));
}
