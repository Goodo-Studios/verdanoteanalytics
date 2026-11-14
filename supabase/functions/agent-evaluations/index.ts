import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { type Caller, resolveCaller } from "../_shared/internal-auth.ts";
import type { FetchLike } from "../_shared/meeting-recaps.ts";
import { AGENTS, DEFAULT_EVAL_MODEL, EvalModelError, evaluateSample, MAX_SAMPLES, promptVersion } from "../_shared/agent-evaluations.ts";

// Agent evaluations for staff (consolidation step 4c, port of the Goodo OS evaluation
// runner, US-058).
//
// POST { agent_key } -> runs every evaluation sample of that agent against the model
// with the agent's own instructions, one call per sample, and records the run through
// record_agent_evaluation_run. The database decides grounding (the quote must be an
// exact part of the sample) and the status; this function only collects the answers.
// Returns { run_id, status, total, passed }. A provider failure part way is recorded
// as a failed run with no results. Nothing is written outside Verdanote.
//
// Fails closed: without ANTHROPIC_API_KEY it answers 503 and makes no request and no
// database read. Staging has no key.
//
// Gate: a builder or employee login. Clients, logins with no role and the service
// role get 403.

export interface Sample {
  id: string;
  prompt: string;
}

export interface EvalStore {
  samples(agentKey: string): Promise<Sample[]>;
  record(run: Record<string, unknown>, results: Record<string, unknown>[]): Promise<{ id: string; status: string; total: number; passed: number }>;
}

export interface Deps {
  resolveCaller?: (req: Request) => Promise<Caller | Response>;
  env?: (name: string) => string | undefined;
  fetch?: FetchLike;
  store?: EvalStore;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function defaultResolveCaller(req: Request): Promise<Caller | Response> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server misconfigured" }, 500);
  return await resolveCaller(req, createClient(url, key));
}

const isStaffLogin = (caller: Caller) => caller.kind === "user" && (caller.roles.includes("builder") || caller.roles.includes("employee"));

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}
interface Query extends PromiseLike<QueryResult> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  order(column: string): Query;
  single(): PromiseLike<QueryResult>;
}
interface SupabaseLike {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
}

function databaseStore(env: (name: string) => string | undefined): EvalStore {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server misconfigured");
  const sb = createClient(url, key) as unknown as SupabaseLike;
  return {
    async samples(agentKey) {
      const { data, error } = await sb.from("agent_evaluation_samples").select("id, prompt").eq("agent_key", agentKey).order("sample_key");
      if (error) throw new Error(`agent_evaluation_samples: ${error.message}`);
      return (data ?? []) as Sample[];
    },
    async record(run, results) {
      const { data, error } = await sb.rpc("record_agent_evaluation_run", { p_run: run, p_results: results });
      if (error) throw new Error(`record_agent_evaluation_run: ${error.message}`);
      const id = String(data);
      const { data: row, error: e2 } = await sb.from("agent_evaluation_runs").select("status, total_samples, passed_samples").eq("id", id).single();
      if (e2) throw new Error(`agent_evaluation_runs: ${e2.message}`);
      const r = row as { status: string; total_samples: number; passed_samples: number };
      return { id, status: r.status, total: r.total_samples, passed: r.passed_samples };
    },
  };
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const caller = await (deps.resolveCaller ?? defaultResolveCaller)(req);
  if (caller instanceof Response) return caller;
  if (!isStaffLogin(caller)) return json({ error: "Forbidden: staff only" }, 403);

  let body: { agent_key?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON: { agent_key }" }, 400);
  }
  const agentKey = typeof body.agent_key === "string" ? body.agent_key.trim() : "";
  const agent = Object.hasOwn(AGENTS, agentKey) ? AGENTS[agentKey] : undefined;
  if (!agent) return json({ error: `agent_key must be one of: ${Object.keys(AGENTS).join(", ")}` }, 400);

  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const apiKey = env("ANTHROPIC_API_KEY")?.trim();
  if (!apiKey) return json({ error: "The evaluation model is not connected in this environment: ANTHROPIC_API_KEY is not set." }, 503);
  const model = env("ANTHROPIC_EVAL_MODEL")?.trim() || DEFAULT_EVAL_MODEL;

  let store: EvalStore;
  let samples: Sample[];
  try {
    store = deps.store ?? databaseStore(env);
    samples = await store.samples(agentKey);
  } catch (error) {
    console.error("agent-evaluations:", error instanceof Error ? error.message : error);
    return json({ error: "Evaluation samples could not be read." }, 500);
  }
  if (!samples.length) return json({ error: "This agent has no evaluation samples yet." }, 400);
  if (samples.length > MAX_SAMPLES) return json({ error: `A run takes at most ${MAX_SAMPLES} samples.` }, 400);

  const run = { agent_key: agentKey, model, prompt_version: await promptVersion(agent.system), started_by: caller.userId };
  const results: Record<string, unknown>[] = [];
  for (const sample of samples) {
    try {
      const answer = await evaluateSample({ apiKey, model, agentSystem: agent.system, prompt: sample.prompt, fetch: deps.fetch });
      results.push({ sample_id: sample.id, observed_decision: answer.decision, quote: answer.quote });
    } catch (error) {
      if (error instanceof EvalModelError && error.code === "auth_failed") return json({ error: "The model provider rejected ANTHROPIC_API_KEY." }, 503);
      const code = error instanceof EvalModelError ? error.code : "provider_error";
      try {
        const saved = await store.record({ ...run, status: "failed", limitation: `The model call failed on a sample (${code.replace(/_/g, " ")}), so no results were saved.` }, []);
        return json({ run_id: saved.id, status: saved.status, total: 0, passed: 0 });
      } catch (e) {
        console.error("agent-evaluations record:", e instanceof Error ? e.message : e);
        return json({ error: "The evaluation could not be saved." }, 500);
      }
    }
  }
  try {
    const saved = await store.record(run, results);
    return json({ run_id: saved.id, status: saved.status, total: saved.total, passed: saved.passed });
  } catch (error) {
    console.error("agent-evaluations record:", error instanceof Error ? error.message : error);
    return json({ error: "The evaluation could not be saved." }, 500);
  }
}

// Tests import the handler with AGENT_EVALUATIONS_NO_SERVE set.
if (!Deno.env.get("AGENT_EVALUATIONS_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
