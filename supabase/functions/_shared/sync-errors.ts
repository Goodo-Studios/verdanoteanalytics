// Error text that sync stores in sync_logs.api_errors.
//
// Deno fetch errors include the request URL, and Meta request URLs carry the
// agency access token. sync_logs rows are readable by more people than the
// token should be, so every stored error string goes through redact() first.

import { redact } from "./safe-error.ts";

export interface ApiErrorEntry {
  timestamp: string;
  message: string;
}

/** Message for a failed network call, with any credential removed. */
export function networkErrorMessage(err: unknown): string {
  return `Network error: ${redact(err)}`;
}

/**
 * Merge previously stored api_errors (a JSON string, possibly null) with new
 * entries and return the JSON string to store. The whole result is redacted, so
 * entries written before this fix are cleaned the next time a row is saved.
 */
export function serializeApiErrors(stored: string | null | undefined, added: ApiErrorEntry[]): string {
  let previous: unknown[] = [];
  try {
    const parsed = JSON.parse(stored || "[]");
    if (Array.isArray(parsed)) previous = parsed;
  } catch {
    previous = stored ? [{ timestamp: null, message: String(stored) }] : [];
  }
  return redact(JSON.stringify([...previous, ...added]));
}
