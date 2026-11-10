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
}

export type ConnectorState = "healthy" | "needs_attention" | "not_connected";

export interface ConnectorHealth {
  key: "clickup" | "fireflies" | "slack" | "verdanote_data";
  label: string;
  connected: boolean;
  state: ConnectorState;
  /** Problems, as pattern codes. */
  patterns: string[];
  /** Facts that are expected but worth showing (for example: sends are off). */
  notes: string[];
  lastConfirmedAt: string | null;
  details: Record<string, number | string | boolean | null>;
}

export interface HealthOverview {
  checkedAt: string;
  environment: "production" | "other";
  connectors: ConnectorHealth[];
  queue: { state: "healthy" | "needs_attention"; patterns: string[]; pending: number };
  ownerAlerts: HealthSnapshot["ownerAlerts"];
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
  const clickup: ConnectorHealth = {
    key: "clickup",
    label: "ClickUp",
    connected: snapshot.secrets.clickup,
    state: stateOf(snapshot.secrets.clickup, clickupPatterns),
    patterns: clickupPatterns,
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
  const slack: ConnectorHealth = {
    key: "slack",
    label: "Slack",
    connected: snapshot.secrets.slack,
    state: stateOf(snapshot.secrets.slack, slackPatterns),
    patterns: slackPatterns,
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
  const verdanoteData: ConnectorHealth = {
    key: "verdanote_data",
    label: "Verdanote data (Meta ad sync)",
    connected: true,
    state: stateOf(true, dataPatterns),
    patterns: dataPatterns,
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

  return {
    checkedAt: now.toISOString(),
    environment: snapshot.environment,
    connectors: [clickup, fireflies, slack, verdanoteData],
    queue: { state: queuePatterns.length ? "needs_attention" : "healthy", patterns: queuePatterns, pending: q.pending },
    ownerAlerts: snapshot.ownerAlerts.slice(0, OWNER_ALERT_LIMIT).map((a) => ({
      ...a,
      text: a.text === null ? null : a.text.length > ALERT_TEXT_MAX ? `${a.text.slice(0, ALERT_TEXT_MAX - 1)}…` : a.text,
    })),
  };
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
