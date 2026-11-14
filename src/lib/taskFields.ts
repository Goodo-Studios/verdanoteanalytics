// ClickUp fields in the task modal: pure helpers. The data is os_tasks (columns plus
// clickup_fields, the array of every custom field), loaded by useTaskDetail and edited by
// useTaskEdit. Nothing here touches the network.
import type { TaskDetail } from "@/hooks/useMyWork";

/** One ClickUp custom field as the sync stores it (os_tasks.clickup_fields). */
export interface FieldEntry {
  id: string;
  name: string;
  type: string;
  /** Canonical text of the value: drop-down option name, YYYY-MM-DD, "true"/"false", text, number. */
  display: string | null;
  options?: Array<{ id: string; name: string }>;
}

/** The field types the app edits (and writes back). Everything else is shown, not edited. */
export const EDITABLE_FIELD_TYPES: readonly string[] = [
  "short_text",
  "text",
  "url",
  "email",
  "phone",
  "number",
  "currency",
  "date",
  "drop_down",
  "checkbox",
];

export function isEditableField(type: string | null | undefined): boolean {
  return EDITABLE_FIELD_TYPES.includes(type ?? "");
}

/** Keeps only well-formed entries, so a bad answer shows fewer fields rather than a broken modal. */
export function toFieldEntries(raw: unknown): FieldEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: FieldEntry[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r.id !== "string" || !r.id) continue;
    const options = Array.isArray(r.options)
      ? (r.options as Array<Record<string, unknown>>)
          .filter((o) => o && typeof o.id === "string" && typeof o.name === "string" && o.name)
          .map((o) => ({ id: String(o.id), name: String(o.name) }))
      : undefined;
    out.push({
      id: r.id,
      name: typeof r.name === "string" && r.name ? r.name : r.id,
      type: typeof r.type === "string" ? r.type : "",
      display: typeof r.display === "string" ? r.display : null,
      ...(options ? { options } : {}),
    });
  }
  return out;
}

export const PRIORITY_CHOICES = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
] as const;

/** The brief text the modal shows and edits. A ClickUp task uses ClickUp's description. */
export function briefOf(d: Pick<TaskDetail, "brief" | "description" | "description_markdown" | "clickup_task_id"> | null | undefined): string {
  if (!d) return "";
  if (d.clickup_task_id) return d.description_markdown ?? d.description ?? d.brief ?? "";
  return d.brief ?? d.description_markdown ?? d.description ?? "";
}

/** The columns an edit of the brief writes: ClickUp tasks keep both forms of the description in step. */
export function briefUpdate(clickup: boolean, text: string): Record<string, string | null> {
  const value = text.trim() ? text : null;
  return clickup ? { description_markdown: value, description: value } : { brief: value };
}

/** "1h 30m" for a time estimate in milliseconds, or null when there is none. */
export function formatEstimate(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const minutes = Math.round(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** A person as text: name, else email. */
export function personText(p: { username?: string | null; email?: string | null } | null | undefined): string | null {
  if (!p) return null;
  return p.username?.trim() || p.email?.trim() || null;
}

/** True for a value that can go in a link. */
export function isWebLink(v: string | null | undefined): boolean {
  return !!v && /^https?:\/\/\S+$/i.test(v);
}
