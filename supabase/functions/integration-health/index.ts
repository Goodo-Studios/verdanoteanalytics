import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { type Caller, resolveCaller } from "../_shared/internal-auth.ts";
import {
  type AlertException,
  environmentOf,
  evaluateIntegrationHealth,
  type HealthSnapshot,
  OWNER_ALERT_LIMIT,
  ownerAlertsFor,
  QUEUE_OVERDUE_MINUTES,
} from "../_shared/integration-health.ts";

// Integration health for staff (consolidation step 4a, port of the Goodo OS
// Integration health page and its /api/monitoring/overview route).
//
// GET or POST, no body -> the status of the ClickUp, Fireflies, Slack and
// Verdanote data connectors, the work queue and the latest owner alert jobs.
// Read-only: it reads Verdanote tables with the service role after the staff
// check, reports whether each connector's secret is set (true or false, never the
// value) and calls no outside service. Rules in _shared/integration-health.ts.
//
// Gate: a builder or employee login. Clients, logins with no role and the service
// role get 403.
//
// Alerts (step 4d, port of Goodo OS backend/monitoring/alerts.ts): problems covered by
// an active alert_exceptions row are reported as suppressed. POST {"action":"evaluate"}
// is builder only: it lists the owner alerts the open problems call for (one per problem
// per UTC day) and, in the production project only, queues each through
// enqueue_owner_alert (which queues only for a builder-confirmed owner alert channel;
// run-slack-jobs sends only with the slack_sends switch on). Anywhere else nothing is
// queued and each alert comes back with reason "not_production".

export interface Deps {
  resolveCaller?: (req: Request) => Promise<Caller | Response>;
  env?: (name: string) => string | undefined;
  loadSnapshot?: (env: (name: string) => string | undefined, now: Date) => Promise<HealthSnapshot>;
  now?: () => Date;
  /** Queues one owner alert; returns the job id, or null when no confirmed owner channel exists. */
  enqueueOwnerAlert?: (env: (name: string) => string | undefined, key: string, text: string) => Promise<string | null>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

async function defaultResolveCaller(req: Request): Promise<Caller | Response> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server misconfigured" }, 500);
  return await resolveCaller(req, createClient(url, key));
}

function isStaffLogin(caller: Caller): boolean {
  if (caller.kind !== "user") return false;
  return caller.roles.includes("builder") || caller.roles.includes("employee");
}

const isSet = (value: string | undefined) => typeof value === "string" && value.trim().length > 0;

// The small part of the Supabase client this function uses.
type Row = Record<string, unknown>;
interface QueryResult {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}
interface Query extends PromiseLike<QueryResult> {
  select(columns: string, options?: { count: "exact"; head: boolean }): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  lt(column: string, value: unknown): Query;
  gt(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  not(column: string, operator: string, value: unknown): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(n: number): Query;
  maybeSingle(): PromiseLike<QueryResult>;
}
export interface SupabaseLike {
  from(table: string): Query;
}
interface RpcLike {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
}

/** Queues an owner alert through enqueue_owner_alert with the service role. */
export async function enqueueOwnerAlertInDatabase(
  env: (name: string) => string | undefined,
  key: string,
  text: string,
  makeClient: (url: string, key: string) => RpcLike = (u, k) => createClient(u, k) as unknown as RpcLike,
): Promise<string | null> {
  const url = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Server misconfigured");
  const result = await makeClient(url, serviceKey).rpc("enqueue_owner_alert", { p_key: key, p_text: text });
  if (result.error) throw new Error(`enqueue_owner_alert: ${result.error.message}`);
  return typeof result.data === "string" ? result.data : null;
}

async function must(label: string, query: PromiseLike<QueryResult>): Promise<QueryResult> {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result;
}

const serviceClient = (url: string, key: string) => createClient(url, key) as unknown as SupabaseLike;

/** Reads the snapshot with the service role. Selects only the columns the overview needs. */
export async function loadSnapshotFromDatabase(
  env: (name: string) => string | undefined,
  now: Date,
  makeClient: (url: string, key: string) => SupabaseLike = serviceClient,
): Promise<HealthSnapshot> {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server misconfigured");
  const sb = makeClient(url, key);
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const overdueBefore = new Date(now.getTime() - QUEUE_OVERDUE_MINUTES * 60_000).toISOString();
  const nowIso = now.toISOString();
  const count = { count: "exact" as const, head: true };

  const [
    lastBoard, boardRows, sendsSwitch, ownerDestinations,
    running, lastCompleted, failed, accounts,
    overdue, expired, recovery, pending, alerts, exceptions,
  ] = await Promise.all([
    must("pipeline_tasks", sb.from("pipeline_tasks").select("synced_at").order("synced_at", { ascending: false }).limit(1)),
    must("pipeline_tasks count", sb.from("pipeline_tasks").select("clickup_task_id", count)),
    must("outbound_switches", sb.from("outbound_switches").select("enabled").eq("name", "slack_sends").maybeSingle()),
    must("slack_destinations", sb.from("slack_destinations").select("id", count).eq("purpose", "owner_alerts").eq("active", true).eq("owner_confirmed", true)),
    must("sync_logs running", sb.from("sync_logs").select("started_at").eq("status", "running").limit(500)),
    must("sync_logs completed", sb.from("sync_logs").select("completed_at").in("status", ["completed", "completed_with_errors"]).not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1)),
    must("sync_logs failed", sb.from("sync_logs").select("id", count).eq("status", "failed").gte("started_at", dayAgo)),
    must("ad_accounts", sb.from("ad_accounts").select("last_synced_at").eq("is_active", true).limit(1000)),
    must("durable_jobs overdue", sb.from("durable_jobs").select("id", count).eq("state", "queued").lt("available_at", overdueBefore)),
    must("durable_jobs leases", sb.from("durable_jobs").select("id", count).eq("state", "leased").lt("lease_until", nowIso)),
    must("durable_jobs recovery", sb.from("durable_jobs").select("id", count).eq("state", "recovery")),
    must("durable_jobs pending", sb.from("durable_jobs").select("id", count).in("state", ["queued", "leased"])),
    must("durable_jobs alerts", sb.from("durable_jobs").select("id, state, created_at, updated_at, payload").eq("kind", "slack.owner_alert").order("created_at", { ascending: false }).limit(OWNER_ALERT_LIMIT)),
    must("alert_exceptions", sb.from("alert_exceptions").select("id, connector, pattern, kind, reason, expires_at").gt("expires_at", nowIso).order("expires_at", { ascending: false }).limit(200)),
  ]);

  const rows = (r: QueryResult) => (Array.isArray(r.data) ? r.data : []) as Row[];
  const timeOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);
  const alertText = (payload: unknown) => {
    const p = (payload && typeof payload === "object" ? payload : {}) as Row;
    return typeof p.body === "string" ? p.body : typeof p.text === "string" ? p.text : null;
  };
  return {
    environment: environmentOf(url),
    secrets: {
      clickup: isSet(env("CLICKUP_API_TOKEN")),
      fireflies: isSet(env("FIREFLIES_API_KEY")),
      slack: isSet(env("SLACK_BOT_TOKEN")),
    },
    clickup: { lastSyncedAt: timeOrNull(rows(lastBoard)[0]?.synced_at), rows: boardRows.count ?? 0 },
    slack: {
      sendsEnabled: (sendsSwitch.data as { enabled?: boolean } | null)?.enabled === true,
      ownerAlertDestinations: ownerDestinations.count ?? 0,
    },
    adSync: {
      runningStartedAt: rows(running).map((r) => String(r.started_at)),
      lastCompletedAt: timeOrNull(rows(lastCompleted)[0]?.completed_at),
      failedLast24h: failed.count ?? 0,
      activeAccounts: rows(accounts).length,
      accountLastSynced: rows(accounts).map((r) => timeOrNull(r.last_synced_at)),
    },
    queue: {
      overdueQueued: overdue.count ?? 0,
      expiredLeases: expired.count ?? 0,
      recovery: recovery.count ?? 0,
      pending: pending.count ?? 0,
    },
    ownerAlerts: rows(alerts).map((r) => ({
      id: String(r.id),
      state: String(r.state),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      text: alertText(r.payload),
    })),
    exceptions: rows(exceptions).map((r) => ({
      id: String(r.id),
      connector: String(r.connector) as AlertException["connector"],
      pattern: String(r.pattern),
      kind: String(r.kind) as AlertException["kind"],
      reason: String(r.reason),
      expiresAt: String(r.expires_at),
    })),
  };
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Use GET or POST" }, 405);

  const caller = await (deps.resolveCaller ?? defaultResolveCaller)(req);
  if (caller instanceof Response) return caller;
  if (!isStaffLogin(caller)) return json({ error: "Forbidden: staff only" }, 403);

  // A POST may carry {"action":"evaluate"}; no body (or {}) is the read.
  let action: string | null = null;
  if (req.method === "POST") {
    const raw = await req.text();
    if (raw.trim()) {
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: "Body must be JSON" }, 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Body must be a JSON object" }, 400);
      const a = (body as Record<string, unknown>).action;
      if (a !== undefined && a !== "evaluate") return json({ error: "Unknown action" }, 400);
      action = a === "evaluate" ? "evaluate" : null;
    }
  }
  if (action === "evaluate" && !caller.roles.includes("builder")) return json({ error: "Forbidden: builder only" }, 403);

  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const now = (deps.now ?? (() => new Date()))();
  try {
    const snapshot = await (deps.loadSnapshot ?? loadSnapshotFromDatabase)(env, now);
    const overview = evaluateIntegrationHealth(snapshot, now);
    if (action !== "evaluate") return json(overview);
    const planned = ownerAlertsFor(overview, now);
    const alerts = [];
    for (const a of planned) {
      if (overview.environment !== "production") {
        alerts.push({ ...a, enqueued: false, jobId: null, reason: "not_production" });
        continue;
      }
      const jobId = await (deps.enqueueOwnerAlert ?? enqueueOwnerAlertInDatabase)(env, a.key, a.text);
      alerts.push({ ...a, enqueued: jobId !== null, jobId, reason: jobId === null ? "no_owner_destination" : null });
    }
    return json({ evaluated: true, checkedAt: overview.checkedAt, environment: overview.environment, alerts });
  } catch (error) {
    console.error("integration-health:", error instanceof Error ? error.message : error);
    return json({ error: "Integration health could not be read." }, 500);
  }
}

// Tests import the handler with INTEGRATION_HEALTH_NO_SERVE set.
if (!Deno.env.get("INTEGRATION_HEALTH_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
