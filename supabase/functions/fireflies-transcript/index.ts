import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { bearerToken, isTrustedInternalRequest, requireStaffOrServiceRole } from "../_shared/internal-auth.ts";
import {
  buildExcerpts,
  createFirefliesClient,
  FirefliesError,
  type FetchLike,
  SAFE_TRANSCRIPT_ID,
  sourceVersion,
} from "../_shared/fireflies.ts";

// Fireflies transcript reader for staff (consolidation step 3, Goodo OS connector).
//
// POST { transcript_id, include_excerpts? } -> the transcript's metadata and, when
// asked, its excerpts. Read-only: one GraphQL `query` for one named transcript;
// nothing is stored and nothing is written to Fireflies. Excerpts classed
// personnel, legal or financial come back with their class and no text.
//
// Fails closed: without FIREFLIES_API_KEY it answers 503 and makes no request.
// Staging has no key on purpose (no real meeting data in staging).
//
// Gate: staff (builder or employee) or the service role. The gate runs before the
// secret check, so a client never learns whether Fireflies is connected.

export interface Deps {
  /** Returns a Response to send (401/403) or null when the caller may proceed. */
  authorize?: (req: Request) => Promise<Response | null>;
  env?: (name: string) => string | undefined;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function defaultAuthorize(req: Request): Promise<Response | null> {
  if (!bearerToken(req)) return json({ error: "Unauthorized" }, 401);
  if (await isTrustedInternalRequest(req)) return null;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server misconfigured" }, 500);
  return await requireStaffOrServiceRole(req, createClient(url, key));
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const denied = await (deps.authorize ?? defaultAuthorize)(req);
  if (denied) return denied;

  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const apiKey = env("FIREFLIES_API_KEY")?.trim();
  if (!apiKey) {
    return json({ error: "Fireflies is not connected in this environment: FIREFLIES_API_KEY is not set." }, 503);
  }

  let body: { transcript_id?: unknown; include_excerpts?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON: { transcript_id, include_excerpts? }" }, 400);
  }
  const transcriptId = typeof body.transcript_id === "string" ? body.transcript_id.trim() : "";
  if (!SAFE_TRANSCRIPT_ID.test(transcriptId)) {
    return json({ error: "transcript_id must be 1 to 200 letters, digits, '-' or '_'" }, 400);
  }
  const includeExcerpts = body.include_excerpts === true;

  let result;
  try {
    const client = createFirefliesClient({ apiKey, fetch: deps.fetch, sleep: deps.sleep });
    result = await client.getTranscript(transcriptId);
  } catch (error) {
    if (error instanceof FirefliesError && error.code === "auth_failed") {
      return json({ error: "Fireflies rejected FIREFLIES_API_KEY." }, 503);
    }
    if (error instanceof FirefliesError) return json({ error: `Fireflies ${error.code.replace(/_/g, " ")}` }, 502);
    return json({ error: "Fireflies request failed" }, 502);
  }

  if (result.kind !== "found") return json({ status: result.kind, transcript_id: transcriptId });

  const t = result.transcript;
  const version = await sourceVersion(t);
  const status = t.live || t.sentences === null ? "processing" : "completed";
  const out: Record<string, unknown> = {
    status,
    transcript: {
      id: t.id,
      started_at: t.startedAt,
      organizer: t.organizer,
      participants: t.participants,
      source_version: version,
    },
  };
  if (includeExcerpts && status === "completed") {
    const excerpts = await buildExcerpts(t, version);
    out.excerpts = excerpts.map((e) => ({
      excerpt_id: e.excerptId,
      speaker: e.speaker,
      started_at: e.startedAt,
      ended_at: e.endedAt,
      classification: e.classification,
      text: e.classification === "clean" ? e.text : null,
    }));
    out.withheld = excerpts.filter((e) => e.classification !== "clean").length;
  }
  return json(out);
}

// Tests import the handler with FIREFLIES_TRANSCRIPT_NO_SERVE set.
if (!Deno.env.get("FIREFLIES_TRANSCRIPT_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
