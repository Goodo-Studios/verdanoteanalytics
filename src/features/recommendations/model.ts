// Recommendations model (consolidation step 4c, port of the Goodo OS staff page
// RecommendationOutcomes.tsx). Rows come from recommendations with their decisions,
// execution links, outcomes (with the ad numbers each one read) and learnings
// (staff-only row rules, migration 20261110200003). Outcomes are computed by the
// database from Verdanote's ad metrics; the page never estimates a number.

// Explicit relationship names: the history tables point at the recommendation and at
// each other, so PostgREST needs to be told which link to follow.
export const SELECT = [
  "*",
  "recommendation_decisions!recommendation_decisions_recommendation_id_fkey(*)",
  "recommendation_execution_links!recommendation_execution_links_recommendation_id_fkey(*)",
  "recommendation_outcomes!recommendation_outcomes_recommendation_id_fkey(*, recommendation_outcome_evidence!recommendation_outcome_evidence_outcome_id_fkey(*))",
  "recommendation_learnings!recommendation_learnings_recommendation_id_fkey(*)",
].join(", ");

export type RecState = "proposed" | "accepted" | "rejected" | "deferred";
export type OutcomeStatus = "not_executed" | "insufficient" | "inconclusive" | "measured";

export interface Decision {
  id: string;
  recommendation_version: number;
  decision: "accepted" | "rejected" | "deferred";
  reason: string;
  hypothesis: string | null;
  final_action: string | null;
  evidence: { kind: string; id: string }[];
  created_at: string;
}

export interface ExecutionLink {
  id: string;
  recommendation_version: number;
  ad_ids: string[];
  pipeline_task_id: string | null;
  accountable_owner_id: string;
  review_window_start: string;
  review_window_end: string;
}

export interface OutcomeEvidence {
  ad_id: string;
  account_id: string;
  impressions: number;
  spend: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  metric_days: number;
  account_last_synced_at: string | null;
}

export interface Outcome {
  id: string;
  recommendation_version: number;
  status: OutcomeStatus;
  reason: string;
  evaluated_at: string;
  recommendation_outcome_evidence: OutcomeEvidence[];
}

export interface Learning {
  id: string;
  recommendation_version: number;
  outcome_id: string;
  conclusion: "supported" | "not_supported" | "inconclusive";
  learning: string;
}

export interface Recommendation {
  id: string;
  engagement_id: string;
  client_slug: string;
  category: "creative" | "service";
  title: string;
  proposal: string;
  state: RecState;
  version: number;
  decisions: Decision[];
  links: ExecutionLink[];
  outcomes: Outcome[];
  learnings: Learning[];
}

export const STATE_LABEL: Record<RecState, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
  deferred: "Deferred",
};

export const OUTCOME_LABEL: Record<OutcomeStatus, string> = {
  not_executed: "Not executed",
  insufficient: "Insufficient evidence",
  inconclusive: "Inconclusive",
  measured: "Measured: ready for a person to review",
};

export const REASON_LABEL: Record<string, string> = {
  not_accepted: "not accepted",
  deferred: "deferred",
  no_execution: "no ads linked yet",
  review_window_open: "the review window is still open",
  not_launched: "no linked ad has reported any metrics",
  insufficient_testing: "a linked ad had no impressions in the window",
  stale_evidence: "an ad account last synced before the window closed",
  evidence_complete: "every linked ad ran in the window and the accounts synced since",
};

const newest = <T extends { recommendation_version: number }>(rows: T[]) =>
  rows.slice().sort((a, b) => b.recommendation_version - a.recommendation_version)[0];

export const latestDecision = (r: Recommendation) => newest(r.decisions);
export const latestLink = (r: Recommendation) => newest(r.links);
export const latestOutcome = (r: Recommendation) => newest(r.outcomes);
export const latestLearning = (r: Recommendation) => newest(r.learnings);

export const canDecide = (r: Recommendation) => r.state === "proposed" || r.state === "deferred";
export const canLink = (r: Recommendation) => r.state === "accepted";
/** A learning needs the newest outcome to be measured and newer than any learning. */
export function canLearn(r: Recommendation): boolean {
  const o = latestOutcome(r);
  if (!o || o.status !== "measured") return false;
  const l = latestLearning(r);
  return !l || l.recommendation_version < o.recommendation_version;
}

/** Totals over the ad numbers one outcome read. Shown as stored; nothing is derived beyond sums. */
export function evidenceTotals(rows: OutcomeEvidence[]) {
  return rows.reduce(
    (t, e) => ({
      impressions: t.impressions + Number(e.impressions),
      spend: t.spend + Number(e.spend),
      clicks: t.clicks + Number(e.clicks),
      purchases: t.purchases + Number(e.purchases),
      purchase_value: t.purchase_value + Number(e.purchase_value),
    }),
    { impressions: 0, spend: 0, clicks: 0, purchases: 0, purchase_value: 0 },
  );
}

export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "40001":
      return "This changed since you opened it, or the evidence moved since the outcome was recorded. Reload or evaluate again.";
    case "42501":
      return "You are not allowed to do that here.";
    case "22023":
      return "Not allowed: accepting needs a hypothesis and a final action, ads and evidence must be this client's, and the owner must be staff.";
    case "23514":
      return "Check the fields: none can be empty.";
    default:
      return fallback;
  }
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : []);

export function toRecommendations(rows: unknown): Recommendation[] {
  return asArray<Record<string, unknown>>(rows).map((r) => ({
    id: r.id as string,
    engagement_id: r.engagement_id as string,
    client_slug: r.client_slug as string,
    category: r.category as Recommendation["category"],
    title: r.title as string,
    proposal: r.proposal as string,
    state: r.state as RecState,
    version: r.version as number,
    decisions: asArray<Decision>(r.recommendation_decisions),
    links: asArray<ExecutionLink>(r.recommendation_execution_links),
    outcomes: asArray<Outcome>(r.recommendation_outcomes).map((o) => ({ ...o, recommendation_outcome_evidence: asArray<OutcomeEvidence>(o.recommendation_outcome_evidence) })),
    learnings: asArray<Learning>(r.recommendation_learnings),
  }));
}
