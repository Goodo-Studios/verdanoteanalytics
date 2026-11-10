// Fireflies transcript reader. Read-only.
//
// Port of goodo-os backend/connectors/fireflies/api.ts and classify.ts. Only the
// single-transcript GraphQL query is ever sent, for one id the caller names; the
// account's transcript list is never browsed and no mutation is ever sent.
//
// API facts (Fireflies docs, checked by Goodo OS on 2026-10-10):
//   POST https://api.fireflies.ai/graphql, JSON {query, variables},
//   Authorization: Bearer <key>. Errors arrive in errors[] with code and
//   extensions.{code,status}: object_not_found 404; forbidden, not_in_team,
//   require_elevated_privilege, paid_required, account_cancelled,
//   feature_disabled 403; too_many_requests 429 (Retry-After seconds, or
//   extensions.metadata.retryAfter epoch ms); request_timeout 408;
//   invariant_violation 500; a bad key is auth_failed.
//
// Nothing returned, thrown or logged here carries the key. Logs name the
// operation and the HTTP status or provider error code only, never transcript text.

export const FIREFLIES_API_URL = "https://api.fireflies.ai/graphql";
export const MAX_EXCERPT_CHARS = 2_000;

export type FirefliesErrorCode = "auth_failed" | "provider_unavailable" | "invalid_response";

export class FirefliesError extends Error {
  constructor(public readonly code: FirefliesErrorCode) {
    super(code);
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface FirefliesClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
  maxWaitMs?: number;
  timeoutMs?: number;
  log?: (event: string, detail: Record<string, string | number>) => void;
}

export interface Sentence {
  index: number;
  speakerId: string;
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface Transcript {
  id: string;
  startedAt: string;
  organizer: string;
  participants: string[];
  live: boolean;
  sentences: Sentence[] | null;
}

export type TranscriptResult =
  | { kind: "found"; transcript: Transcript }
  | { kind: "not_found" }
  | { kind: "access_denied" };

export type Classification = "clean" | "personnel" | "legal" | "financial";

export interface Excerpt {
  excerptId: string;
  speaker: string;
  startedAt: string;
  endedAt: string;
  classification: Classification;
  text: string;
}

export const TRANSCRIPT_QUERY =
  "query GoodoTranscript($id: String!) { transcript(id: $id) { id date dateString organizer_email host_email participants is_live sentences { index speaker_id speaker_name text start_time end_time } } }";
export const SAFE_TRANSCRIPT_ID = /^[A-Za-z0-9_-]{1,200}$/;

const ACCESS_CODES = new Set(["forbidden", "not_in_team", "require_elevated_privilege", "paid_required", "account_cancelled", "feature_disabled"]);
const AUTH_CODES = new Set(["auth_failed", "unauthenticated", "invalid_api_key", "unauthorized"]);
const TRANSIENT_CODES = new Set(["too_many_requests", "request_timeout", "invariant_violation"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const email = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

function seconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

// ── Sensitivity classification ─────────────────────────────────────────────────
// Deliberately broad: a false positive only withholds one excerpt's text; a false
// negative would show sensitive text. Personnel wins over legal and financial.
const PERSONNEL = [
  /\b(?:salary|salaries|compensation|pay (?:raise|cut|rise)|raise for|bonus(?:es)?|equity grant|severance)\b/i,
  /\bperformance (?:review|issue|problem|plan|improvement)s?\b/i,
  /\b(?:PIP|disciplinary|written warning|write[- ]up|probation(?:ary)?)\b/,
  /\b(?:fire|fired|firing|terminate|terminated|termination|lay(?:ing)? (?:off|them off|him off|her off)|laid off|layoffs?|let (?:him|her|them) go|resign(?:ed|ation)?|quit(?:ting)?)\b/i,
  /\b(?:HR (?:complaint|issue|investigation|matter)|harass(?:ment|ed|ing)?|discriminat\w*|grievance|misconduct)\b/i,
  /\b(?:medical leave|sick leave|maternity|paternity|parental leave|pregnan\w*|diagnos\w*|therap(?:y|ist)|disabilit\w*|mental health|rehab)\b/i,
  /\b(?:background check|reference check|visa status|immigration status)\b/i,
];
const LEGAL = [
  /\b(?:lawsuit|litigation|litigate|sue|suing|sued|subpoena|deposition|arbitration|cease and desist|injunction)\b/i,
  /\b(?:attorney|lawyer|legal counsel|outside counsel|privileged|attorney[- ]client)\b/i,
  /\b(?:settlement agreement|breach of contract|indemnif\w*|liabilit(?:y|ies) claim|regulator(?:y)? (?:inquiry|investigation)|FTC|compliance violation)\b/i,
];
const FINANCIAL = [
  /\b(?:bank account|account number|routing number|wire (?:instructions|details)|IBAN|SWIFT code|credit card|card number|CVV|social security|SSN|tax ID|EIN|tax return|payroll)\b/i,
  /\b\d(?:[ -]?\d){8,}\b/,
];

export function classifyTranscriptText(text: string): Classification {
  if (PERSONNEL.some((p) => p.test(text))) return "personnel";
  if (LEGAL.some((p) => p.test(text))) return "legal";
  if (FINANCIAL.some((p) => p.test(text))) return "financial";
  return "clean";
}

// ── Normalising ────────────────────────────────────────────────────────────────

/** Normalises one transcript object. Throws invalid_response on a malformed shape. */
export function normalizeTranscript(raw: Record<string, unknown>, requestedId: string): Transcript {
  if (raw.id !== requestedId) throw new FirefliesError("invalid_response");
  const dateMs = typeof raw.date === "number" && Number.isFinite(raw.date)
    ? raw.date
    : typeof raw.dateString === "string" ? Date.parse(raw.dateString) : NaN;
  if (!Number.isFinite(dateMs)) throw new FirefliesError("invalid_response");
  const participants = [
    ...new Set(
      (Array.isArray(raw.participants) ? raw.participants : [])
        .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
        .map(email)
        .filter((v) => v && v.length <= 300),
    ),
  ].sort();
  const organizer = (email(raw.organizer_email) || email(raw.host_email) || "unknown").slice(0, 300);
  let sentences: Sentence[] | null = null;
  if (Array.isArray(raw.sentences)) {
    sentences = raw.sentences
      .filter(isObject)
      .map((s, position) => {
        const speakerId = s.speaker_id === null || s.speaker_id === undefined ? "" : String(s.speaker_id);
        const named = typeof s.speaker_name === "string" ? s.speaker_name.replace(/\s+/g, " ").trim() : "";
        const start = seconds(s.start_time);
        return {
          index: Number.isSafeInteger(s.index) ? (s.index as number) : position,
          speakerId,
          speaker: (named || (speakerId ? `Speaker ${speakerId}` : "Unknown speaker")).slice(0, 200),
          text: typeof s.text === "string" ? s.text.replace(/\s+/g, " ").trim() : "",
          start,
          end: Math.max(start, seconds(s.end_time)),
        };
      })
      .filter((s) => s.text)
      .sort((a, b) => a.index - b.index);
  }
  return { id: requestedId, startedAt: new Date(dateMs).toISOString(), organizer, participants, live: raw.is_live === true, sentences };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Changes whenever any text, speaker, timing, the meeting time, organiser or participants change. */
export async function sourceVersion(t: Transcript): Promise<string> {
  const canonical = JSON.stringify([
    t.id, t.startedAt, t.organizer, t.participants,
    (t.sentences ?? []).map((s) => [s.index, s.speakerId, s.speaker, s.text, s.start, s.end]),
  ]);
  return `fireflies-v1-${(await sha256Hex(canonical)).slice(0, 40)}`;
}

/** Consecutive sentences of one speaker form an excerpt of at most MAX_EXCERPT_CHARS. */
export async function buildExcerpts(t: Transcript, version: string): Promise<Excerpt[]> {
  const base = Date.parse(t.startedAt);
  const at = (offset: number) => new Date(base + Math.round(offset * 1000)).toISOString();
  const groups: Array<{ speaker: string; speakerId: string; text: string; start: number; end: number; first: number }> = [];
  for (const s of t.sentences ?? []) {
    for (let offset = 0; offset < s.text.length; offset += MAX_EXCERPT_CHARS) {
      const piece = s.text.slice(offset, offset + MAX_EXCERPT_CHARS).trim();
      if (!piece) continue;
      const last = groups[groups.length - 1];
      if (last && offset === 0 && last.speakerId === s.speakerId && last.speaker === s.speaker &&
          last.text.length + 1 + piece.length <= MAX_EXCERPT_CHARS) {
        last.text = `${last.text} ${piece}`;
        last.end = Math.max(last.end, s.end);
      } else {
        groups.push({ speaker: s.speaker, speakerId: s.speakerId, text: piece, start: s.start, end: s.end, first: s.index });
      }
    }
  }
  return await Promise.all(groups.map(async (g, position) => ({
    excerptId: `ff-${(await sha256Hex(JSON.stringify([t.id, version, position, g.first]))).slice(0, 40)}`,
    speaker: g.speaker,
    startedAt: at(g.start),
    endedAt: at(g.end),
    classification: classifyTranscriptText(g.text),
    text: g.text,
  })));
}

// ── Client ─────────────────────────────────────────────────────────────────────

export function createFirefliesClient(options: FirefliesClientOptions) {
  if (!options.apiKey || /\s/.test(options.apiKey)) throw new FirefliesError("auth_failed");
  const fetcher: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const maxRetries = options.maxRetries ?? 3;
  const maxWaitMs = options.maxWaitMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const log = options.log ?? ((event: string, detail: Record<string, string | number>) => console.error(event, JSON.stringify(detail)));

  async function getTranscript(transcriptId: string): Promise<TranscriptResult> {
    if (!SAFE_TRANSCRIPT_ID.test(transcriptId)) return { kind: "not_found" };
    for (let attempt = 0; ; attempt++) {
      const backoff = Math.min(maxWaitMs, 500 * 2 ** attempt);
      let response: Response;
      try {
        response = await fetcher(FIREFLIES_API_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ query: TRANSCRIPT_QUERY, variables: { id: transcriptId } }),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        log("fireflies.request_failed", { attempt });
        if (attempt < maxRetries) { await sleep(backoff); continue; }
        throw new FirefliesError("provider_unavailable");
      }
      const body: unknown = await response.json().catch(() => null);
      const errors = isObject(body) && Array.isArray(body.errors) ? body.errors.filter(isObject) : [];
      const first = errors[0];
      const extensions = first && isObject(first.extensions) ? first.extensions : {};
      const code = String(extensions.code ?? first?.code ?? "");

      if (response.status === 401 || AUTH_CODES.has(code)) {
        log("fireflies.auth_rejected", { status: response.status, code: code || "none" });
        throw new FirefliesError("auth_failed");
      }
      if (response.status === 429 || code === "too_many_requests") {
        const headerRaw = response.headers.get("retry-after");
        const header = headerRaw === null || headerRaw.trim() === "" ? NaN : Number(headerRaw);
        const meta = isObject(extensions.metadata) ? Number(extensions.metadata.retryAfter) : NaN;
        const delay = Number.isFinite(header) && header >= 0 ? header * 1000 : Number.isFinite(meta) ? Math.max(0, meta - now()) : 30_000;
        log("fireflies.rate_limited", { attempt, delayMs: delay });
        if (attempt < maxRetries && delay <= maxWaitMs) { await sleep(delay); continue; }
        throw new FirefliesError("provider_unavailable");
      }
      if (response.status === 408 || response.status >= 500 || TRANSIENT_CODES.has(code)) {
        log("fireflies.provider_error", { attempt, status: response.status, code: code || "none" });
        if (attempt < maxRetries) { await sleep(backoff); continue; }
        throw new FirefliesError("provider_unavailable");
      }
      if (code === "object_not_found" || (!code && response.status === 404)) return { kind: "not_found" };
      if (ACCESS_CODES.has(code) || (!code && response.status === 403)) {
        log("fireflies.access_denied", { code: code || "none" });
        return { kind: "access_denied" };
      }
      if (first || response.status < 200 || response.status >= 300 || !isObject(body) || !isObject(body.data)) {
        log("fireflies.unexpected_response", { status: response.status, code: code || "none" });
        throw new FirefliesError("invalid_response");
      }
      const transcript = body.data.transcript;
      if (transcript === null || transcript === undefined) return { kind: "not_found" };
      if (!isObject(transcript)) throw new FirefliesError("invalid_response");
      return { kind: "found", transcript: normalizeTranscript(transcript, transcriptId) };
    }
  }

  return { getTranscript };
}
