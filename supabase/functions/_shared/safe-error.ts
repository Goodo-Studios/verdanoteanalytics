// Safe error responses. Raw error messages (especially Deno fetch errors) can
// include the full request URL, which for Meta calls carries access_token=.
// Never return those to callers; log a redacted version server-side only.

const SECRET_PARAM = /([?&](?:access_token|token|key|apikey|api_key|client_secret|fb_exchange_token)=)[^&#\s"']*/gi;
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+\/=-]+/gi;
const META_TOKEN = /\bEAA[A-Za-z0-9]{20,}/g;

function toText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Error) return input.message;
  try {
    return JSON.stringify(input) ?? String(input);
  } catch {
    return String(input);
  }
}

/** Redact credentials from any value (token query params, bearer tokens, Meta tokens). */
export function redact(input: unknown): string {
  return toText(input)
    .replace(SECRET_PARAM, "$1[REDACTED]")
    .replace(BEARER, "$1[REDACTED]")
    .replace(META_TOKEN, "[REDACTED]");
}

/** Log an error server-side with credentials redacted. */
export function logSafeError(context: string, err: unknown): void {
  console.error(`${context}: ${redact(err)}`);
}

/**
 * Build a JSON error Response with a fixed, generic message. The underlying
 * error is logged (redacted) server-side only.
 */
export function safeErrorResponse(
  err: unknown,
  headers: Record<string, string>,
  opts: { status?: number; message?: string; context?: string } = {},
): Response {
  const status = opts.status ?? 500;
  const message = opts.message ?? (status === 401 ? "Unauthorized" : "Internal server error");
  if (err !== undefined) logSafeError(opts.context ?? "error", err);
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
