import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { type Caller, resolveCaller } from "../_shared/internal-auth.ts";
import {
  environmentOf,
  evaluateIntegrationHealth,
  type HealthSnapshot,
  OWNER_ALERT_LIMIT,
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

export interface Deps {
  resolveCaller?: (req: Request) => Promise<Caller | Response>;
  env?: (name: string) => string | undefined;
  loadSnapshot?: (env: (name: string) => string | undefined, now: Date) => Promise<HealthSnapshot>;
  now?: () => Date;
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
  gte(column: string, value: unknown): Query;
  not(column: string, operator: string, value: unknown): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(n: number): Query;
  maybeSingle(): PromiseLike<QueryResult>;
}
export interface SupabaseLike {
  from(table: string): Query;
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
    overdue, expired, recovery, pending, alerts,
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
  };
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Use GET or POST" }, 405);

  const caller = await (deps.resolveCaller ?? defaultResolveCaller)(req);
  if (caller instanceof Response) return caller;
  if (!isStaffLogin(caller)) return json({ error: "Forbidden: staff only" }, 403);

  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const now = (deps.now ?? (() => new Date()))();
  try {
    const snapshot = await (deps.loadSnapshot ?? loadSnapshotFromDatabase)(env, now);
    return json(evaluateIntegrationHealth(snapshot, now));
  } catch (error) {
    console.error("integration-health:", error instanceof Error ? error.message : error);
    return json({ error: "Integration health could not be read." }, 500);
  }
}

// Tests import the handler with INTEGRATION_HEALTH_NO_SERVE set.
if (!Deno.env.get("INTEGRATION_HEALTH_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
