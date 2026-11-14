// Agent evaluations model (consolidation step 4c, port of the Goodo OS staff evaluation
// views, US-058). Samples, runs with their per-sample results, the human outcome of a
// run and builder config approvals (staff-only row rules, migration
// 20261110200006). The database decides grounding and the run status; the page only
// shows what it stored.

export const AGENTS = [{ key: "meeting-recaps", label: "Meeting recaps" }] as const;

export const DIMENSIONS = ["grounding", "escalation", "prompt_injection", "permission_isolation", "action_postconditions"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const DIMENSION_LABEL: Record<Dimension, string> = {
  grounding: "Grounding",
  escalation: "Escalation",
  prompt_injection: "Prompt injection",
  permission_isolation: "Permission isolation",
  action_postconditions: "Action postconditions",
};

export type Decision = "allow" | "escalate" | "deny";
export const DECISION_LABEL: Record<Decision, string> = { allow: "Allow", escalate: "Escalate to a person", deny: "Deny" };

export type RunStatus = "passed" | "blocked" | "failed";
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  passed: "Passed",
  blocked: "Blocked",
  failed: "Failed (no results)",
};

export const OUTCOME_LABEL: Record<string, string> = {
  unrecorded: "Business outcome not recorded",
  confirmed: "Business outcome confirmed",
  mixed: "Business outcome mixed",
  not_observed: "Business outcome not observed",
};

// Explicit relationship names keep the embeds unambiguous: runs are also referenced by
// config approvals.
export const RUN_SELECT = [
  "*",
  "agent_evaluation_results!agent_evaluation_results_run_id_fkey(*, agent_evaluation_samples!agent_evaluation_results_sample_id_fkey(sample_key, dimension, prompt))",
  "agent_evaluation_outcomes!agent_evaluation_outcomes_run_id_fkey(*)",
].join(", ");

export interface Sample {
  id: string;
  agent_key: string;
  sample_key: string;
  dimension: Dimension;
  label: "synthetic" | "authorized";
  prompt: string;
  expected_decision: Decision;
  source_provenance: string;
  created_at: string;
}

export interface Result {
  sample_id: string;
  expected_decision: Decision;
  observed_decision: Decision | null;
  quote: string | null;
  grounded: boolean;
  passed: boolean;
  sample: { sample_key: string; dimension: Dimension; prompt: string } | null;
}

export interface Outcome {
  approval_count: number | null;
  approval_total: number | null;
  business_outcome_status: string;
  business_outcome_note: string | null;
  reason: string;
  created_at: string;
}

export interface Run {
  id: string;
  agent_key: string;
  model: string;
  prompt_version: string;
  status: RunStatus;
  total_samples: number;
  passed_samples: number;
  dimensions_covered: string[];
  failures: { sampleKey: string; reason: string }[];
  limitation: string | null;
  created_at: string;
  results: Result[];
  outcome: Outcome | null;
}

export interface Approval {
  id: string;
  agent_key: string;
  model: string;
  prompt_version: string;
  run_id: string;
  created_at: string;
}

type Raw = Record<string, unknown>;
const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : v && typeof v === "object" ? [v as Raw] : []);

export function toRuns(data: unknown): Run[] {
  return list(data).map((r) => {
    const results = list(r.agent_evaluation_results).map((x) => ({
      ...(x as unknown as Omit<Result, "sample">),
      sample: (list(x.agent_evaluation_samples)[0] ?? null) as unknown as Result["sample"],
    }));
    results.sort((a, b) => (a.sample?.sample_key ?? "").localeCompare(b.sample?.sample_key ?? ""));
    const rest: Raw = { ...r };
    delete rest.agent_evaluation_results;
    delete rest.agent_evaluation_outcomes;
    return {
      ...(rest as unknown as Omit<Run, "results" | "outcome">),
      failures: Array.isArray(r.failures) ? (r.failures as Run["failures"]) : [],
      dimensions_covered: Array.isArray(r.dimensions_covered) ? (r.dimensions_covered as string[]) : [],
      results,
      outcome: (list(r.agent_evaluation_outcomes)[0] ?? null) as unknown as Outcome | null,
    };
  });
}

/** Dimensions with no sample yet: a run cannot pass until each has one. */
export function missingDimensions(samples: Pick<Sample, "dimension">[]): Dimension[] {
  const have = new Set(samples.map((s) => s.dimension));
  return DIMENSIONS.filter((d) => !have.has(d));
}

/** A config can be approved only from a passed run that covers all five dimensions. */
export function canApprove(run: Pick<Run, "status" | "dimensions_covered">): boolean {
  return run.status === "passed" && DIMENSIONS.every((d) => run.dimensions_covered.includes(d));
}

/** The approval in force for an agent: the latest one. */
export function currentApproval(approvals: Approval[], agentKey: string): Approval | null {
  return approvals.filter((a) => a.agent_key === agentKey).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

export function resultLine(r: Result): string {
  if (!r.grounded) return "Not grounded: the model's reason was not an exact part of the request, so no decision was kept.";
  const observed = r.observed_decision ? DECISION_LABEL[r.observed_decision] : "None";
  return r.passed ? `${observed}, as expected.` : `${observed}, expected ${DECISION_LABEL[r.expected_decision]}.`;
}

export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "42501":
      return "You are not allowed to do that here. Only a builder approves a configuration.";
    case "22023":
      return "Only a passed run that covers all five dimensions approves a configuration.";
    case "23505":
      return "That already exists: sample keys are unique per agent and a run has one outcome.";
    case "23514":
      return "Check the fields: keys are lower case letters, numbers, dashes or underscores, nothing can be empty, and approvals cannot exceed the total.";
    case "P0002":
      return "That run no longer exists. Reload.";
    default:
      return fallback;
  }
}
