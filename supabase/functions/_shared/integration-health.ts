// Integration health rules (consolidation step 4a, port of Goodo OS
// backend/monitoring: health.ts and overview.ts).
//
// Goodo OS stored health observations, incidents and exceptions, written by an
// owner "evaluate" command and read by the Integration health page. In Verdanote
// the connectors live in the same database as their data, so the check is done on
// read instead: the integration-health function loads a snapshot (which secrets
// are set, never their values; when ClickUp last synced; the ad sync log; the job
// queue; owner alert jobs) and evaluateIntegrationHealth turns it into the page's
// overview. Nothing here calls an outside service or writes anything.
//
// Pattern codes follow the Goodo OS names where one exists (connector.stale,
// connector.unconfirmed, queue.recovery). The page turns codes into sentences
// (src/features/integration-health/model.ts).
//
// Alerts (step 4d, port of Goodo OS backend/monitoring/alerts.ts): an active row in
// alert_exceptions (expected exception or false positive, at most 24 hours) moves a
// problem from `patterns` to `suppressed`, so it neither counts against the state nor
// alerts. ownerAlertsFor lists the problems left; the function's builder-only
// "evaluate" action queues them as owner alerts, from production only.

/** Hours after the last ClickUp sync before the board counts as stale (the sync runs every 4 hours). */
export const CLICKUP_FRESHNESS_HOURS = 8;
/** Minutes a Meta ad sync may stay "running" before it counts as stuck (as system-health-check). */
export const SYNC_STUCK_MINUTES = 30;
/** Hours since an active ad account's last sync before it counts as behind. */
export const ACCOUNT_STALE_HOURS = 48;
/** Minutes a queued job may sit past its due time before it counts as overdue. */
export const QUEUE_OVERDUE_MINUTES = 15;
/** Owner alert jobs listed on the page. */
export const OWNER_ALERT_LIMIT = 10;

export interface HealthSnapshot {
  /** "production" only for the production Supabase project. */
  environment: "production" | "other";
  /** Whether each connector's secret is set. Values are never read into the snapshot. */
  secrets: { clickup: boolean; fireflies: boolean; slack: boolean };
  clickup: { lastSyncedAt: string | null; rows: number };
  slack: { sendsEnabled: boolean; ownerAlertDestinations: number };
  adSync: {
    runningStartedAt: string[];
    lastCompletedAt: string | null;
    failedLast24h: number;
    activeAccounts: number;
    /** last_synced_at of each active account (null = never synced). */
    accountLastSynced: Array<string | null>;
  };
  queue: { overdueQueued: number; expiredLeases: number; recovery: number; pending: number };
  ownerAlerts: Array<{ id: string; state: string; createdAt: string; updatedAt: string; text: string | null }>;
  /** Active alert exceptions (expires_at in the future). */
  exceptions: AlertException[];
  /**
   * Database vault secrets that features depend on (phase 6b: the two storage signing
   * secrets). Names and presence only. present is null when the check could not be made.
   */
  vaultSecrets?: VaultSecretStatus[];
}

export interface VaultSecretStatus {
  name: string;
  present: boolean | null;
  /** What stops working while it is missing. */
  needed_for: string;
}

/** The vault secrets reported, and what each one is for. Names only. */
export const STORAGE_SECRETS: Array<{ name: string; needed_for: string }> = [
  { name: "storage_signing_project_url", needed_for: "approving an application that has files, and deleting a location that has photos" },
  { name: "storage_signing_service_role_key", needed_for: "approving an application that has files, and deleting a location that has photos" },
];

/** Builds the vault secret list from what storage_signing_secrets_present() returned (or null when it failed). */
export function vaultSecretsFrom(result: unknown): VaultSecretStatus[] {
  const found = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : null;
  return STORAGE_SECRETS.map((s) => ({
    name: s.name,
    present: found && typeof found[s.name] === "boolean" ? (found[s.name] as boolean) : null,
    needed_for: s.needed_for,
  }));
}

export type AlertConnector = "clickup" | "fireflies" | "slack" | "verdanote_data" | "queue";

export interface AlertException {
  id: string;
  connector: AlertConnector;
  /** Problem code without its count, for example "connector.stale" or "sync.stuck". */
  pattern: string;
  kind: "idle_testing" | "paused_engagement" | "reconnect_warmup" | "false_positive";
  reason: string;
  expiresAt: string;
}

export type ConnectorState = "healthy" | "needs_attention" | "not_connected";

export interface ConnectorHealth {
  key: "clickup" | "fireflies" | "slack" | "verdanote_data";
  label: string;
  connected: boolean;
  state: ConnectorState;
  /** Problems, as pattern codes. */
  patterns: string[];
  /** Problems covered by an active alert exception. */
  suppressed: string[];
  /** Facts that are expected but worth showing (for example: sends are off). */
  notes: string[];
  lastConfirmedAt: string | null;
  details: Record<string, number | string | boolean | null>;
}

export interface HealthOverview {
  checkedAt: string;
  environment: "production" | "other";
  connectors: ConnectorHealth[];
  queue: { state: "healthy" | "needs_attention"; patterns: string[]; suppressed: string[]; pending: number };
  ownerAlerts: HealthSnapshot["ownerAlerts"];
  exceptions: AlertException[];
  /** Present only when the snapshot carried it. Never includes a value. */
  vaultSecrets?: VaultSecretStatus[];
}

/** The code of a pattern without its count: "sync.stuck:2" -> "sync.stuck". */
export const patternBase = (pattern: string) => pattern.split(":")[0];

/** Splits problems into those still open and those covered by an active exception. */
export function applyExceptions(connector: AlertConnector, patterns: string[], exceptions: AlertException[]): { patterns: string[]; suppressed: string[] } {
  const covered = new Set(exceptions.filter((e) => e.connector === connector).map((e) => e.pattern));
  return {
    patterns: patterns.filter((p) => !covered.has(patternBase(p))),
    suppressed: patterns.filter((p) => covered.has(patternBase(p))),
  };
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

function olderThan(iso: string | null, now: number, ms: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t > ms;
}

function stateOf(connected: boolean, patterns: string[]): ConnectorState {
  if (!connected) return "not_connected";
  return patterns.length ? "needs_attention" : "healthy";
}

/** Owner alert text is cut to this length on the page. */
export const ALERT_TEXT_MAX = 280;

export function evaluateIntegrationHealth(snapshot: HealthSnapshot, now: Date = new Date()): HealthOverview {
  const t = now.getTime();

  // ClickUp: the board sync (sync-clickup-tasks, every 4 hours).
  const clickupPatterns: string[] = [];
  if (snapshot.secrets.clickup) {
    if (!snapshot.clickup.lastSyncedAt) clickupPatterns.push("connector.unconfirmed");
    else if (olderThan(snapshot.clickup.lastSyncedAt, t, CLICKUP_FRESHNESS_HOURS * HOUR)) clickupPatterns.push("connector.stale");
  }
  const ex = snapshot.exceptions ?? [];
  const clickupSplit = applyExceptions("clickup", clickupPatterns, ex);
  const clickup: ConnectorHealth = {
    key: "clickup",
    label: "ClickUp",
    connected: snapshot.secrets.clickup,
    state: stateOf(snapshot.secrets.clickup, clickupSplit.patterns),
    patterns: clickupSplit.patterns,
    suppressed: clickupSplit.suppressed,
    notes: snapshot.secrets.clickup ? [] : ["clickup.no_token"],
    lastConfirmedAt: snapshot.clickup.lastSyncedAt,
    details: { boardRows: snapshot.clickup.rows, freshnessHours: CLICKUP_FRESHNESS_HOURS },
  };

  // Fireflies: read on demand (fireflies-transcript), nothing to be fresh.
  const fireflies: ConnectorHealth = {
    key: "fireflies",
    label: "Fireflies",
    connected: snapshot.secrets.fireflies,
    state: stateOf(snapshot.secrets.fireflies, []),
    patterns: [],
    suppressed: [],
    notes: snapshot.secrets.fireflies ? ["fireflies.on_demand"] : ["fireflies.no_key"],
    lastConfirmedAt: null,
    details: {},
  };

  // Slack: reminders and owner alerts (run-slack-jobs). Sends run only in the
  // production project with the slack_sends switch on; both are expected to be off
  // in staging, so they are notes, not problems.
  const slackNotes: string[] = [];
  if (!snapshot.secrets.slack) slackNotes.push("slack.no_token");
  if (snapshot.environment !== "production") slackNotes.push("slack.not_production");
  if (!snapshot.slack.sendsEnabled) slackNotes.push("slack.sends_off");
  const slackPatterns: string[] = [];
  if (snapshot.secrets.slack && snapshot.environment === "production" && snapshot.slack.sendsEnabled && snapshot.slack.ownerAlertDestinations === 0) {
    slackPatterns.push("slack.no_owner_destination");
  }
  const slackSplit = applyExceptions("slack", slackPatterns, ex);
  const slack: ConnectorHealth = {
    key: "slack",
    label: "Slack",
    connected: snapshot.secrets.slack,
    state: stateOf(snapshot.secrets.slack, slackSplit.patterns),
    patterns: slackSplit.patterns,
    suppressed: slackSplit.suppressed,
    notes: slackNotes,
    lastConfirmedAt: null,
    details: { sendsEnabled: snapshot.slack.sendsEnabled, ownerAlertDestinations: snapshot.slack.ownerAlertDestinations },
  };

  // Verdanote data: the Meta ad sync. It is inside Verdanote, so always connected.
  const ad = snapshot.adSync;
  const stuck = ad.runningStartedAt.filter((s) => olderThan(s, t, SYNC_STUCK_MINUTES * MINUTE)).length;
  const behind = ad.accountLastSynced.filter((s) => s === null || olderThan(s, t, ACCOUNT_STALE_HOURS * HOUR)).length;
  const dataPatterns: string[] = [];
  if (stuck) dataPatterns.push(`sync.stuck:${stuck}`);
  if (ad.failedLast24h) dataPatterns.push(`sync.failed:${ad.failedLast24h}`);
  if (behind) dataPatterns.push(`sync.accounts_behind:${behind}`);
  const dataSplit = applyExceptions("verdanote_data", dataPatterns, ex);
  const verdanoteData: ConnectorHealth = {
    key: "verdanote_data",
    label: "Verdanote data (Meta ad sync)",
    connected: true,
    state: stateOf(true, dataSplit.patterns),
    patterns: dataSplit.patterns,
    suppressed: dataSplit.suppressed,
    notes: ad.activeAccounts === 0 ? ["sync.no_active_accounts"] : [],
    lastConfirmedAt: ad.lastCompletedAt,
    details: {
      activeAccounts: ad.activeAccounts,
      runningSyncs: ad.runningStartedAt.length,
      stuckAfterMinutes: SYNC_STUCK_MINUTES,
      staleAfterHours: ACCOUNT_STALE_HOURS,
    },
  };

  // Work queue (durable_jobs).
  const q = snapshot.queue;
  const queuePatterns: string[] = [];
  if (q.overdueQueued) queuePatterns.push(`queue.overdue:${q.overdueQueued}`);
  if (q.expiredLeases) queuePatterns.push(`queue.lease_expired:${q.expiredLeases}`);
  if (q.recovery) queuePatterns.push(`queue.recovery:${q.recovery}`);
  const queueSplit = applyExceptions("queue", queuePatterns, ex);

  return {
    checkedAt: now.toISOString(),
    environment: snapshot.environment,
    connectors: [clickup, fireflies, slack, verdanoteData],
    queue: { state: queueSplit.patterns.length ? "needs_attention" : "healthy", patterns: queueSplit.patterns, suppressed: queueSplit.suppressed, pending: q.pending },
    ownerAlerts: snapshot.ownerAlerts.slice(0, OWNER_ALERT_LIMIT).map((a) => ({
      ...a,
      text: a.text === null ? null : a.text.length > ALERT_TEXT_MAX ? `${a.text.slice(0, ALERT_TEXT_MAX - 1)}…` : a.text,
    })),
    exceptions: ex,
    ...(snapshot.vaultSecrets ? { vaultSecrets: snapshot.vaultSecrets } : {}),
  };
}

export interface PlannedAlert {
  connector: AlertConnector;
  pattern: string;
  /** Owner alert dedupe key: one alert per problem per UTC day. */
  key: string;
  text: string;
}

/** The owner alerts the open (not suppressed) problems call for, one per problem per day. */
export function ownerAlertsFor(overview: HealthOverview, now: Date = new Date()): PlannedAlert[] {
  const day = now.toISOString().slice(0, 10);
  const out: PlannedAlert[] = [];
  const add = (connector: AlertConnector, label: string, pattern: string) => {
    out.push({
      connector,
      pattern,
      key: `health:${connector}:${patternBase(pattern)}:${day}`,
      text: `Integration health: ${label} needs attention (${pattern}). Open Integration health in Verdanote for details.`,
    });
  };
  for (const c of overview.connectors) for (const p of c.patterns) add(c.key, c.label, p);
  for (const p of overview.queue.patterns) add("queue", "the work queue", p);
  return out;
}

/** True when the URL is the production Supabase project. */
export const PRODUCTION_PROJECT_REF = "gwyxaqoaldnaavkjqquv";
export function environmentOf(supabaseUrl: string | undefined): "production" | "other" {
  try {
    return supabaseUrl && new URL(supabaseUrl).hostname === `${PRODUCTION_PROJECT_REF}.supabase.co` ? "production" : "other";
  } catch {
    return "other";
  }
}
