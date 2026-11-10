// Operating costs model (consolidation step 4d, port of the Goodo OS owner page
// src/pages/staff/OperatingCosts.tsx and backend/services/operatingCosts.ts). Builder only:
// the four tables have builder-only row rules (migration 20261111000003). The rules here
// mirror the checked database functions; the database stays the authority.

export const CATEGORIES = [
  { value: "worker_compute", label: "Worker compute" },
  { value: "database", label: "Database" },
  { value: "frontend_hosting", label: "Frontend hosting" },
  { value: "monitoring", label: "Monitoring" },
  { value: "model_provider", label: "Model provider" },
  { value: "other", label: "Other" },
] as const;
export type Category = (typeof CATEGORIES)[number]["value"];

export const BASES = [
  { value: "proposed", label: "Proposed (an estimate)" },
  { value: "quoted", label: "Quoted" },
  { value: "invoiced", label: "Invoiced" },
] as const;
export type Basis = (typeof BASES)[number]["value"];

export const ENTRY_KEY = /^[a-z0-9][a-z0-9_-]{1,79}$/;
export const ALERT_SELECT = "*, durable_jobs!operating_budget_alerts_job_id_fkey(state)";

export interface CostEntry {
  entry_key: string;
  label: string;
  category: Category;
  monthly_usd: number | string;
  basis: Basis;
  source_reference: string;
  active: boolean;
  version: number;
  updated_at: string;
}

export interface Budget {
  budget_key: "total";
  monthly_limit_usd: number | string;
  warning_usd: number | string;
  version: number;
  updated_at: string;
}

export interface BudgetAlert {
  id: string;
  budget_key: string;
  period_month: string;
  level: "warning" | "limit";
  spend_usd: number | string;
  threshold_usd: number | string;
  monthly_limit_usd: number | string;
  budget_version: number;
  job_id: string | null;
  created_at: string;
  durable_jobs?: { state: string } | null;
}

export interface CostEvent {
  id: number;
  action: "entry_recorded" | "budget_recorded" | "budgets_evaluated";
  target_key: string;
  version: number;
  detail: Record<string, unknown> | null;
  created_at: string;
}

/** Postgres numeric arrives as a string; amounts are whole cents. */
export const amount = (v: number | string | null | undefined): number => Math.round(Number(v ?? 0) * 100) / 100;

export function usd(v: number | string): string {
  return amount(v).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Active fixed entries, counted in full for the month (the Goodo OS rule). */
export function fixedTotal(entries: CostEntry[]): number {
  return amount(entries.filter((e) => e.active).reduce((sum, e) => sum + amount(e.monthly_usd), 0));
}

export type BudgetState = "none" | "within" | "warning" | "over_limit";

export function budgetState(spend: number, budget: Budget | null): BudgetState {
  if (!budget) return "none";
  if (spend >= amount(budget.monthly_limit_usd)) return "over_limit";
  if (spend >= amount(budget.warning_usd)) return "warning";
  return "within";
}

export const BUDGET_STATE_LABEL: Record<BudgetState, string> = {
  none: "No budget recorded",
  within: "Within budget",
  warning: "Past the warning amount",
  over_limit: "At or over the limit",
};

/** A typed amount in dollars with at most two decimals, within the database bounds. */
export function parseUsd(text: string, { min, max, allowZero }: { min: number; max: number; allowZero: boolean }): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n > max || n < min || (!allowZero && n === 0)) return null;
  return n;
}

export interface EntryForm {
  entryKey: string;
  label: string;
  category: Category;
  monthlyUsd: string;
  basis: Basis;
  sourceReference: string;
  active: boolean;
}

export function entryProblem(f: EntryForm): string | null {
  if (!ENTRY_KEY.test(f.entryKey)) return "The key is 2 to 80 lowercase letters, digits, dashes or underscores.";
  if (f.label.trim().length < 3 || f.label.length > 200) return "The label is 3 to 200 characters.";
  if (parseUsd(f.monthlyUsd, { min: 0, max: 100000, allowZero: true }) === null) return "The monthly amount is in dollars with at most two decimals, up to 100,000.";
  if (f.sourceReference.trim().length < 3 || f.sourceReference.length > 500) return "Say where the figure comes from (3 to 500 characters).";
  return null;
}

export function budgetProblem(limit: string, warning: string): string | null {
  const l = parseUsd(limit, { min: 0.01, max: 100000, allowZero: false });
  const w = parseUsd(warning, { min: 0.01, max: 100000, allowZero: false });
  if (l === null || w === null) return "Both amounts are in dollars with at most two decimals, above zero.";
  if (w >= l) return "The warning amount must be below the limit, so the warning comes first.";
  return null;
}

export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "40001":
      return "This changed since you opened it. Reload and try again.";
    case "42501":
      return "Only a builder can change operating costs.";
    case "22023":
      return "Check the fields: a value is missing, out of range or the warning is not below the limit.";
    default:
      return fallback;
  }
}

const ALERT_JOB_LABEL: Record<string, string> = {
  queued: "owner alert queued",
  leased: "owner alert sending",
  delivered: "owner alert delivered",
  recovery: "owner alert needs recovery",
  canceled: "owner alert canceled",
  resolved_manually: "owner alert resolved by hand",
};

export function alertDelivery(a: BudgetAlert): string {
  if (!a.job_id) return "no owner alert queued (no confirmed owner alert channel)";
  return ALERT_JOB_LABEL[a.durable_jobs?.state ?? ""] ?? "owner alert queued";
}

export function categoryLabel(c: string): string {
  return CATEGORIES.find((x) => x.value === c)?.label ?? c;
}

export function basisLabel(b: string): string {
  return BASES.find((x) => x.value === b)?.label ?? b;
}

export function eventText(e: CostEvent): string {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  if (e.action === "entry_recorded") return `Recorded ${e.target_key} version ${e.version}: ${usd(d.monthly_usd as number)} a month${d.active === false ? " (inactive)" : ""}`;
  if (e.action === "budget_recorded") return `Budget version ${e.version}: limit ${usd(d.monthly_limit_usd as number)}, warning ${usd(d.warning_usd as number)}`;
  return `Checked ${e.target_key}: fixed costs ${usd(d.fixed_usd as number)}, ${Number(d.created ?? 0)} new alert${Number(d.created ?? 0) === 1 ? "" : "s"}`;
}

export const MODEL_SPEND_NOTE =
  "Model spend is not measured: meeting recaps and agent evaluations do not record token usage yet, so the budget covers the fixed costs above. Check the model provider's usage console for model charges.";
