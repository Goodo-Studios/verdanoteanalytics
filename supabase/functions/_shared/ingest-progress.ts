// Pure helpers for ingest-client-progress: payload validation and token checks.
// Kept free of network and database calls so the Deno tests cover them directly.

export const MAX_BODY_BYTES = 200_000;
export const MAX_CLIENTS = 100;
export const MAX_DELIVERABLES_PER_CLIENT = 50;
export const RATE_LIMIT_PER_MINUTE = 60;

export const DELIVERABLE_TYPES = ["cycle_brief", "production", "delivery", "report", "performance"] as const;
export const DELIVERABLE_STATUSES = ["pending", "in_progress", "complete"] as const;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_RE = /^vni_[0-9a-f]{64}$/;

const CLIENT_KEYS = new Set([
  "slug", "name", "status", "service_type", "strategist", "pct_complete",
  "contract_start", "contract_end", "month", "notes", "deliverables",
]);
const DELIVERABLE_KEYS = new Set(["month", "type", "status", "file_path"]);

export interface IngestDeliverable {
  month: string;
  type: string;
  status: string;
  file_path?: string | null;
}
export type IngestClient = Record<string, unknown> & { slug: string; deliverables?: IngestDeliverable[] };
export interface IngestPayload {
  source: string;
  clients: IngestClient[];
}
export type ValidationResult = { ok: true; value: IngestPayload } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function hasControlChars(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) return true;
  }
  return false;
}

/** Strings only, no control characters, length capped. Messages never echo a value. */
function checkString(errors: string[], path: string, v: unknown, max: number, nullable: boolean, required = false) {
  if (v === null) {
    if (!nullable) errors.push(`${path} cannot be null`);
    return;
  }
  if (typeof v !== "string") return void errors.push(`${path} must be a string`);
  if (required && v.trim() === "") return void errors.push(`${path} cannot be empty`);
  if (v.length > max) errors.push(`${path} is longer than ${max} characters`);
  if (hasControlChars(v)) errors.push(`${path} has control characters`);
}

export function validateIngestPayload(body: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(body)) return { ok: false, errors: ["body must be a JSON object"] };
  for (const k of Object.keys(body)) {
    if (k !== "source" && k !== "clients") errors.push(`unknown field: ${k}`);
  }
  const source = body.source;
  if (typeof source !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,59}$/.test(source)) {
    errors.push("source must be a short process name such as run-cycle");
  }
  const clients = body.clients;
  if (!Array.isArray(clients)) {
    errors.push("clients must be an array");
    return { ok: false, errors };
  }
  if (clients.length === 0) errors.push("clients cannot be empty");
  if (clients.length > MAX_CLIENTS) errors.push(`clients has more than ${MAX_CLIENTS} entries`);
  const seen = new Set<string>();
  clients.slice(0, MAX_CLIENTS).forEach((c, i) => {
    const p = `clients[${i}]`;
    if (!isObj(c)) return void errors.push(`${p} must be an object`);
    for (const k of Object.keys(c)) {
      if (!CLIENT_KEYS.has(k)) errors.push(`${p}: unknown field ${k.slice(0, 40)}`);
    }
    if (typeof c.slug !== "string" || !SLUG_RE.test(c.slug)) errors.push(`${p}.slug must be a lowercase slug`);
    else if (seen.has(c.slug)) errors.push(`${p}.slug appears twice in this call`);
    else seen.add(c.slug);
    if ("name" in c) checkString(errors, `${p}.name`, c.name, 200, false, true);
    if ("status" in c) checkString(errors, `${p}.status`, c.status, 60, false, true);
    if ("service_type" in c) checkString(errors, `${p}.service_type`, c.service_type, 120, true);
    if ("strategist" in c) checkString(errors, `${p}.strategist`, c.strategist, 120, true);
    if ("notes" in c) checkString(errors, `${p}.notes`, c.notes, 2000, true);
    if ("pct_complete" in c && c.pct_complete !== null) {
      if (typeof c.pct_complete !== "number" || !Number.isInteger(c.pct_complete) || c.pct_complete < 0 || c.pct_complete > 100) {
        errors.push(`${p}.pct_complete must be a whole number from 0 to 100`);
      }
    }
    for (const k of ["contract_start", "contract_end"]) {
      if (k in c && c[k] !== null && (typeof c[k] !== "string" || !validDate(c[k] as string))) errors.push(`${p}.${k} must be YYYY-MM-DD`);
    }
    if ("month" in c && c.month !== null && (typeof c.month !== "string" || !MONTH_RE.test(c.month))) errors.push(`${p}.month must be YYYY-MM`);
    if ("deliverables" in c) {
      const ds = c.deliverables;
      if (!Array.isArray(ds)) return void errors.push(`${p}.deliverables must be an array`);
      if (ds.length > MAX_DELIVERABLES_PER_CLIENT) errors.push(`${p}.deliverables has more than ${MAX_DELIVERABLES_PER_CLIENT} entries`);
      const keys = new Set<string>();
      ds.slice(0, MAX_DELIVERABLES_PER_CLIENT).forEach((d, j) => {
        const dp = `${p}.deliverables[${j}]`;
        if (!isObj(d)) return void errors.push(`${dp} must be an object`);
        for (const k of Object.keys(d)) {
          if (!DELIVERABLE_KEYS.has(k)) errors.push(`${dp}: unknown field ${k.slice(0, 40)}`);
        }
        if (typeof d.month !== "string" || !MONTH_RE.test(d.month)) errors.push(`${dp}.month must be YYYY-MM`);
        if (!(DELIVERABLE_TYPES as readonly unknown[]).includes(d.type)) errors.push(`${dp}.type is not a known deliverable type`);
        if (!(DELIVERABLE_STATUSES as readonly unknown[]).includes(d.status)) errors.push(`${dp}.status is not a known status`);
        if ("file_path" in d) checkString(errors, `${dp}.file_path`, d.file_path, 500, true);
        const key = `${d.month}|${d.type}`;
        if (keys.has(key)) errors.push(`${dp} repeats a month and type`);
        keys.add(key);
      });
    }
    if (!("deliverables" in c) && Object.keys(c).filter((k) => k !== "slug").length === 0) {
      errors.push(`${p} has nothing to write`);
    }
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, 20) };
  return { ok: true, value: { source: source as string, clients: clients as IngestClient[] } };
}

// ---- token handling --------------------------------------------------------

export function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m ? m[1] : null;
}

export function looksLikeToken(t: string): boolean {
  return TOKEN_RE.test(t);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two equal-purpose hex strings without stopping at the first difference. */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Hashes the presented token and compares it with every active token hash, with no early exit,
 * so the time taken does not depend on which row (if any) matched. Returns the token id.
 */
export async function findTokenId(
  presented: string,
  rows: Array<{ id: string; token_hash: string; scope?: string }>,
  scope = "client_progress",
): Promise<string | null> {
  const hash = await sha256Hex(presented);
  let found: string | null = null;
  for (const r of rows) {
    const same = constantTimeEqual(hash, r.token_hash);
    if (same && (r.scope ?? scope) === scope) found = r.id;
  }
  return found;
}

/** Best-effort per-instance limiter for callers with no valid token. */
export function makeWindowLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}
