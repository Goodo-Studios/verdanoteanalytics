// Integration health page model (consolidation step 4a, port of the Goodo OS
// Integration health page). The integration-health server function returns
// pattern and note codes; this file turns them into sentences.
// Codes come from supabase/functions/_shared/integration-health.ts.
import { fmtWhen } from "@/lib/formatters";

export type ConnectorState = "healthy" | "needs_attention" | "not_connected";

export interface ConnectorHealth {
  key: "clickup" | "fireflies" | "slack" | "verdanote_data";
  label: string;
  connected: boolean;
  state: ConnectorState;
  patterns: string[];
  /** Problems covered by an active alert exception (step 4d). */
  suppressed: string[];
  notes: string[];
  lastConfirmedAt: string | null;
  details: Record<string, number | string | boolean | null>;
}

export interface OwnerAlert {
  id: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  text: string | null;
}

export type AlertConnector = "clickup" | "fireflies" | "slack" | "verdanote_data" | "queue";
export type ExceptionKind = "idle_testing" | "paused_engagement" | "reconnect_warmup" | "false_positive";

export interface AlertException {
  id: string;
  connector: AlertConnector;
  pattern: string;
  kind: ExceptionKind;
  reason: string;
  expiresAt: string;
}

/** A database vault secret a feature depends on. Name and presence only, never the value. */
export interface VaultSecretStatus {
  name: string;
  /** null = the check could not be made. */
  present: boolean | null;
  needed_for: string;
}

export interface HealthOverview {
  checkedAt: string;
  environment: "production" | "other";
  connectors: ConnectorHealth[];
  queue: { state: "healthy" | "needs_attention"; patterns: string[]; suppressed?: string[]; pending: number };
  ownerAlerts: OwnerAlert[];
  exceptions?: AlertException[];
  /** Phase 6b: the storage signing secrets (names only). */
  vaultSecrets?: VaultSecretStatus[];
}

/** One line per vault secret: present, missing (and what stops working) or not checked. */
export function describeVaultSecret(s: VaultSecretStatus): string {
  if (s.present === true) return "Set";
  if (s.present === false) return `Missing. Until it is set, ${s.needed_for} fail with a message asking for it.`;
  return "Could not be checked right now.";
}

export interface EvaluatedAlert {
  connector: AlertConnector;
  pattern: string;
  key: string;
  text: string;
  enqueued: boolean;
  jobId: string | null;
  reason: "not_production" | "no_owner_destination" | null;
}

export const CONNECTOR_LABEL: Record<AlertConnector, string> = {
  clickup: "ClickUp",
  fireflies: "Fireflies",
  slack: "Slack",
  verdanote_data: "Verdanote data",
  queue: "Work queue",
};

export const KIND_LABEL: Record<ExceptionKind, string> = {
  idle_testing: "Idle while testing",
  paused_engagement: "Engagement paused",
  reconnect_warmup: "Reconnecting, warming up",
  false_positive: "False positive",
};

/** The code of a pattern without its count: "sync.stuck:2" -> "sync.stuck". */
export const patternBase = (pattern: string) => pattern.split(":")[0];

/** Kinds allowed for a problem code (the Goodo OS rule, also checked in the database). */
export function kindsFor(pattern: string): ExceptionKind[] {
  const base = patternBase(pattern);
  if (base === "connector.stale") return ["idle_testing", "paused_engagement", "false_positive"];
  if (base === "connector.unconfirmed") return ["reconnect_warmup", "false_positive"];
  return ["false_positive"];
}

/** The open problems a staff member can record an exception for. */
export function exceptionTargets(o: HealthOverview): Array<{ connector: AlertConnector; pattern: string }> {
  const out: Array<{ connector: AlertConnector; pattern: string }> = [];
  for (const c of o.connectors) for (const p of c.patterns) out.push({ connector: c.key, pattern: patternBase(p) });
  for (const p of o.queue.patterns) out.push({ connector: "queue", pattern: patternBase(p) });
  return out;
}

export function evaluatedText(a: EvaluatedAlert): string {
  if (a.enqueued) return "owner alert queued";
  if (a.reason === "not_production") return "not queued: owner alerts are only queued from production";
  if (a.reason === "no_owner_destination") return "not queued: no confirmed owner alert channel";
  return "not queued";
}

export const STATE_LABEL: Record<ConnectorState, string> = {
  healthy: "Healthy",
  needs_attention: "Needs attention",
  not_connected: "Not connected",
};

/** Same wording as the Goodo OS page for the job states an owner alert can be in. */
export const ALERT_STATE: Record<string, string> = {
  queued: "Alert queued",
  leased: "Alert sending",
  delivered: "Alert delivered",
  recovery: "Alert needs recovery",
  canceled: "Alert canceled",
  resolved_manually: "Alert resolved by hand",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A problem code as a sentence. Unknown codes are shown as they are. */
export function describePattern(pattern: string): string {
  if (pattern === "connector.stale") return "ClickUp data is older than the freshness window";
  if (pattern === "connector.unconfirmed") return "ClickUp has never completed a sync";
  if (pattern === "slack.no_owner_destination") return "Slack sends are on, but no confirmed owner alert channel exists";
  const [code, raw] = pattern.split(/:(.*)/s);
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) {
    if (code === "sync.stuck") return `${plural(n, "ad sync has", "ad syncs have")} been running for more than 30 minutes`;
    if (code === "sync.failed") return `${plural(n, "ad sync", "ad syncs")} failed in the last 24 hours`;
    if (code === "sync.accounts_behind") return `${plural(n, "active ad account has", "active ad accounts have")} not synced in 48 hours`;
    if (code === "queue.overdue") return `${plural(n, "queued job is", "queued jobs are")} more than 15 minutes overdue`;
    if (code === "queue.lease_expired") return `${plural(n, "job's worker", "jobs' workers")} stopped before finishing (lease expired)`;
    if (code === "queue.recovery") return `${plural(n, "job is", "jobs are")} waiting for recovery`;
  }
  return pattern;
}

/** An expected fact (not a problem) as a sentence. */
export function describeNote(note: string): string {
  switch (note) {
    case "clickup.no_token":
      return "No ClickUp token is set here, so the board sync does not run.";
    case "fireflies.no_key":
      return "No Fireflies key is set here, so transcripts cannot be read.";
    case "fireflies.on_demand":
      return "Read when a transcript is asked for; nothing is synced.";
    case "slack.no_token":
      return "No Slack bot token is set here.";
    case "slack.not_production":
      return "Slack messages are only ever sent from production.";
    case "slack.sends_off":
      return "The slack_sends switch is off, so nothing is sent.";
    case "sync.no_active_accounts":
      return "No active ad accounts.";
    default:
      return note;
  }
}

export const formatWhen = (iso: string | null): string => fmtWhen(iso);
