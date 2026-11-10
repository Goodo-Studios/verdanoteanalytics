import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/internal-auth.ts";
import { createSlackWebApi, type SlackFetch } from "../_shared/slack-web-api.ts";

// Sends queued Slack reminders and owner alerts (consolidation step 3, Goodo OS
// Slack connector). Called by pg_cron every 5 minutes with the service-role key.
//
// Three locks, all required before anything is sent:
//   1. Production only. The function refuses (409) unless SUPABASE_URL is the
//      production project. Staging can never send, whatever its switches or keys.
//   2. The outbound switch. outbound_switches row 'slack_sends' must exist with
//      enabled = true. No row is seeded, so it is off until a builder turns it on.
//   3. SLACK_BOT_TOKEN. Without it the function answers 503 and sends nothing.
//
// Then: due reminders become jobs (enqueue_due_reminders), and slack.reminder and
// slack.owner_alert jobs are claimed and sent one by one. Each send is marked
// first (mark_job_sending), so a crash after the post can never post again: the
// job goes to recovery and staff check it. A destination that is no longer
// active and confirmed is not sent to.

export const PRODUCTION_PROJECT_REF = "gwyxaqoaldnaavkjqquv";
export const SWITCH_NAME = "slack_sends";
export const JOB_KINDS = ["slack.reminder", "slack.owner_alert"];
const LEASE_SECONDS = 60;
const BATCH = 20;

export interface Job {
  id: string;
  kind: string;
  fence: number;
  payload: Record<string, unknown>;
}

/** The database calls this function makes. Tests pass a stand-in. */
export interface JobStore {
  switchEnabled(name: string): Promise<boolean>;
  enqueueDueReminders(): Promise<number>;
  claim(kinds: string[], owner: string, leaseSeconds: number, limit: number): Promise<Job[]>;
  destinationConfirmed(channelId: string, purpose: string): Promise<boolean>;
  markSending(id: string, fence: number, owner: string): Promise<boolean>;
  finish(id: string, fence: number, owner: string, receipt: Record<string, unknown>): Promise<boolean>;
  fail(id: string, fence: number, owner: string, error: string, retrySeconds: number, permanent: boolean): Promise<string | null>;
}

export interface Deps {
  authorize?: (req: Request) => Promise<Response | null>;
  env?: (name: string) => string | undefined;
  store?: JobStore;
  fetch?: SlackFetch;
  owner?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export function isProductionProject(supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  try {
    return new URL(supabaseUrl).hostname === `${PRODUCTION_PROJECT_REF}.supabase.co`;
  } catch {
    return false;
  }
}

// The small part of the Supabase client this function uses.
type QueryResult = { data: unknown; error: { message: string } | null };
interface Chain extends PromiseLike<QueryResult> {
  select(columns: string): Chain;
  eq(column: string, value: unknown): Chain;
  limit(n: number): Chain;
  maybeSingle(): PromiseLike<QueryResult>;
}
interface SupabaseLike {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
  from(table: string): Chain;
}

function supabaseStore(sb: SupabaseLike): JobStore {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  };
  return {
    async switchEnabled(name) {
      const { data, error } = await sb.from("outbound_switches").select("enabled").eq("name", name).maybeSingle();
      if (error) throw new Error(`outbound_switches: ${error.message}`);
      return (data as { enabled?: boolean } | null)?.enabled === true;
    },
    async enqueueDueReminders() {
      return Number(await rpc("enqueue_due_reminders", {})) || 0;
    },
    async claim(kinds, owner, leaseSeconds, limit) {
      return ((await rpc("claim_jobs", { p_kinds: kinds, p_owner: owner, p_lease_seconds: leaseSeconds, p_limit: limit })) ?? []) as Job[];
    },
    async destinationConfirmed(channelId, purpose) {
      const { data, error } = await sb.from("slack_destinations").select("id")
        .eq("channel_id", channelId).eq("purpose", purpose).eq("active", true).eq("owner_confirmed", true).limit(1);
      if (error) throw new Error(`slack_destinations: ${error.message}`);
      return ((data as unknown[] | null) ?? []).length > 0;
    },
    async markSending(id, fence, owner) {
      return (await rpc("mark_job_sending", { p_job_id: id, p_fence: fence, p_owner: owner })) === true;
    },
    async finish(id, fence, owner, receipt) {
      return (await rpc("finish_job", { p_job_id: id, p_fence: fence, p_owner: owner, p_receipt: receipt })) === true;
    },
    async fail(id, fence, owner, error, retrySeconds, permanent) {
      return (await rpc("fail_job", {
        p_job_id: id, p_fence: fence, p_owner: owner, p_error: error, p_retry_seconds: retrySeconds, p_permanent: permanent,
      })) as string | null;
    },
  };
}

function messageOf(job: Job): { channel: string; text: string; purpose: string } | null {
  const p = job.payload ?? {};
  const channel = typeof p.channel_id === "string" ? p.channel_id : "";
  const text = typeof p.body === "string" ? p.body : typeof p.text === "string" ? p.text : "";
  const purpose = job.kind === "slack.owner_alert" ? "owner_alerts" : typeof p.purpose === "string" ? p.purpose : "";
  if (!/^[CGD][A-Z0-9]{2,20}$/.test(channel) || !text.trim() || !purpose) return null;
  return { channel, text, purpose };
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const denied = deps.authorize ? await deps.authorize(req) : await requireServiceRole(req);
  if (denied) return denied;

  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const supabaseUrl = env("SUPABASE_URL");
  if (!isProductionProject(supabaseUrl)) {
    return json({ error: "Slack sends never run outside the production project. Nothing was sent." }, 409);
  }

  let store = deps.store;
  if (!store) {
    const key = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!key) return json({ error: "Server misconfigured" }, 500);
    store = supabaseStore(createClient(supabaseUrl!, key) as unknown as SupabaseLike);
  }

  if (!(await store.switchEnabled(SWITCH_NAME))) {
    return json({ sent: 0, skipped: `The '${SWITCH_NAME}' switch is off. Nothing was sent.` });
  }
  const token = env("SLACK_BOT_TOKEN")?.trim();
  if (!token) return json({ error: "Slack is not connected: SLACK_BOT_TOKEN is not set. Nothing was sent." }, 503);

  const slack = createSlackWebApi({ token, fetch: deps.fetch });
  const owner = deps.owner ?? `run-slack-jobs:${crypto.randomUUID()}`;
  const queued = await store.enqueueDueReminders();
  const jobs = await store.claim(JOB_KINDS, owner, LEASE_SECONDS, BATCH);
  const tally = { queued_reminders: queued, claimed: jobs.length, sent: 0, retry: 0, recovery: 0, stale: 0 };

  for (const job of jobs) {
    const message = messageOf(job);
    if (!message) {
      await store.fail(job.id, job.fence, owner, "payload has no valid channel, text or purpose", 0, true);
      tally.recovery++;
      continue;
    }
    if (!(await store.destinationConfirmed(message.channel, message.purpose))) {
      await store.fail(job.id, job.fence, owner, "destination is no longer active and confirmed", 0, true);
      tally.recovery++;
      continue;
    }
    if (!(await store.markSending(job.id, job.fence, owner))) {
      tally.stale++;
      continue;
    }
    const outcome = await slack.postMessage(message.channel, message.text);
    if (outcome.kind === "ok") {
      const ts = typeof outcome.body.ts === "string" ? outcome.body.ts : null;
      await store.finish(job.id, job.fence, owner, { channel: message.channel, ts });
      tally.sent++;
    } else if (outcome.kind === "rate_limited") {
      const state = await store.fail(job.id, job.fence, owner, "slack rate limited", Math.ceil(outcome.retryAfterMs / 1000), false);
      if (state === "recovery") tally.recovery++;
      else tally.retry++;
    } else if (outcome.kind === "rejected") {
      await store.fail(job.id, job.fence, owner, `slack rejected: ${outcome.error}`, 0, true);
      tally.recovery++;
    } else {
      // No definite answer: the message may be out. Never post again automatically.
      await store.fail(job.id, job.fence, owner, `slack outcome unknown: ${outcome.reason}`, 0, true);
      tally.recovery++;
    }
  }
  return json(tally);
}

// Tests import the handler with RUN_SLACK_JOBS_NO_SERVE set.
if (!Deno.env.get("RUN_SLACK_JOBS_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
