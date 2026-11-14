// ClickUp task JSON -> os_tasks row (Goodo OS story OS-007). Pure: no network, no database.
//
// Used by clickup-os-sync (full and nightly walks) and clickup-webhook (one task per event).
//
// Rules:
//   * Custom fields are found by field id, falling back to the field name.
//   * Drop-downs arrive as the option orderindex or the option id; both resolve to the option name.
//   * Dates arrive as millisecond epoch strings and are stored as YYYY-MM-DD.
//   * "stuck" is a ClickUp flag, not a workflow step: the row keeps its last real status (or, for a
//     new row, the first status of its list, else "assigned"), is_stuck is true and stuck_reason is
//     "Stuck in ClickUp". raw_status always holds the exact ClickUp status.
//   * is_asset: the task sits in a "{Client} Project View" list of the Client Operations space.
//   * The strategist, producer and editor are returned as emails; the sync maps them to logins
//     through os_user_ids_by_email and leaves the uuid empty when there is no match.

import { CLICKUP_CLIENT_SPACE_ID, parseCycleMonth } from "./clickup-pipeline.ts";

export const CLICKUP_TEAM_ID = "90141422254";
export const PRODUCTION_SPACE_ID = "90147169333";
export const SOCIAL_SPACE_ID = "90149054875";
export const OS_SPACE_IDS: readonly string[] = [CLICKUP_CLIENT_SPACE_ID, PRODUCTION_SPACE_ID, SOCIAL_SPACE_ID];

/** Folders of clients that are ending: imported as read-only history. */
export const ENDING_CLIENT_FOLDER_IDS: ReadonlySet<string> = new Set([
  "901410981854", // Cattasaurus
  "901411271481", // Marek - Ending September 1
  "901411270208", // Miracle - Ending October
  "901411490908", // Royo - Ending October
]);

export const STUCK_STATUS = "stuck";
export const STUCK_REASON = "Stuck in ClickUp";
export const DEFAULT_STATUS = "assigned";

/** Custom field ids on the Project View lists, with the field name used as the fallback. */
export const FIELDS = {
  producer: { id: "055725bf-639e-4815-8ae2-489c90845bd8", name: "Producer" },
  editor: { id: "20543497-c0e6-4048-9bab-b2bf136f5dc0", name: "Editor" },
  strategist: { id: "2be772ed-8471-4f54-9d7f-fc2e0ec8b8c2", name: "Strategist" },
  reviewedBy: { id: "0c2895bf-ef32-436d-803a-f24aa422a791", name: "Reviewed By" },
  brief: { id: "3e648b5f-3a26-431a-b66d-af2045aea09f", name: "Brief" },
  contentType: { id: "f58bc404-0076-4b16-8950-1fce77e04b2a", name: "Type of Content" },
  assetLink: { id: "43b89e72-8575-49e6-bf6a-fc90f373291c", name: "Link to Asset" },
  hook1: { id: "0c49e3b4-6081-4294-9fc6-59f461a0da30", name: "Goodo Ad Name Hook 1" },
  hook2: { id: "6a1c6c8f-4565-4075-8f57-fbc34b503096", name: "Goodo Ad Name Hook 2" },
  qaPolish: { id: "09fbee68-46a7-4e31-b171-036ed54cee4b", name: "Overall Polish" },
  qaStory: { id: "29044382-5abb-49f8-8c04-e30c288fc0a4", name: "Story & Pacing" },
  qaAudio: { id: "4e796124-2998-4963-8319-7fafdaefa677", name: "Audio & Captions" },
  qaVisual: { id: "aa2217b3-6e72-49fc-88cc-6184a80f5d94", name: "Visual Quality" },
  briefDue: { id: "91bf5fcc-9265-4c23-86b2-ce160074f2aa", name: "Brief due" },
  cutToStrategist: { id: "7e861db2-ba22-404f-9cfa-9b5e46a97e57", name: "Cut to strategist" },
  cutToClient: { id: "255abb81-9c9f-494a-aef1-6a12b548beb5", name: "Cut to client" },
  editDue: { id: "004366be-af82-4c83-8ca6-cb40ba19d561", name: "Edit due" },
  productionDate: { id: "5ffd8b36-aef5-45eb-907b-cdac4413b771", name: "Production Date" },
  briefHandedOff: { id: "f37e2dc8-8fd4-452d-ae8c-62efc69ed9f1", name: "Brief handed off" },
} as const;

export type FieldRef = { id: string; name: string };

const QA_FIELDS: FieldRef[] = [FIELDS.qaPolish, FIELDS.qaStory, FIELDS.qaAudio, FIELDS.qaVisual];

export interface CuField {
  id?: string;
  name?: string;
  type?: string;
  value?: unknown;
  type_config?: { options?: { id?: string; name?: string; orderindex?: number | string }[] };
}

export interface CuUser {
  id?: number | string;
  username?: string | null;
  email?: string | null;
}

export interface CuTask {
  id: string;
  name?: string | null;
  text_content?: string | null;
  description?: string | null;
  status?: { status?: string | null } | null;
  due_date?: string | number | null;
  date_created?: string | number | null;
  date_updated?: string | number | null;
  parent?: string | null;
  url?: string | null;
  markdown_description?: string | null;
  priority?: { priority?: string | null } | null;
  start_date?: string | number | null;
  tags?: { name?: string | null }[] | null;
  creator?: CuUser | null;
  time_estimate?: string | number | null;
  assignees?: CuUser[] | null;
  custom_fields?: CuField[] | null;
  list?: { id?: string; name?: string } | null;
  folder?: { id?: string; name?: string; hidden?: boolean } | null;
  space?: { id?: string } | null;
}

export interface MapContext {
  clientSlug: string | null;
  spaceId: string;
  list: { id: string; name: string };
  readOnly: boolean;
  /** Status of the app row before this sync, or null for a new row. */
  previousStatus: string | null;
  /** The first (lowest orderindex) status of the task's list, for a new stuck task. */
  listFirstStatus?: string | null;
  nowIso: string;
}

export interface OsTaskRow {
  clickup_task_id: string;
  client_slug: string | null;
  title: string;
  status: string;
  raw_status: string | null;
  is_stuck: boolean;
  stuck_reason: string | null;
  due_date: string | null;
  content_type: string | null;
  cycle_month: string | null;
  asset_url: string | null;
  hooks: string[];
  qa_checklist: { item: string; result: string }[];
  description: string | null;
  /** ClickUp's markdown description; the app edits and writes back this one. */
  description_markdown: string | null;
  /** urgent, high, normal or low; null when ClickUp has none. */
  priority: string | null;
  start_date: string | null;
  clickup_tags: string[];
  clickup_created_at: string | null;
  clickup_creator: { id: string; username: string | null; email: string | null } | null;
  time_estimate_ms: number | null;
  /** Every custom field of the task as ClickUp returns it (see FieldEntry). */
  clickup_fields: FieldEntry[];
  clickup_space_id: string;
  clickup_list_id: string;
  clickup_list_name: string;
  clickup_parent_id: string | null;
  assignees: { id: string; username: string | null; email: string | null }[];
  reviewed_by: { id: string; username: string | null; email: string | null }[];
  brief_type: string | null;
  brief_due_date: string | null;
  cut_to_strategist_date: string | null;
  cut_to_client_date: string | null;
  edit_due_date: string | null;
  production_date: string | null;
  brief_handed_off_date: string | null;
  is_asset: boolean;
  read_only: boolean;
  clickup_url: string | null;
  clickup_updated_at: string | null;
  last_synced_at: string;
}

export interface MappedTask {
  row: OsTaskRow;
  /** Emails of the people custom fields, for os_user_ids_by_email. */
  people: { strategist: string | null; producer: string | null; editor: string | null };
}

/** Lower-cased, trimmed status, the key used in os_task_statuses. */
export function normaliseStatus(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  return s || null;
}

export function findField(fields: CuField[] | null | undefined, ref: FieldRef): CuField | null {
  const list = fields ?? [];
  const byId = list.find((f) => f.id === ref.id);
  if (byId) return byId;
  const want = ref.name.trim().toLowerCase();
  return list.find((f) => (f.name ?? "").trim().toLowerCase() === want) ?? null;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Selected drop-down option name; the value is an orderindex (number or string) or an option id. */
export function dropdownName(field: CuField | null): string | null {
  if (!field || isEmpty(field.value)) return null;
  const v = field.value;
  const options = field.type_config?.options ?? [];
  const match = options.find(
    (o) =>
      (typeof v === "number" && Number(o.orderindex) === v) ||
      (typeof v === "string" && (o.id === v || String(o.orderindex) === v)),
  );
  const name = (match?.name ?? "").trim();
  return name || null;
}

export function textValue(field: CuField | null): string | null {
  if (!field || typeof field.value !== "string") return null;
  const t = field.value.trim();
  return t || null;
}

/** Milliseconds epoch (string or number) -> YYYY-MM-DD, or null. */
export function msToDate(ms: unknown): string | null {
  if (isEmpty(ms)) return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString().slice(0, 10);
}

export function msToIso(ms: unknown): string | null {
  if (isEmpty(ms)) return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

export function dateField(field: CuField | null): string | null {
  return field ? msToDate(field.value) : null;
}

function cleanUser(u: CuUser | null | undefined): { id: string; username: string | null; email: string | null } | null {
  if (!u || isEmpty(u.id)) return null;
  const email = (u.email ?? "").trim().toLowerCase() || null;
  return { id: String(u.id), username: (u.username ?? "").trim() || null, email };
}

export function usersOf(list: CuUser[] | null | undefined): { id: string; username: string | null; email: string | null }[] {
  return (Array.isArray(list) ? list : []).map(cleanUser).filter((u): u is NonNullable<typeof u> => !!u);
}

export function usersField(field: CuField | null): { id: string; username: string | null; email: string | null }[] {
  return field && Array.isArray(field.value) ? usersOf(field.value as CuUser[]) : [];
}

function firstEmail(field: CuField | null): string | null {
  return usersField(field).find((u) => u.email)?.email ?? null;
}

/** An http(s) link with no spaces or credentials, else null (the column requires ^https?://). */
export function safeLink(raw: string | null): string | null {
  if (!raw || /\s/.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return raw;
  } catch {
    return null;
  }
}

export function qaChecklist(fields: CuField[] | null | undefined): { item: string; result: string }[] {
  const out: { item: string; result: string }[] = [];
  for (const ref of QA_FIELDS) {
    const result = dropdownName(findField(fields, ref));
    if (result) out.push({ item: ref.name, result: result.toUpperCase() });
  }
  return out;
}

export function hooksOf(fields: CuField[] | null | undefined): string[] {
  return [FIELDS.hook1, FIELDS.hook2]
    .map((ref) => textValue(findField(fields, ref)))
    .filter((h): h is string => !!h);
}

// ------------------------------------------------------------------ all custom fields, priority, tags

export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
/** ClickUp's numeric priority for the app's name (PUT /task/{id} {priority}). */
export const PRIORITY_IDS: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4 };

/** urgent, high, normal or low, or null. */
export function priorityName(p: { priority?: string | null } | null | undefined): string | null {
  const v = (p?.priority ?? "").trim().toLowerCase();
  return (PRIORITIES as readonly string[]).includes(v) ? v : null;
}

export function tagNames(tags: { name?: string | null }[] | null | undefined): string[] {
  return (Array.isArray(tags) ? tags : []).map((t) => (t?.name ?? "").trim()).filter((n) => n.length > 0);
}

export function positiveNumber(v: unknown): number | null {
  if (isEmpty(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * One ClickUp custom field as stored in os_tasks.clickup_fields. `display` is the canonical text of
 * the value, the same form the app edits and the write-back compares: the option name of a
 * drop-down, YYYY-MM-DD for a date, "true" or "false" for a checkbox, the trimmed text, the
 * number, or the people / labels joined with ", ". It is null when the field is empty.
 */
export interface FieldEntry {
  id: string;
  name: string;
  type: string;
  display: string | null;
  /** Choices of a drop-down or labels field. */
  options?: { id: string; name: string }[];
}

/** Field types the app can edit and write back. Everything else is shown read-only. */
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

export function isEditableFieldType(type: string | null | undefined): boolean {
  return EDITABLE_FIELD_TYPES.includes(type ?? "");
}

export function fieldDisplay(f: CuField): string | null {
  const v = f.value;
  switch (f.type) {
    case "drop_down":
      return dropdownName(f);
    case "date":
      return dateField(f);
    case "checkbox":
      return v === true || v === "true" ? "true" : "false";
    case "users":
      return usersField(f).map((u) => u.email ?? u.username ?? u.id).join(", ") || null;
    case "labels": {
      const ids = Array.isArray(v) ? v.map(String) : [];
      const names = (f.type_config?.options ?? []).filter((o) => ids.includes(String(o.id))).map((o) => (o.name ?? "").trim());
      return names.filter(Boolean).join(", ") || null;
    }
    case "number":
    case "currency": {
      if (isEmpty(v)) return null;
      const n = Number(v);
      return Number.isFinite(n) ? String(n) : null;
    }
    default:
      if (typeof v === "string") return v.trim() || null;
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      return null;
  }
}

export function fieldEntry(f: CuField): FieldEntry | null {
  if (!f || isEmpty(f.id)) return null;
  const type = f.type ?? "";
  const entry: FieldEntry = { id: String(f.id), name: (f.name ?? "").trim() || String(f.id), type, display: fieldDisplay(f) };
  if (type === "drop_down" || type === "labels") {
    entry.options = (f.type_config?.options ?? [])
      .filter((o) => !isEmpty(o.id) && (o.name ?? "").trim())
      .map((o) => ({ id: String(o.id), name: String(o.name).trim() }));
  }
  return entry;
}

export function fieldEntries(fields: CuField[] | null | undefined): FieldEntry[] {
  return (fields ?? []).map(fieldEntry).filter((e): e is FieldEntry => !!e);
}

/**
 * The os_tasks columns that mirror a custom field, by field id. The app keeps both in step when a
 * person edits one of these fields (os_set_task_field does the same in SQL).
 */
export const FIELD_COLUMNS: Record<string, string[]> = {
  [FIELDS.contentType.id]: ["content_type"],
  [FIELDS.assetLink.id]: ["asset_url"],
  [FIELDS.brief.id]: ["brief_type"],
  [FIELDS.hook1.id]: ["hooks"],
  [FIELDS.hook2.id]: ["hooks"],
  [FIELDS.briefDue.id]: ["brief_due_date"],
  [FIELDS.cutToStrategist.id]: ["cut_to_strategist_date"],
  [FIELDS.cutToClient.id]: ["cut_to_client_date"],
  [FIELDS.editDue.id]: ["edit_due_date"],
  [FIELDS.productionDate.id]: ["production_date"],
  [FIELDS.briefHandedOff.id]: ["brief_handed_off_date"],
};

/** Column values that follow a set of field entries (only for the mirrored fields present). */
export function columnsFromEntries(entries: FieldEntry[]): Record<string, unknown> {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out: Record<string, unknown> = {};
  const set = (col: string, ref: FieldRef, f: (e: FieldEntry) => unknown) => {
    const e = byId.get(ref.id);
    if (e) out[col] = f(e);
  };
  set("content_type", FIELDS.contentType, (e) => e.display);
  set("asset_url", FIELDS.assetLink, (e) => safeLink(e.display));
  set("brief_type", FIELDS.brief, (e) => e.display);
  set("brief_due_date", FIELDS.briefDue, (e) => e.display);
  set("cut_to_strategist_date", FIELDS.cutToStrategist, (e) => e.display);
  set("cut_to_client_date", FIELDS.cutToClient, (e) => e.display);
  set("edit_due_date", FIELDS.editDue, (e) => e.display);
  set("production_date", FIELDS.productionDate, (e) => e.display);
  set("brief_handed_off_date", FIELDS.briefHandedOff, (e) => e.display);
  if (byId.has(FIELDS.hook1.id) || byId.has(FIELDS.hook2.id)) {
    out.hooks = [byId.get(FIELDS.hook1.id)?.display, byId.get(FIELDS.hook2.id)?.display].filter((h): h is string => !!h);
  }
  return out;
}

/** A "{Client} Project View" list in the Client Operations space. */
export function isAssetList(spaceId: string, listName: string): boolean {
  return spaceId === CLICKUP_CLIENT_SPACE_ID && /project view\s*$/i.test(listName ?? "");
}

/** The status the row keeps, given the ClickUp status and the row's previous status. */
export function decideStatus(
  rawStatus: string | null | undefined,
  previousStatus: string | null,
  listFirstStatus?: string | null,
): { status: string; isStuck: boolean } {
  const key = normaliseStatus(rawStatus);
  if (key === STUCK_STATUS) {
    const kept = normaliseStatus(previousStatus) ?? normaliseStatus(listFirstStatus);
    return { status: kept && kept !== STUCK_STATUS ? kept : DEFAULT_STATUS, isStuck: true };
  }
  return { status: key ?? normaliseStatus(previousStatus) ?? DEFAULT_STATUS, isStuck: false };
}

export function mapTask(task: CuTask, ctx: MapContext): MappedTask {
  const fields = task.custom_fields ?? [];
  const raw = task.status?.status ?? null;
  const { status, isStuck } = decideStatus(raw, ctx.previousStatus, ctx.listFirstStatus);
  const title = (task.name ?? "").replace(/\s+/g, " ").trim() || "(untitled ClickUp task)";
  const refMs = Number(task.due_date ?? task.date_created ?? Date.parse(ctx.nowIso));
  const description = (task.text_content ?? "").trim() || null;

  const row: OsTaskRow = {
    clickup_task_id: String(task.id),
    client_slug: ctx.clientSlug,
    title,
    status,
    raw_status: raw,
    is_stuck: isStuck,
    stuck_reason: isStuck ? STUCK_REASON : null,
    due_date: msToDate(task.due_date),
    content_type: dropdownName(findField(fields, FIELDS.contentType)),
    cycle_month: parseCycleMonth(title, refMs),
    asset_url: safeLink(textValue(findField(fields, FIELDS.assetLink))),
    hooks: hooksOf(fields),
    qa_checklist: qaChecklist(fields),
    description,
    description_markdown: (task.markdown_description ?? "").trim() || null,
    priority: priorityName(task.priority),
    start_date: msToDate(task.start_date),
    clickup_tags: tagNames(task.tags),
    clickup_created_at: msToIso(task.date_created),
    clickup_creator: cleanUser(task.creator),
    time_estimate_ms: positiveNumber(task.time_estimate),
    clickup_fields: fieldEntries(fields),
    clickup_space_id: ctx.spaceId,
    clickup_list_id: ctx.list.id,
    clickup_list_name: ctx.list.name,
    clickup_parent_id: task.parent ? String(task.parent) : null,
    assignees: usersOf(task.assignees),
    reviewed_by: usersField(findField(fields, FIELDS.reviewedBy)),
    brief_type: dropdownName(findField(fields, FIELDS.brief)),
    brief_due_date: dateField(findField(fields, FIELDS.briefDue)),
    cut_to_strategist_date: dateField(findField(fields, FIELDS.cutToStrategist)),
    cut_to_client_date: dateField(findField(fields, FIELDS.cutToClient)),
    edit_due_date: dateField(findField(fields, FIELDS.editDue)),
    production_date: dateField(findField(fields, FIELDS.productionDate)),
    brief_handed_off_date: dateField(findField(fields, FIELDS.briefHandedOff)),
    is_asset: isAssetList(ctx.spaceId, ctx.list.name),
    read_only: ctx.readOnly,
    clickup_url: safeLink((task.url ?? "").trim() || null),
    clickup_updated_at: msToIso(task.date_updated),
    last_synced_at: ctx.nowIso,
  };

  return {
    row,
    people: {
      strategist: firstEmail(findField(fields, FIELDS.strategist)),
      producer: firstEmail(findField(fields, FIELDS.producer)),
      editor: firstEmail(findField(fields, FIELDS.editor)),
    },
  };
}

/** The first status of a list (lowest orderindex), ignoring "stuck". */
export function firstListStatus(statuses: { status?: string; orderindex?: number | string }[] | null | undefined): string | null {
  const sorted = [...(statuses ?? [])]
    .filter((s) => normaliseStatus(s.status) && normaliseStatus(s.status) !== STUCK_STATUS)
    .sort((a, b) => Number(a.orderindex ?? 0) - Number(b.orderindex ?? 0));
  return normaliseStatus(sorted[0]?.status) ?? null;
}

// ------------------------------------------------------------------ nightly comparison

/** Fields compared between the app row and ClickUp before a nightly run overwrites the app. */
export const COMPARED_FIELDS = [
  "title",
  "client_slug",
  "status",
  "raw_status",
  "is_stuck",
  "due_date",
  "content_type",
  "brief_type",
  "asset_url",
  "hooks",
  "qa_checklist",
  "description",
  "description_markdown",
  "priority",
  "start_date",
  "clickup_list_id",
  "brief_due_date",
  "cut_to_strategist_date",
  "cut_to_client_date",
  "edit_due_date",
  "production_date",
  "brief_handed_off_date",
  "read_only",
] as const;

export type ComparedField = (typeof COMPARED_FIELDS)[number];

export interface Discrepancy {
  clickup_task_id: string;
  field: ComparedField;
  app_value: string | null;
  clickup_value: string | null;
}

/** Stable text form of a value for comparison and storage. Empty arrays and "" count as null. */
export function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v === "" ? null : v;
  if (Array.isArray(v)) return v.length === 0 ? null : JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Every compared field where the app row differs from the ClickUp row. */
export function diffTask(app: Record<string, unknown>, clickup: OsTaskRow): Discrepancy[] {
  const out: Discrepancy[] = [];
  for (const field of COMPARED_FIELDS) {
    let a = asText(app[field]);
    const c = asText(clickup[field]);
    // Postgres can return a date column with a time part through some clients.
    if (a && c && /_date$/.test(field)) a = a.slice(0, 10);
    if (a !== c) out.push({ clickup_task_id: clickup.clickup_task_id, field, app_value: a, clickup_value: c });
  }
  return out;
}
