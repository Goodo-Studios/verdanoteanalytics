// Engagements model (consolidation step 4b, port of the Goodo OS staff pages
// EngagementSetup.tsx and CloseoutReview, on the client model from step 3). Rows
// come from engagements and engagement_notes (migration 20261109000004) and from
// engagement_templates, engagement_terms, engagement_milestones and
// engagement_closeouts (staff-only row rules, migration 20261110120001). The rules
// here mirror the checked database functions so the page only offers actions the
// database will accept; the database stays the authority.

export type EngagementType = "standard_sprint" | "retainer" | "custom";
export type EngagementStatus = "planned" | "active" | "closed" | "cancelled";

export interface MilestoneRule {
  key: string;
  requiredEvidence: string[];
  clientVisible: boolean;
}

export interface EngagementTemplate {
  id: string;
  template_key: string;
  version: number;
  client_slug: string | null;
  template_type: EngagementType;
  milestone_template: MilestoneRule[];
  agreed_deliverables: unknown[];
  source_reference: string;
  created_at: string;
}

export interface Milestone {
  milestone_key: string;
  position: number;
  required_evidence: string[];
  client_visible: boolean;
}

export interface Closeout {
  id: string;
  version: number;
  testing_started_at: string | null;
  testing_ended_at: string | null;
  evidence_limit: string;
  delivered_assets: string[];
  supported_conclusions: string[];
  outstanding_actions: string[];
  authored_by: string;
  created_at: string;
}

export interface Terms {
  template_id: string | null;
  agreed_deliverables: unknown[];
  kickoff_recorded_at: string | null;
}

export interface Engagement {
  id: string;
  client_slug: string;
  cycle_number: number;
  engagement_type: EngagementType;
  status: EngagementStatus;
  start_date: string | null;
  day30_date: string | null;
  day45_date: string | null;
  terms: Terms | null;
  purchase_reference: string | null;
  milestones: Milestone[];
  closeouts: Closeout[];
}

export const TYPE_LABEL: Record<EngagementType, string> = {
  standard_sprint: "45-day sprint",
  retainer: "Retainer",
  custom: "Custom",
};

export const STATUS_LABEL: Record<EngagementStatus, string> = {
  planned: "Planned",
  active: "Active",
  closed: "Closed",
  cancelled: "Cancelled",
};

const TOKEN = /^[a-z][a-z0-9_.-]{0,79}$/;
export const TEMPLATE_KEY = /^[a-z][a-z0-9_-]{1,79}$/;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Milestones, one per line: `key` alone (the database adds the evidence: the three
 * release gates for "delivery", a source handoff otherwise), or
 * `key | evidence, evidence | client` (or `internal`).
 */
export function parseMilestoneLines(text: string): Parsed<Array<string | MilestoneRule>> {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, error: "Add at least one milestone." };
  const seen = new Set<string>();
  const out: Array<string | MilestoneRule> = [];
  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    const key = parts[0];
    if (!TOKEN.test(key) || seen.has(key)) return { ok: false, error: `"${key}" is not a valid milestone key, or it appears twice.` };
    seen.add(key);
    if (parts.length === 1) {
      out.push(key);
      continue;
    }
    if (parts.length !== 3 || !["client", "internal"].includes(parts[2])) {
      return { ok: false, error: `Write "${key} | evidence, evidence | client" or "| internal".` };
    }
    const evidence = parts[1].split(",").map((e) => e.trim()).filter(Boolean);
    if (!evidence.length || evidence.some((e) => !TOKEN.test(e)) || new Set(evidence).size !== evidence.length) {
      return { ok: false, error: `The evidence for "${key}" must be distinct lower-case words.` };
    }
    if (key === "delivery" && !["strategist_congruency", "qa_release", "delivery_receipt"].every((g) => evidence.includes(g))) {
      return { ok: false, error: "The delivery milestone keeps strategist_congruency, qa_release and delivery_receipt." };
    }
    out.push({ key, requiredEvidence: evidence, clientVisible: parts[2] === "client" });
  }
  return { ok: true, value: out };
}

export interface AgreedDeliverable {
  name: string;
  quantity?: number;
  clientRevisionRounds?: number;
}

/** Agreed deliverables, one per line: `name | quantity | client revision rounds` (the numbers are optional). */
export function parseDeliverableLines(text: string): Parsed<AgreedDeliverable[]> {
  const out: AgreedDeliverable[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [name, quantity, rounds, ...rest] = line.split("|").map((p) => p.trim());
    const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : /^\d{1,4}$/.test(v) ? Number(v) : NaN);
    const q = num(quantity);
    const r = num(rounds);
    if (!name || name.length > 200 || rest.length || Number.isNaN(q) || Number.isNaN(r)) {
      return { ok: false, error: `Write "${line}" as "name | quantity | revision rounds".` };
    }
    out.push({ name, ...(q !== undefined ? { quantity: q } : {}), ...(r !== undefined ? { clientRevisionRounds: r } : {}) });
  }
  return { ok: true, value: out };
}

/** Latest version of each template key in each scope (all clients, or this client). */
export function latestTemplates(templates: EngagementTemplate[], clientSlug: string | null): EngagementTemplate[] {
  const best = new Map<string, EngagementTemplate>();
  for (const t of templates) {
    if (t.client_slug !== null && t.client_slug !== clientSlug) continue;
    const k = `${t.template_key}|${t.client_slug ?? ""}`;
    const cur = best.get(k);
    if (!cur || t.version > cur.version) best.set(k, t);
  }
  return [...best.values()].sort((a, b) => a.template_key.localeCompare(b.template_key) || (a.client_slug ?? "").localeCompare(b.client_slug ?? ""));
}

/** The version a save of this key and scope must name (0 for a new key). */
export function expectedTemplateVersion(templates: EngagementTemplate[], key: string, clientSlug: string | null): number {
  return templates
    .filter((t) => t.template_key === key && t.client_slug === clientSlug)
    .reduce((max, t) => Math.max(max, t.version), 0);
}

export const templateLabel = (t: EngagementTemplate) =>
  `${t.template_key} v${t.version} · ${TYPE_LABEL[t.template_type]} · ${t.client_slug ? "this client" : "all clients"}`;

export const kickoffRecorded = (e: Engagement) => Boolean(e.terms?.kickoff_recorded_at);
export const canKickoff = (e: Engagement) => e.status === "planned" && !kickoffRecorded(e);
export const latestCloseout = (e: Engagement): Closeout | undefined => e.closeouts[0];

/** Plain-language message for a database error code from the checked functions. */
export function errorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "40001":
      return "This changed since you opened it. Reload and try again.";
    case "42501":
      return "You are not allowed to do that here.";
    case "23505":
      return "This client already has an active 45-day sprint. Close it first.";
    case "22023":
      return "That is not allowed (check the template, its milestones, or the engagement status).";
    case "23514":
      return "Check the fields: dates cannot change after the kickoff, and testing cannot end before it starts.";
    case "P0002":
      return "Not found, or the client is not active.";
    default:
      return fallback;
  }
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : []);

/** Shapes the nested select into engagements with sorted milestones and closeouts. */
export function toEngagements(rows: unknown): Engagement[] {
  return asArray<Record<string, unknown>>(rows)
    .map((r) => ({
      id: r.id as string,
      client_slug: r.client_slug as string,
      cycle_number: r.cycle_number as number,
      engagement_type: r.engagement_type as EngagementType,
      status: r.status as EngagementStatus,
      start_date: (r.start_date as string | null) ?? null,
      day30_date: (r.day30_date as string | null) ?? null,
      day45_date: (r.day45_date as string | null) ?? null,
      terms: asArray<Terms>(r.engagement_terms)[0] ?? null,
      purchase_reference: asArray<{ purchase_reference: string | null }>(r.engagement_notes)[0]?.purchase_reference ?? null,
      milestones: asArray<Milestone>(r.engagement_milestones).sort((a, b) => a.position - b.position),
      closeouts: asArray<Closeout>(r.engagement_closeouts).sort((a, b) => b.version - a.version),
    }))
    .sort((a, b) => b.cycle_number - a.cycle_number);
}

/** One entry per non-empty line, for the closeout lists. */
export const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);
