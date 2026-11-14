import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { type Caller, resolveCaller } from "../_shared/internal-auth.ts";
import { SAFE_CLIENT_SLUG } from "../_shared/clickup-brief.ts";
import { buildExcerpts, createFirefliesClient, FirefliesError, SAFE_TRANSCRIPT_ID, sourceVersion } from "../_shared/fireflies.ts";
import {
  DEFAULT_RECAP_MODEL,
  extractRecapCandidates,
  type FetchLike,
  recapItemHash,
  RecapModelError,
  validateRecapCandidates,
} from "../_shared/meeting-recaps.ts";

// Meeting recaps for staff (consolidation step 4a, port of the Goodo OS meeting
// recap prepare command and its job worker, US-086).
//
// POST { client_slug, transcript_id, engagement_id? } -> reads the named Fireflies
// transcript, sends only its clean excerpts to the model, keeps the candidates
// whose citations are exact quotes, and records the outcome in meeting_recaps and
// meeting_recap_items (record_meeting_recap). Returns { recap_id, status, items }.
// Outcomes without content are recorded too: unavailable (not found, no access,
// still processing), quarantined (every excerpt withheld), failed (model error).
// Reviews are written by the page straight into meeting_recap_reviews (row rules
// and a trigger check the reviewer and the item hash). Nothing is written to
// Fireflies, ClickUp or Slack.
//
// Fails closed: without FIREFLIES_API_KEY or ANTHROPIC_API_KEY it answers 503 and
// makes no request and no database read. Staging has neither.
//
// Gate: a builder or employee login. Clients, logins with no role and the service
// role get 403.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecapStore {
  clientExists(slug: string): Promise<boolean>;
  engagementClient(id: string): Promise<string | null>;
  record(recap: Record<string, unknown>, items: Record<string, unknown>[]): Promise<string>;
}

export interface Deps {
  resolveCaller?: (req: Request) => Promise<Caller | Response>;
  env?: (name: string) => string | undefined;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  store?: RecapStore;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}
interface Query extends PromiseLike<QueryResult> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  maybeSingle(): PromiseLike<QueryResult>;
}
interface SupabaseLike {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
}

function databaseStore(env: (name: string) => string | undefined): RecapStore {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server misconfigured");
  const sb = createClient(url, key) as unknown as SupabaseLike;
  return {
    async clientExists(slug) {
      const { data, error } = await sb.from("clients").select("slug").eq("slug", slug).maybeSingle();
      if (error) throw new Error(`clients: ${error.message}`);
      return !!data;
    },
    async engagementClient(id) {
      const { data, error } = await sb.from("engagements").select("client_slug").eq("id", id).maybeSingle();
      if (error) throw new Error(`engagements: ${error.message}`);
      return (data as { client_slug?: string } | null)?.client_slug ?? null;
    },
    async record(recap, items) {
      const { data, error } = await sb.rpc("record_meeting_recap", { p_recap: recap, p_items: items });
      if (error) throw new Error(`record_meeting_recap: ${error.message}`);
      return String(data);
    },
  };
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const caller = await (deps.resolveCaller ?? defaultResolveCaller)(req);
  if (caller instanceof Response) return caller;
  if (!isStaffLogin(caller)) return json({ error: "Forbidden: staff only" }, 403);

  let body: { client_slug?: unknown; transcript_id?: unknown; engagement_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON: { client_slug, transcript_id, engagement_id? }" }, 400);
  }
  const clientSlug = typeof body.client_slug === "string" ? body.client_slug.trim() : "";
  const transcriptId = typeof body.transcript_id === "string" ? body.transcript_id.trim() : "";
  const engagementId = typeof body.engagement_id === "string" && body.engagement_id.trim() ? body.engagement_id.trim() : null;
  if (!SAFE_CLIENT_SLUG.test(clientSlug)) return json({ error: "client_slug is required" }, 400);
  if (!SAFE_TRANSCRIPT_ID.test(transcriptId)) return json({ error: "transcript_id must be 1 to 200 letters, digits, '-' or '_'" }, 400);
  if (engagementId !== null && !UUID.test(engagementId)) return json({ error: "engagement_id must be a uuid" }, 400);

  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const firefliesKey = env("FIREFLIES_API_KEY")?.trim();
  const anthropicKey = env("ANTHROPIC_API_KEY")?.trim();
  if (!firefliesKey) return json({ error: "Fireflies is not connected in this environment: FIREFLIES_API_KEY is not set." }, 503);
  if (!anthropicKey) return json({ error: "The recap model is not connected in this environment: ANTHROPIC_API_KEY is not set." }, 503);
  const model = env("ANTHROPIC_RECAP_MODEL")?.trim() || DEFAULT_RECAP_MODEL;

  let store: RecapStore;
  try {
    store = deps.store ?? databaseStore(env);
    if (!(await store.clientExists(clientSlug))) return json({ error: "Unknown client" }, 404);
    if (engagementId !== null && (await store.engagementClient(engagementId)) !== clientSlug) {
      return json({ error: "That engagement belongs to another client" }, 400);
    }
  } catch (error) {
    console.error("meeting-recaps:", error instanceof Error ? error.message : error);
    return json({ error: "Meeting recaps could not be read." }, 500);
  }

  const base = { client_slug: clientSlug, engagement_id: engagementId, transcript_id: transcriptId, requested_by: caller.userId };
  const finish = async (recap: Record<string, unknown>, items: Record<string, unknown>[] = []) => {
    try {
      const id = await store.record({ ...base, ...recap }, items);
      return json({ recap_id: id, status: recap.status, items: items.length, limitation: recap.limitation ?? null });
    } catch (error) {
      console.error("meeting-recaps record:", error instanceof Error ? error.message : error);
      return json({ error: "The recap could not be saved." }, 500);
    }
  };

  let result;
  try {
    result = await createFirefliesClient({ apiKey: firefliesKey, fetch: deps.fetch, sleep: deps.sleep }).getTranscript(transcriptId);
  } catch (error) {
    if (error instanceof FirefliesError && error.code === "auth_failed") return json({ error: "Fireflies rejected FIREFLIES_API_KEY." }, 503);
    return json({ error: "Fireflies request failed" }, 502);
  }
  if (result.kind === "not_found") {
    return await finish({ status: "unavailable", evidence_status: "not_found", limitation: "Fireflies has no transcript with that id, so no recap was prepared." });
  }
  if (result.kind === "access_denied") {
    return await finish({ status: "unavailable", evidence_status: "access_denied", limitation: "Fireflies denied access to that transcript, so no recap was prepared." });
  }
  const t = result.transcript;
  if (t.live || t.sentences === null) {
    return await finish({ status: "unavailable", evidence_status: "processing", meeting_started_at: t.startedAt, limitation: "The transcript is still processing, so no recap was prepared." });
  }

  const version = await sourceVersion(t);
  const excerpts = await buildExcerpts(t, version);
  const clean = excerpts.filter((e) => e.classification === "clean");
  const withheld = excerpts.length - clean.length;
  const common = { source_version: version, meeting_started_at: t.startedAt, evidence_status: "completed", withheld_excerpts: withheld, clean_excerpts: clean.length };
  if (!clean.length) {
    return await finish({
      ...common,
      status: "quarantined",
      limitation: withheld
        ? `All ${withheld} excerpt(s) were withheld as personnel, legal or financial, so nothing was sent to the model.`
        : "The transcript has no text, so nothing was sent to the model.",
    });
  }

  let candidates: unknown[];
  try {
    candidates = await extractRecapCandidates({ apiKey: anthropicKey, model, excerpts: clean, fetch: deps.fetch });
  } catch (error) {
    if (error instanceof RecapModelError && error.code === "auth_failed") return json({ error: "The model provider rejected ANTHROPIC_API_KEY." }, 503);
    const code = error instanceof RecapModelError ? error.code : "provider_error";
    return await finish({ ...common, status: "failed", model, limitation: `The recap model call failed (${code.replace(/_/g, " ")}), so no recap content was saved.` });
  }

  const { accepted, rejected } = validateRecapCandidates(candidates, clean);
  const byId = new Map(clean.map((e) => [e.excerptId, e]));
  const items = await Promise.all(accepted.map(async (draft, position) => ({
    position,
    kind: draft.kind,
    summary: draft.summary,
    citations: draft.citations.map((c) => {
      const e = byId.get(c.excerptId)!;
      return { excerpt_id: c.excerptId, start: c.start, end: c.end, quote: e.text.slice(c.start, c.end), speaker: e.speaker, started_at: e.startedAt };
    }),
    date_status: draft.dateStatus,
    date_text: draft.dateText,
    date_value: draft.dateValue,
    missing_information: draft.missingInformation,
    proposed_action: draft.proposedAction,
    item_hash: await recapItemHash(transcriptId, version, position, draft),
  })));
  const notes = [
    withheld ? `${withheld} excerpt(s) were withheld and never sent to the model.` : null,
    rejected.length ? `${rejected.length} model output(s) were dropped because they were not grounded in the transcript or proposed a disallowed action.` : null,
    accepted.length ? null : "The model found no decisions, questions or actions.",
  ].filter(Boolean).join(" ");
  return await finish({ ...common, status: "prepared", model, rejected_candidates: rejected.length, limitation: notes || null }, items);
}

// Tests import the handler with MEETING_RECAPS_NO_SERVE set.
if (!Deno.env.get("MEETING_RECAPS_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
