// Pure helpers for the creatives function's tag writes: chunking, paging past the
// PostgREST 1000-row cap (shared helper in paging.ts), and validation of the PUT body.

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Paging lives in one shared helper (audit 7.3); re-exported here for existing callers.
export { fetchAllRows } from "./paging.ts";

export const TAG_FIELDS = ["ad_type", "person", "style", "product", "hook", "theme"] as const;
export const MAX_TAG_LENGTH = 200;
export const MAX_NOTES_LENGTH = 5000;

export type TagUpdateResult =
  | { ok: true; update: Record<string, string | null> }
  | { ok: false; error: string };

/**
 * Validate the editable fields of PUT /creatives/:id. Tag values must be a string up to 200
 * characters or null (null clears the tag); notes a string up to 5000; scheduled_launch_date
 * null or YYYY-MM-DD. Unknown fields are ignored by the caller, not accepted here.
 */
export function validateTagUpdate(body: Record<string, unknown>): TagUpdateResult {
  const update: Record<string, string | null> = {};
  for (const f of TAG_FIELDS) {
    const v = body[f];
    if (v === undefined) continue;
    if (v !== null && typeof v !== "string") return { ok: false, error: `${f} must be a string or null` };
    if (typeof v === "string" && v.length > MAX_TAG_LENGTH) {
      return { ok: false, error: `${f} must be at most ${MAX_TAG_LENGTH} characters` };
    }
    update[f] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : null;
  }
  const notes = body.notes;
  if (notes !== undefined) {
    if (notes !== null && typeof notes !== "string") return { ok: false, error: "notes must be a string or null" };
    if (typeof notes === "string" && notes.length > MAX_NOTES_LENGTH) {
      return { ok: false, error: `notes must be at most ${MAX_NOTES_LENGTH} characters` };
    }
    update.notes = notes as string | null;
  }
  const d = body.scheduled_launch_date;
  if (d !== undefined) {
    if (d !== null && (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) {
      return { ok: false, error: "scheduled_launch_date must be YYYY-MM-DD or null" };
    }
    update.scheduled_launch_date = d as string | null;
  }
  return { ok: true, update };
}
