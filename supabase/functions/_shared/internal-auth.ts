// Authentication gate for edge functions the Supabase gateway does NOT protect.
//
// Every function in this project is declared `verify_jwt = false` in config.toml.
// That means the gateway forwards the request WITHOUT validating any JWT or apikey
// — several functions carried comments claiming the opposite ("the Supabase gateway
// validates the JWT/apikey before reaching this function"), which was never true.
// The handler itself is the only gate, so these helpers are it.
//
// How legitimate automated callers authenticate: every live pg_cron job (see
// supabase/migrations/*_cron*.sql) sends
//   Authorization: Bearer <vault.decrypted_secrets 'service_role_key'>
// i.e. the real service-role key, verbatim. Function-to-function calls forward the
// same key from SUPABASE_SERVICE_ROLE_KEY. So an exact match against that key
// identifies a trusted internal caller with no migration changes required.
//
// NOTE: the anon / publishable key is NOT accepted. It ships in the browser bundle,
// so treating it as proof of an internal caller would be equivalent to no auth.

import { corsHeaders } from "./cors.ts";

/** Constant-time string compare — avoids leaking the key through response timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The bearer token on the request, or null when absent. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const trimmed = header.trim();
  // A scheme with no credentials ("Bearer", or "Bearer   " — Headers trims the
  // value) is not a token. Without this the literal string "Bearer" leaks through
  // as the presented token.
  if (/^Bearer$/i.test(trimmed)) return null;
  const match = trimmed.match(/^Bearer\s+(.*)$/i);
  const token = (match ? match[1] : trimmed).trim();
  return token || null;
}

/**
 * True when the caller presented the real service-role key.
 *
 * Deliberately an exact, constant-time comparison against the configured secret —
 * NOT a key-prefix test and NOT a decoded-but-unverified JWT claim. Both of those
 * are trivially forgeable by anyone who can reach the endpoint.
 */
export function isServiceRoleRequest(req: Request): boolean {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = bearerToken(req);
  if (!expected || !token) return false;
  return safeEqual(token, expected);
}

/**
 * Gate for internal-only endpoints (cron maintenance, backfills, ops tooling).
 * Returns a 401 Response to return immediately, or null when the caller is trusted.
 */
export function requireServiceRole(req: Request): Response | null {
  if (isServiceRoleRequest(req)) return null;
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Gate for endpoints reachable BOTH from cron (service-role key) and from the app
 * UI (a signed-in staff user's JWT — apiFetch / supabase.functions.invoke attach
 * the session access token automatically).
 *
 * Returns a 401/403 Response to return immediately, or null when the caller is
 * allowed. `supabase` must be a service-role client so the user_roles lookup is
 * not itself subject to RLS.
 */
export async function requireStaffOrServiceRole(
  req: Request,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<Response | null> {
  const caller = await resolveCaller(req, supabase);
  if (caller instanceof Response) return caller;
  if (caller.kind === "service" || caller.isStaff) return null;
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** The authenticated identity behind a request. */
export type Caller =
  | { kind: "service"; isStaff: true; userId: null }
  | { kind: "user"; isStaff: boolean; userId: string; roles: string[] };

/**
 * Resolve the caller: the service role, or a signed-in user with their roles.
 * Returns a 401 Response when neither. Use this (rather than
 * requireStaffOrServiceRole) on endpoints that clients may legitimately reach but
 * which still need a per-resource ownership check.
 */
export async function resolveCaller(
  req: Request,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<Caller | Response> {
  if (isServiceRoleRequest(req)) return { kind: "service", isStaff: true, userId: null };

  const unauthorized = new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  const token = bearerToken(req);
  if (!token) return unauthorized;

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return unauthorized;

  // Fetch ALL role rows (a user may hold multiple) — `.single()` throws on >1 rows,
  // turning a legitimate multi-role staff user into a spurious 500. Same pattern as
  // the accounts / creatives / sync functions.
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = (roleRows || []).map((r: { role: string }) => r.role);
  return {
    kind: "user",
    userId: user.id,
    roles,
    isStaff: roles.includes("builder") || roles.includes("employee"),
  };
}
