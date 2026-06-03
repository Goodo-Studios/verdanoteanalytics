// vault-share-item — public share links for a single Creative Vault item.
//
// Three actions on one endpoint (verify_jwt=false; auth is enforced per-action
// inside the handler):
//   • mint   (authed)  — any authenticated user mints/returns a share token for
//                        an item. Idempotent: reuses the existing token.
//   • revoke (authed)  — clears the share token (kills the public link).
//   • resolve (anon)   — public, no-login. Resolves a token to the item's full
//                        detail (creative + transcript + framework + AI analysis)
//                        plus a freshly service-role-signed media URL.
//
// Why an edge function (not a direct anon query like ad-board/brief sharing):
//   1. Uploaded creatives live in the PRIVATE `inspiration-media` bucket; an
//      anonymous client cannot mint a signed URL. The service role signs it here.
//   2. Mint/revoke must work for ANY authenticated user, but inspiration_items
//      UPDATE RLS is owner-scoped — the service role sidesteps that.
//   3. Routing reads through the service role keeps the global library
//      authenticated-only (no broad anon SELECT policy) and lets us return an
//      explicit column allowlist that omits internal fields.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

export type ShareAction = "mint" | "revoke" | "resolve";

// Columns exposed to the public viewer. Deliberately omits internal-only fields:
// user_id, saved_by, performance_snapshot (client spend/roas), source_ad_id,
// source_account_id, error_message, thumbnail_path.
export const PUBLIC_ITEM_COLUMNS =
  "id, platform, creator_handle, title, source_url, thumbnail_url, video_url, " +
  "file_path, ad_body_text, brand_name, industry, ad_format, target_audience, " +
  "script_analysis, visual_analysis, status, created_at";

const SIGNED_URL_TTL_SECONDS = 3600;

/** 12-char opaque share token (mirrors the ad-board share-token format). */
export function genShareToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

type ParsedAction =
  | { ok: true; action: "mint" | "revoke"; itemId: string }
  | { ok: true; action: "resolve"; token: string }
  | { ok: false; error: string };

/** Validate + normalize the request body into a discriminated action. */
export function parseAction(body: Record<string, unknown>): ParsedAction {
  const action = body.action;
  if (action === "mint" || action === "revoke") {
    const itemId = typeof body.item_id === "string" ? body.item_id.trim() : "";
    if (!itemId) return { ok: false, error: "item_id required" };
    return { ok: true, action, itemId };
  }
  if (action === "resolve") {
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return { ok: false, error: "token required" };
    return { ok: true, action, token };
  }
  return { ok: false, error: "invalid action" };
}

/**
 * Resolve the authenticated user from the request's Authorization bearer.
 * Returns null when there is no token, the token is the anon/publishable key,
 * or the JWT is otherwise invalid. Any authenticated user is allowed to
 * mint/revoke (the library is global).
 */
// deno-lint-ignore no-explicit-any
async function getAuthUser(db: any, req: Request): Promise<unknown | null> {
  const authz = req.headers.get("Authorization") ?? "";
  const token = authz.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

/**
 * Core request handler. `injectedDb` is supplied by tests; production builds a
 * service-role client. Bound to Deno.serve via a wrapper so the injectable
 * second param never receives Deno's ConnInfo (see
 * verdanote-deno-serve-wrap-handler-conninfo-leak).
 */
// deno-lint-ignore no-explicit-any
export async function handler(req: Request, injectedDb?: any): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const db =
    injectedDb ??
    createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const parsed = parseAction(body ?? {});
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  try {
    if (parsed.action === "resolve") {
      return await resolveShare(db, parsed.token);
    }

    // mint / revoke — require an authenticated user (any one will do).
    const user = await getAuthUser(db, req);
    if (!user) return json({ error: "unauthorized" }, 401);

    if (parsed.action === "mint") return await mintShare(db, parsed.itemId);
    return await revokeShare(db, parsed.itemId);
  } catch (err) {
    console.error("vault-share-item error:", err);
    return json({ error: String(err) }, 500);
  }
}

// deno-lint-ignore no-explicit-any
async function resolveShare(db: any, token: string): Promise<Response> {
  const { data: item, error } = await db
    .from("inspiration_items")
    .select(PUBLIC_ITEM_COLUMNS)
    .eq("share_token", token)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!item) return json({ error: "not found" }, 404);

  const [transcriptRes, frameworkRes] = await Promise.all([
    db.from("inspiration_transcripts")
      .select("cleaned_script, duration_seconds, word_count")
      .eq("item_id", item.id),
    db.from("inspiration_frameworks").select("*").eq("item_id", item.id),
  ]);

  // Private-bucket uploads need a service-role signed URL — the anon viewer
  // can't mint one. Rows that carry a public video_url skip this.
  let signedUrl: string | null = null;
  if (item.file_path && !item.video_url) {
    const { data: signed } = await db.storage
      .from("inspiration-media")
      .createSignedUrl(item.file_path, SIGNED_URL_TTL_SECONDS);
    signedUrl = signed?.signedUrl ?? null;
  }

  return json({
    item,
    transcript: transcriptRes.data?.[0] ?? null,
    framework: frameworkRes.data?.[0] ?? null,
    signed_url: signedUrl,
  });
}

// deno-lint-ignore no-explicit-any
async function mintShare(db: any, itemId: string): Promise<Response> {
  const { data: existing, error: readErr } = await db
    .from("inspiration_items")
    .select("share_token")
    .eq("id", itemId)
    .maybeSingle();
  if (readErr) return json({ error: readErr.message }, 500);
  if (!existing) return json({ error: "item not found" }, 404);

  // Idempotent: a re-mint returns the live token rather than churning it.
  let token: string | null = existing.share_token ?? null;
  if (!token) {
    token = genShareToken();
    const { error: updErr } = await db
      .from("inspiration_items")
      .update({ share_token: token, shared_at: new Date().toISOString() })
      .eq("id", itemId);
    if (updErr) return json({ error: updErr.message }, 500);
  }
  return json({ share_token: token });
}

// deno-lint-ignore no-explicit-any
async function revokeShare(db: any, itemId: string): Promise<Response> {
  const { error } = await db
    .from("inspiration_items")
    .update({ share_token: null, shared_at: null })
    .eq("id", itemId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

// Bind only outside tests. The arrow wrapper keeps Deno's ConnInfo out of the
// handler's injectable second parameter.
if (!Deno.env.get("VAULT_SHARE_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
