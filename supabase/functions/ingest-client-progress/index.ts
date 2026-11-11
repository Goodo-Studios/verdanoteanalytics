// P9: ingest-client-progress. The HQ processes push client progress (completion, status, contract
// dates, monthly deliverables) here instead of to the old dashboard database.
//
// Auth: a dedicated ingest token, `Authorization: Bearer vni_...`. Only its sha256 hash is stored
// (ingest_tokens); verifyIngestToken hashes the presented value and compares it with every active hash
// in constant time. This is a credential, not a login or a role: clients and staff logins are refused
// (their JWT is not an ingest token). verify_jwt is false because the caller has no Supabase session.
//
// Write: one batched call to apply_client_progress (service role only), which is idempotent, refuses
// unknown and hand-made clients per entry, sets last_synced from the database clock and writes the
// audit row. Shape errors and rate-limited calls write nothing to clients or deliverables.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import {
  extractBearer,
  findTokenId,
  looksLikeToken,
  makeWindowLimiter,
  MAX_BODY_BYTES,
  RATE_LIMIT_PER_MINUTE,
  validateIngestPayload,
} from "../_shared/ingest-progress.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

const anonymousLimiter = makeWindowLimiter(120, 60_000);

/** Resolves a presented token to an active token id, or null. Exported name is what the access manifest looks for. */
export async function verifyIngestToken(supabase: SupabaseLike, presented: string | null): Promise<string | null> {
  if (!presented || !looksLikeToken(presented)) return null;
  const { data, error } = await supabase.from("ingest_tokens").select("id, token_hash, scope").is("revoked_at", null);
  if (error) throw error;
  return await findTokenId(presented, (data ?? []) as Array<{ id: string; token_hash: string; scope: string }>);
}

async function audit(supabase: SupabaseLike, tokenId: string, source: string | null, outcome: string, errorCode: string, bytes: number) {
  const { error } = await supabase.from("ingest_audit").insert({
    token_id: tokenId, source: source ? source.slice(0, 60) : null, outcome, error_code: errorCode, request_bytes: bytes,
  });
  if (error) console.error("ingest-client-progress audit insert failed:", error.code ?? "unknown");
}

export async function handler(req: Request, supabaseOverride?: unknown): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const isClient = (o: unknown): o is SupabaseLike => !!o && typeof (o as { from?: unknown }).from === "function";
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!isClient(supabaseOverride) && (!url || !key)) return json({ ok: false, error: "server misconfigured" }, 500);
  const supabase: SupabaseLike = isClient(supabaseOverride) ? supabaseOverride : createClient(url!, key!);

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!anonymousLimiter(ip)) {
    return new Response(JSON.stringify({ ok: false, error: "too many requests" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  let tokenId: string | null;
  try {
    tokenId = await verifyIngestToken(supabase, extractBearer(req.headers.get("authorization")));
  } catch (err) {
    console.error("ingest-client-progress token lookup failed:", err instanceof Error ? err.message : "unknown");
    return json({ ok: false, error: "server error" }, 500);
  }
  if (!tokenId) return json({ ok: false, error: "unauthorized" }, 401);

  // Per-token rate limit from the audit table.
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error: countError } = await supabase
    .from("ingest_audit").select("id", { count: "exact", head: true }).eq("token_id", tokenId).gte("called_at", since);
  if (countError) return json({ ok: false, error: "server error" }, 500);
  if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
    return new Response(JSON.stringify({ ok: false, error: "rate limit exceeded" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    await audit(supabase, tokenId, null, "rejected", "content_type", 0);
    return json({ ok: false, error: "content-type must be application/json" }, 400);
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    await audit(supabase, tokenId, null, "rejected", "too_large", declared);
    return json({ ok: false, error: `body is larger than ${MAX_BODY_BYTES} bytes` }, 413);
  }
  const text = await req.text();
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BODY_BYTES) {
    await audit(supabase, tokenId, null, "rejected", "too_large", bytes);
    return json({ ok: false, error: `body is larger than ${MAX_BODY_BYTES} bytes` }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    await audit(supabase, tokenId, null, "rejected", "bad_json", bytes);
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }
  const v = validateIngestPayload(body);
  if (!v.ok) {
    const src = typeof (body as { source?: unknown })?.source === "string" ? (body as { source: string }).source : null;
    await audit(supabase, tokenId, src, "rejected", "bad_shape", bytes);
    return json({ ok: false, error: "invalid payload", details: v.errors }, 400);
  }

  const { data, error } = await supabase.rpc("apply_client_progress", {
    p_token_id: tokenId, p_source: v.value.source, p_items: v.value.clients, p_request_bytes: bytes,
  });
  if (error) {
    if (error.code === "28000") return json({ ok: false, error: "unauthorized" }, 401); // revoked just now
    console.error("ingest-client-progress write failed:", error.code ?? "unknown");
    await audit(supabase, tokenId, v.value.source, "error", String(error.code ?? "db").slice(0, 20), bytes);
    return json({ ok: false, error: "write failed" }, 500);
  }
  return json({ ok: true, ...(data as Record<string, unknown>) }, 200);
}

if (Deno.env.get("INGEST_PROGRESS_NO_SERVE") !== "1") {
  Deno.serve((req) => handler(req));
}
