// Shared parts of the public link framework (P8). A public link is a secret token in a URL that
// lets someone with no login see one thing and write one kind of answer. Everything an anonymous
// caller can reach goes through the `public-link` edge function, which uses the service role and
// the service-only database functions. This file holds what every link type needs:
//
//   - the token shape check and the SHA-256 hash the database looks up (the token itself is never
//     compared or stored by this layer);
//   - a client address key and a per-address and per-token rate limit (public_link_rate_hit);
//   - a body size limit that applies to the bytes actually read, not to a header;
//   - one response shape: unknown token, wrong link type and malformed token all look the same
//     (404 not_found), so nothing can be learned by guessing. A revoked or expired link answers
//     410 only to someone who holds a token that really exists.
//
// Nothing here logs a token, an address or a payload.
import { corsHeaders } from "./cors.ts";

export const MAX_BODY_BYTES = 8 * 1024;

/** A token is 32 to 128 characters of the url-safe alphabet. Anything else is not a token. */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,128}$/;

export type LinkStatus = "ok" | "not_found" | "revoked" | "expired";

export interface Limits {
  /** Requests per address per minute, every action. */
  ipPerMinute: number;
  /** Requests per token per minute, every action. */
  tokenPerMinute: number;
  /** Writes per address per ten minutes (votes, submissions). */
  writePerTenMinutes: number;
  /** Lookups of a token that does not exist, per address per ten minutes. */
  missesPerTenMinutes: number;
}

export const DEFAULT_LIMITS: Limits = {
  ipPerMinute: 120,
  tokenPerMinute: 300,
  writePerTenMinutes: 60,
  missesPerTenMinutes: 20,
};

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      // A link page is private to whoever holds the link: no shared cache, no search index.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      ...extra,
    },
  });
}

export const notFound = () => jsonResponse({ error: "not_found" }, 404);
export const tooMany = (retryAfterSeconds = 60) =>
  jsonResponse({ error: "rate_limited" }, 429, { "Retry-After": String(retryAfterSeconds) });

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The hash the registry stores for a token, or null when the text cannot be a token. */
export async function hashToken(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) return null;
  return await sha256Hex(token);
}

/** The caller's address from the proxy header, hashed so the rate limit table holds no address. */
export async function clientKey(req: Request): Promise<string> {
  const fwd = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0].trim().slice(0, 64) || "unknown";
  return (await sha256Hex(`public-link:${ip}`)).slice(0, 32);
}

export type BodyResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: 400 | 413 };

/** Reads at most maxBytes of JSON. Counts the bytes actually received. */
export async function readJsonBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<BodyResult> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 };
  const reader = req.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(all));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, status: 400 };
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400 };
  }
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** True while under the limit. Fails closed: a database error counts as over the limit. */
export async function rateHit(db: Db, key: string, limit: number, windowSeconds: number, cost = 1): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("public_link_rate_hit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
      p_cost: cost,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/** Per-address and per-token limits for one request. Returns a 429 response, or null to go on. */
export async function checkRequestLimits(
  db: Db,
  ip: string,
  tokenHash: string | null,
  isWrite: boolean,
  limits: Limits = DEFAULT_LIMITS,
): Promise<Response | null> {
  // Addresses that keep hitting tokens that do not exist are slowed down first (a look, no count).
  if (!(await rateHit(db, `miss:${ip}`, limits.missesPerTenMinutes, 600, 0))) return tooMany(600);
  if (!(await rateHit(db, `ip:${ip}`, limits.ipPerMinute, 60))) return tooMany(60);
  if (tokenHash && !(await rateHit(db, `tok:${tokenHash}`, limits.tokenPerMinute, 60))) return tooMany(60);
  if (isWrite && !(await rateHit(db, `write:${ip}`, limits.writePerTenMinutes, 600))) return tooMany(600);
  return null;
}

/** Counts a lookup of a token that did not exist, against the caller's address. */
export async function countMiss(db: Db, ip: string, limits: Limits = DEFAULT_LIMITS): Promise<void> {
  await rateHit(db, `miss:${ip}`, limits.missesPerTenMinutes, 600, 1);
}

/** Maps a database status to a response. `ok` is handled by the caller. */
export function statusResponse(status: string): Response {
  if (status === "revoked") return jsonResponse({ error: "revoked" }, 410);
  if (status === "expired") return jsonResponse({ error: "expired" }, 410);
  return notFound();
}
