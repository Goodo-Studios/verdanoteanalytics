// US-005 (Phase C, Feature #4): service-role edge function that writes an
// HQ-synthesized brief into the Postgres briefs table as status='draft'.
//
// ROLE: a THIN service-role persister. All brief synthesis (pulling hooks,
// angle clusters, ad transcript, Goodo brand context, and the LLM authoring
// itself) happens in HQ (US-006). This function does payload validation + a
// scoped, IDEMPOTENT upsert into public.briefs. NO model calls, NO business
// logic, and — by hard CLAUDE.md rule — NO Coda calls of any kind.
//
// CODA SAFETY (hard constraint): this module constructs NO Coda client, imports
// nothing Coda-related, and fetches no Coda URL. The Coda canvas is API-read-only;
// briefs are written ONLY to the Postgres briefs table. The accompanying Deno
// test asserts this (no Coda client constructed, no Coda URL fetched). The OLD
// create-coda-brief edge function path is intentionally NOT imported here.
//
// DATA FLOW: HQ brief-synthesis loop (US-006) -> human review gate -> POST here
//   { account_id, name, template_id?, content (jsonb), reference_ad_ids?,
//     assignee_name?, due_date?, generation_key }
// -> a single row lands in public.briefs with status='draft', scoped to
// account_id.
//
// AUTH (consistent with the US-002 ingest write path, NOT the read-only /api):
//   * verify_jwt = false (no end-user JWT) — the Supabase gateway bearer is
//     still required to reach the function. We layer a shared-secret guard
//     (x-write-brief-secret, or Bearer matching WRITE_BRIEF_SECRET) so the dumb
//     writer is not callable by any holder of the anon key. Same rationale as
//     ingest-reviews: this is an internal HQ->Postgres write path, so it mirrors
//     ingest-reviews (service-role + shared secret) rather than requiring a user
//     JWT — HQ has no end-user session to present.
//
// IDEMPOTENCY: the caller supplies a stable `generation_key`. Re-POSTing the
// same { account_id, generation_key } UPDATES the existing draft rather than
// duplicating it, via an upsert with onConflict on (account_id, generation_key)
// — the partial unique index added in migration 20260530000003.
//
// Exposes a testable handler(req, supabaseOverride); Deno.serve is guarded by
// WRITE_BRIEF_NO_SERVE so the test can import the module without binding.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

// ---- Constants -------------------------------------------------------------

/** The ONLY status this writer ever sets. Brief writes land as drafts. */
export const BRIEF_STATUS = "draft" as const;

// ---- Payload types ---------------------------------------------------------

export interface WriteBriefPayload {
  account_id?: unknown;
  name?: unknown;
  template_id?: unknown;
  content?: unknown;
  reference_ad_ids?: unknown;
  assignee_name?: unknown;
  due_date?: unknown;
  generation_key?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  account_id?: string;
  name?: string;
  template_id?: string | null;
  content?: Record<string, unknown>;
  reference_ad_ids?: string[];
  assignee_name?: string | null;
  due_date?: string | null;
  generation_key?: string;
}

// ---- Validation (pure, exported for tests) ---------------------------------

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string") as string[];
}

/**
 * Validate the POST body. account_id, name, content (a jsonb object), and
 * generation_key are required; template_id / reference_ad_ids / assignee_name /
 * due_date are optional. Returns a normalized, defensively-typed shape so the
 * writer never touches unvalidated input.
 */
export function validatePayload(body: WriteBriefPayload | null | undefined): ValidationResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const account_id = body.account_id;
  if (typeof account_id !== "string" || account_id.trim() === "") {
    return { ok: false, error: "account_id is required (non-empty string)" };
  }
  const name = body.name;
  if (typeof name !== "string" || name.trim() === "") {
    return { ok: false, error: "name is required (non-empty string)" };
  }
  const generation_key = body.generation_key;
  if (typeof generation_key !== "string" || generation_key.trim() === "") {
    return { ok: false, error: "generation_key is required for idempotency (non-empty string)" };
  }
  if (
    body.content === undefined || body.content === null ||
    typeof body.content !== "object" || Array.isArray(body.content)
  ) {
    return { ok: false, error: "content is required (jsonb object)" };
  }
  if (
    body.template_id !== undefined && body.template_id !== null &&
    typeof body.template_id !== "string"
  ) {
    return { ok: false, error: "template_id must be a string or null" };
  }
  if (
    body.reference_ad_ids !== undefined && body.reference_ad_ids !== null &&
    !Array.isArray(body.reference_ad_ids)
  ) {
    return { ok: false, error: "reference_ad_ids must be an array" };
  }
  if (
    body.due_date !== undefined && body.due_date !== null &&
    typeof body.due_date !== "string"
  ) {
    return { ok: false, error: "due_date must be a string (date) or null" };
  }
  if (
    body.assignee_name !== undefined && body.assignee_name !== null &&
    typeof body.assignee_name !== "string"
  ) {
    return { ok: false, error: "assignee_name must be a string or null" };
  }
  return {
    ok: true,
    account_id,
    name,
    template_id: typeof body.template_id === "string" ? body.template_id : null,
    content: body.content as Record<string, unknown>,
    reference_ad_ids: asStringArray(body.reference_ad_ids),
    assignee_name: typeof body.assignee_name === "string" ? body.assignee_name : null,
    due_date: typeof body.due_date === "string" ? body.due_date : null,
    generation_key,
  };
}

// ---- Row mapping (pure, exported for tests) --------------------------------

/**
 * Map a validated payload to a briefs upsert row. status is ALWAYS 'draft'
 * (BRIEF_STATUS) — never derived from input. generation_key is the upsert
 * conflict key, matching the partial unique index on (account_id, generation_key).
 */
export function toBriefRow(v: ValidationResult) {
  return {
    account_id: v.account_id!,
    name: v.name!,
    template_id: v.template_id ?? null,
    status: BRIEF_STATUS,
    content: v.content ?? {},
    reference_ad_ids: v.reference_ad_ids ?? [],
    assignee_name: v.assignee_name ?? null,
    due_date: v.due_date ?? null,
    generation_key: v.generation_key!,
  };
}

// ---- Service-role auth guard ----------------------------------------------

/**
 * Returns true if the request carries the shared write-brief secret. Accepts
 * either an `x-write-brief-secret` header or `Authorization: Bearer <secret>`.
 * If WRITE_BRIEF_SECRET is unset, the guard is open — the Supabase gateway
 * bearer is still required to reach the function at all. Mirrors ingest-reviews.
 */
export function isAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return true; // no secret configured -> rely on gateway bearer only
  const headerSecret = req.headers.get("x-write-brief-secret");
  if (headerSecret && headerSecret === secret) return true;
  const auth = req.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === secret) return true;
  return false;
}

// ---- Handler (testable) ----------------------------------------------------

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

/**
 * Core request handler. `supabaseOverride` is injected by tests with a recording
 * mock client; in production it is undefined and a service-role client is built.
 * A non-client truthy arg is ignored.
 */
export async function handler(req: Request, supabaseOverride?: unknown): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  // Shared-secret guard (on top of the gateway bearer).
  if (!isAuthorized(req, Deno.env.get("WRITE_BRIEF_SECRET") ?? undefined)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: WriteBriefPayload | null = null;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const v = validatePayload(body);
  if (!v.ok) return json({ success: false, error: v.error }, 400);

  // Build the service-role client unless a test injected one.
  const isClient = (o: unknown): o is SupabaseLike =>
    !!o && typeof (o as { from?: unknown }).from === "function";
  const supabase: SupabaseLike = isClient(supabaseOverride)
    ? supabaseOverride
    : createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

  try {
    const row = toBriefRow(v);

    // IDEMPOTENT UPSERT: on conflict against (account_id, generation_key) — the
    // partial unique index from migration 20260530000003 — update the existing
    // draft instead of inserting a duplicate. status is always 'draft'.
    const { data, error } = await supabase
      .from("briefs")
      .upsert(row, { onConflict: "account_id,generation_key" })
      .select("id")
      .single();
    if (error) throw error;

    const summary = {
      success: true,
      account_id: v.account_id,
      generation_key: v.generation_key,
      status: BRIEF_STATUS,
      brief_id: (data as { id?: string } | null)?.id ?? null,
    };
    console.log("write-brief:", JSON.stringify(summary));
    return json(summary, 200);
  } catch (err: unknown) {
    console.error("write-brief error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: msg }, 500);
  }
}

if (Deno.env.get("WRITE_BRIEF_NO_SERVE") !== "1") {
  Deno.serve((req) => handler(req));
}
