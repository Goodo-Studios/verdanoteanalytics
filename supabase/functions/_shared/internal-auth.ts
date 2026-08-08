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
 * True when the caller presented the exact service-role key this function is
 * configured with.
 *
 * Deliberately an exact, constant-time comparison against the configured secret —
 * NOT a key-prefix test and NOT a decoded-but-unverified JWT claim. Both of those
 * are trivially forgeable by anyone who can reach the endpoint.
 *
 * This is the FAST PATH only. It covers function-to-function calls, which forward
 * SUPABASE_SERVICE_ROLE_KEY verbatim and therefore always match. pg_cron presents
 * the key stored in `vault.decrypted_secrets` instead, which is a SEPARATE store —
 * if an operator ever rotates one without the other (e.g. moves to an sb_secret_*
 * key in one place only), an exact match alone would silently 401 every cron job.
 * isTrustedInternalRequest() covers that case; prefer it.
 */
export function isServiceRoleRequest(req: Request): boolean {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = bearerToken(req);
  if (!expected || !token) return false;
  return safeEqual(token, expected);
}

// ── Service-credential capability probe ────────────────────────────────────────
// Verifies a presented token by USING it: only a service-role credential can call
// the GoTrue admin API. anon / publishable keys get 401 there, so this proves the
// caller holds service-role privileges without needing to know the key's value —
// which is what makes the gate immune to vault-vs-env key drift.

const PROBE_TTL_OK_MS = 5 * 60 * 1000;
const PROBE_TTL_DENY_MS = 30 * 1000;
const PROBE_TIMEOUT_MS = 5_000;
// Hard cap on distinct memoized probe results so a flood of distinct tokens
// cannot grow this map without bound (isolate-memory DoS).
const PROBE_CACHE_MAX = 1000;
const probeCache = new Map<string, { ok: boolean; expires: number }>();

/** Test seam: drop memoized probe results. */
export function _resetProbeCache(): void {
  probeCache.clear();
}

// Insert into the probe cache with eviction: prune expired entries, then bound
// the size by dropping the oldest insertions (Map preserves insertion order).
function probeCacheSet(key: string, value: { ok: boolean; expires: number }): void {
  if (probeCache.size >= PROBE_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of probeCache) {
      if (v.expires <= now) probeCache.delete(k);
    }
    while (probeCache.size >= PROBE_CACHE_MAX) {
      const oldest = probeCache.keys().next().value;
      if (oldest === undefined) break;
      probeCache.delete(oldest);
    }
  }
  probeCache.set(key, value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Cheap shape filter deciding whether a token is even WORTH a network probe.
 * This is NOT authorization — the probe is the authority. It exists so arbitrary
 * junk in the Authorization header cannot make us issue an outbound request per
 * inbound request (amplification).
 */
function looksLikeServiceCredential(token: string): boolean {
  if (token.startsWith("sb_secret_")) return true;
  // Legacy service-role key is a JWT carrying a role:"service_role" claim. We
  // decode the (unverified) payload only as a cheap shape filter — the capability
  // probe remains the real authority. This stops arbitrary "a.b.c" junk in the
  // Authorization header from triggering an outbound admin probe + cache entry
  // per distinct token (request amplification / unbounded-cache DoS).
  return decodeJwtRole(token) === "service_role";
}

// Decode the role claim from a JWT payload WITHOUT verifying the signature.
// Returns null for anything that isn't a well-formed 3-segment JWT with a JSON
// payload. Not authorization — only a pre-probe shape filter.
function decodeJwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** True when the token can actually exercise service-role privileges. */
async function hasServiceRoleCapability(token: string): Promise<boolean> {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  if (!baseUrl || !looksLikeServiceCredential(token)) return false;

  const cacheKey = await sha256Hex(token);
  const cached = probeCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.ok;

  let ok = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const resp = await fetch(`${baseUrl}/auth/v1/admin/users?page=1&per_page=1`, {
        headers: { apikey: token, Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      ok = resp.ok;
      await resp.body?.cancel();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    ok = false; // network error / timeout → fail closed
  }

  probeCacheSet(cacheKey, { ok, expires: Date.now() + (ok ? PROBE_TTL_OK_MS : PROBE_TTL_DENY_MS) });
  return ok;
}

/**
 * True when the caller is a trusted internal caller: it presented either the exact
 * configured service-role key (fast path, no network) or a different but genuine
 * service-role credential for this project (verified by capability probe).
 */
export async function isTrustedInternalRequest(req: Request): Promise<boolean> {
  if (isServiceRoleRequest(req)) return true;
  const token = bearerToken(req);
  if (!token) return false;
  return await hasServiceRoleCapability(token);
}

/**
 * Gate for internal-only endpoints (cron maintenance, backfills, ops tooling).
 * Returns a 401 Response to return immediately, or null when the caller is trusted.
 */
export async function requireServiceRole(req: Request): Promise<Response | null> {
  if (await isTrustedInternalRequest(req)) return null;
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
  if (await isTrustedInternalRequest(req)) return { kind: "service", isStaff: true, userId: null };

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
