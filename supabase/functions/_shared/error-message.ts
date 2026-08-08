// Shared error-message extraction (lifted from write-brief/index.ts, US-007).
//
// Supabase-js rejects with a PLAIN object ({ message, code, details, hint }),
// NOT an Error instance — so `err instanceof Error ? err.message : "Unknown
// error"` silently swallows the real cause and returns the opaque "Unknown
// error" (this masked a 42P10 ON CONFLICT failure during US-007). Read
// `.message` off any object, and append the Postgres error `code` when present
// so failures are diagnosable from logs / HTTP responses alone.
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; code?: unknown };
    // Use the human-readable message + PG code only. Do NOT fall back to
    // JSON.stringify(err): that dumps internal `details`/`hint`/table names into
    // responses returned to callers (schema disclosure). An empty message
    // collapses to a generic string instead.
    const msg = typeof e.message === "string" && e.message.trim() !== ""
      ? e.message
      : "Unexpected error";
    const code = typeof e.code === "string" && e.code.trim() !== "" ? ` (${e.code})` : "";
    return `${msg}${code}`;
  }
  if (typeof err === "string" && err.trim() !== "") return err;
  return "Unknown error";
}
