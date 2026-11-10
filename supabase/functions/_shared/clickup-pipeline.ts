// Pure logic for the ClickUp -> pipeline_tasks sync (sync-clickup-tasks).
//
// ClickUp replaced Coda as the task system on 2026-10-09. The client-facing
// Content Pipeline board (/pipeline) keeps the same five columns it had under
// Coda; this module decides which ClickUp tasks reach the board and which
// column each one lands in. Nothing here talks to the network or the database,
// so it is covered by plain Deno unit tests.
//
// What a client may see is decided HERE, not in the page: the sync only writes
// the client-safe fields (name, column, due date, content type). The raw
// ClickUp status, assignees, hours, QA results, briefs and links never reach
// pipeline_tasks.
//
// "Link to Asset" (the Air link) is deliberately not synced. A read-only sample
// on 2026-11-09 found every value in the same app.air.inc/a/<id> shape, in
// internal stages as well as client-facing ones, and briefs use that same shape
// for raw creator footage. The shape alone cannot tell a client share link from
// an internal one, so the link stays out until there is a rule that can.

// The "Client Operations/Views" space. One folder per client, each holding a
// "{Client} Project View" list with one task per asset.
export const CLICKUP_CLIENT_SPACE_ID = "90146671303";

// ClickUp status (lowercase, as the API returns it) -> board column.
// Read live from the workspace on 2026-11-09: 21 statuses, the same names in
// every client list (Barriere, Pretty Tasty Tea and Unbound Snacks carry their
// own copy of the list with identical names, so mapping by name covers them).
//
// Grouping follows the 2026-06-02 operator decisions made for the Coda board:
//   - "Preparing Content"  <- not started, brief authoring, client brief review.
//   - "Production"         <- shoot and creator stages up to the edit handoff.
//   - "Editing"            <- post-production, internal review, QA, exports and
//                             "client revisions" (kept here so a client does not
//                             read it as "your turn to act").
//   - "Client Review"      <- sent to, or waiting on, the client.
//   - "Ready to Launch"    <- approved or delivered. Windowed to the recent
//                             past (LAUNCH_WINDOW_DAYS) so it reads as "just
//                             shipped", not an all-time archive.
// "stuck" is deliberately absent: it is internal status noise and is skipped.
export const STAGE_MAP: Record<string, string> = {
  "assigned": "Preparing Content",
  "brief creation": "Preparing Content",
  "client brief review": "Preparing Content",
  "ready to shoot": "Production",
  "ready for creator": "Production",
  "shooting client": "Production",
  "ready to edit": "Production",
  "ready for editing queue": "Editing",
  "editing": "Editing",
  "internal review": "Editing",
  "internal review edits": "Editing",
  "quality assurance review": "Editing",
  "export versions": "Editing",
  "versions exported": "Editing",
  "client revisions": "Editing",
  "ready to send to client": "Client Review",
  "client review": "Client Review",
  "ready to transfer": "Ready to Launch",
  "ready for launch": "Ready to Launch",
  "complete": "Ready to Launch",
};

export const SKIP_STATUSES = new Set<string>(["stuck"]);

export const LAUNCH_STAGE = "Ready to Launch";
export const LAUNCH_WINDOW_DAYS = 30;

export type StageDecision =
  | { kind: "stage"; stage: string }
  | { kind: "skip" }
  | { kind: "unknown"; status: string };

/**
 * Board column for a raw ClickUp status. A status that is not in STAGE_MAP is
 * reported as unknown and NOT synced: showing an unmapped internal label to a
 * client is worse than leaving one card off the board until the map is updated.
 */
export function decideStage(rawStatus: string | null | undefined): StageDecision {
  const status = (rawStatus ?? "").trim().toLowerCase();
  if (!status) return { kind: "skip" };
  if (SKIP_STATUSES.has(status)) return { kind: "skip" };
  const stage = STAGE_MAP[status];
  if (stage) return { kind: "stage", stage };
  return { kind: "unknown", status };
}

/**
 * Only asset tasks belong on the client board. Every deliverable is named
 * "{Month} Asset {N} ..." (the same name search the client Assets view in
 * ClickUp uses). Shoot days, creator production and onboarding checklist tasks
 * live in the same list and must not appear.
 */
export function isAssetTask(name: string | null | undefined): boolean {
  return /\basset\s*\d+/i.test(name ?? "");
}

export function cleanTaskName(name: string | null | undefined): string | null {
  const cleaned = (name ?? "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

/** ClickUp sends dates as millisecond epoch strings. Returns YYYY-MM-DD or null. */
export function toIsoDate(ms: string | number | null | undefined): string | null {
  if (ms === null || ms === undefined || ms === "") return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString().slice(0, 10);
}

export interface ClickUpCustomField {
  name?: string;
  type?: string;
  value?: unknown;
  type_config?: { options?: { id?: string; name?: string; orderindex?: number }[] };
}

/**
 * Selected option name of a dropdown custom field, or null. ClickUp returns the
 * selected option either as its orderindex (number) or as its option id.
 */
export function dropdownValue(
  fields: ClickUpCustomField[] | null | undefined,
  fieldName: string,
): string | null {
  const field = (fields ?? []).find((f) => f.name === fieldName);
  if (!field || field.value === null || field.value === undefined || field.value === "") {
    return null;
  }
  const options = field.type_config?.options ?? [];
  const value = field.value;
  const match = options.find(
    (o) =>
      (typeof value === "number" && o.orderindex === value) ||
      (typeof value === "string" && (o.id === value || String(o.orderindex) === value)),
  );
  return match?.name ?? null;
}

/**
 * True when the "Clear Task" dropdown is set to "true". Staff use it to pull a
 * finished task off the board regardless of its status (same rule as under Coda).
 */
export function isClearedTask(fields: ClickUpCustomField[] | null | undefined): boolean {
  return (dropdownValue(fields, "Clear Task") ?? "").trim().toLowerCase() === "true";
}

export function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "Royo - Ending October" -> "Royo". Folder names carry the commercial state as a suffix. */
export function cleanFolderName(name: string): string {
  return name.replace(/\s+-\s+ending\b.*$/i, "").trim();
}

// ClickUp folder name -> ad_accounts.name, for clients whose folder name does not
// contain the full account name. Only add an entry for a real client with an ad
// account. "Miracle" is ambiguous between the two Miracle accounts without it.
export const ACCOUNT_NAME_ALIASES: Record<string, string> = {
  "Miracle": "Miracle Brand",
};

/**
 * One client from the `clients` list (key: slug), with the ad accounts linked to
 * it in `client_ad_accounts`. `accountIds` holds every linked ad account;
 * `accountNames` holds the names of the linked ad accounts that are active, which
 * are matched against folder names alongside the client's own name.
 */
export interface ClientRow {
  slug: string;
  name: string;
  accountIds: string[];
  accountNames: string[];
}

export type FolderResolution =
  | { kind: "client"; slug: string; via: "mapping" | "name" }
  | { kind: "none"; reason: "unmatched" | "ambiguous" | "stale_mapping" };

/**
 * Resolve a ClickUp client folder to a client (`clients.slug`). Returns no
 * client rather than guess: a wrong match would show one client another
 * client's work.
 *
 * Order:
 *   1. An active `source_mappings` row (provider clickup, kind folder), set by
 *      staff. A mapping to a client that is missing or inactive is not followed
 *      and not replaced by a name guess.
 *   2. Exact normalised name match against client names and the names of their
 *      linked active ad accounts.
 *   3. Alias (ACCOUNT_NAME_ALIASES), looked up the same way.
 *   4. Constrained fuzzy: a client or ad account name of 4+ characters fully
 *      contained in the folder name.
 * Steps 2 to 4 resolve only when every matching name belongs to one client.
 * Names of two different clients matching is reported as ambiguous.
 */
export function resolveClientSlug(
  folder: { id: string; name: string },
  clients: ClientRow[],
  mappings: Record<string, string>,
): FolderResolution {
  const known = new Set(clients.map((c) => c.slug));
  const mapped = mappings[folder.id];
  if (mapped) {
    return known.has(mapped)
      ? { kind: "client", slug: mapped, via: "mapping" }
      : { kind: "none", reason: "stale_mapping" };
  }

  // normalised name -> every client that carries it (own name or an ad account name)
  const lookup = new Map<string, Set<string>>();
  for (const c of clients) {
    for (const n of [c.name, ...c.accountNames]) {
      const k = normalise(n ?? "");
      if (!k) continue;
      if (!lookup.has(k)) lookup.set(k, new Set());
      lookup.get(k)!.add(c.slug);
    }
  }

  const decide = (slugs: Set<string>): FolderResolution | null => {
    if (slugs.size === 1) return { kind: "client", slug: [...slugs][0], via: "name" };
    if (slugs.size > 1) return { kind: "none", reason: "ambiguous" };
    return null;
  };

  const key = normalise(cleanFolderName(folder.name));
  if (!key) return { kind: "none", reason: "unmatched" };

  const exact = lookup.get(key);
  if (exact) return decide(exact)!;

  for (const [label, accountName] of Object.entries(ACCOUNT_NAME_ALIASES)) {
    if (normalise(label) === key) {
      const aliased = lookup.get(normalise(accountName));
      if (aliased) return decide(aliased)!;
    }
  }

  const candidates = new Set<string>();
  for (const [k, slugs] of lookup) {
    if (k.length >= 4 && key.includes(k)) for (const s of slugs) candidates.add(s);
  }
  return decide(candidates) ?? { kind: "none", reason: "unmatched" };
}

/**
 * The ad account written on a client's board rows. Only when the client has
 * exactly one linked ad account: the /pipeline page filters by ad account, and
 * with two or more there is no single right one, so none is written.
 */
export function boardAccountId(client: ClientRow): string | null {
  return client.accountIds.length === 1 ? client.accountIds[0] : null;
}

/** The one "{Client} Project View" list in a client folder, or null if there is not exactly one. */
export function pickProjectList(
  lists: { id: string; name: string }[] | null | undefined,
): { id: string; name: string } | null {
  const matches = (lists ?? []).filter((l) => /project view\s*$/i.test(l.name ?? ""));
  return matches.length === 1 ? matches[0] : null;
}

export interface ClickUpTask {
  id: string;
  name?: string;
  status?: { status?: string };
  due_date?: string | null;
  date_updated?: string | null;
  date_closed?: string | null;
  custom_fields?: ClickUpCustomField[];
}

/** Who a board row belongs to: always a client, and an ad account when there is exactly one. */
export interface BoardOwner {
  client_slug: string;
  account_id: string | null;
}

export interface PipelineRecord {
  clickup_task_id: string;
  client_slug: string;
  account_id: string | null;
  task_name: string | null;
  stage: string;
  due_date: string | null;
  content_type: string | null;
  synced_at: string;
  updated_at: string;
}

export type TaskOutcome =
  | { kind: "record"; record: PipelineRecord }
  | { kind: "skip" }
  | { kind: "unknown"; status: string };

/** Turn one ClickUp task into a client-safe pipeline row, or say why it is left out. */
export function toPipelineRecord(
  task: ClickUpTask,
  owner: BoardOwner,
  nowMs: number,
): TaskOutcome {
  if (!task?.id || !isAssetTask(task.name)) return { kind: "skip" };
  if (isClearedTask(task.custom_fields)) return { kind: "skip" };

  const decision = decideStage(task.status?.status);
  if (decision.kind === "skip") return { kind: "skip" };
  if (decision.kind === "unknown") return decision;

  if (decision.stage === LAUNCH_STAGE) {
    const touched = Number(task.date_closed ?? task.date_updated ?? NaN);
    const cutoff = nowMs - LAUNCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(touched) || touched < cutoff) return { kind: "skip" };
  }

  const nowIso = new Date(nowMs).toISOString();
  return {
    kind: "record",
    record: {
      clickup_task_id: task.id,
      client_slug: owner.client_slug,
      account_id: owner.account_id,
      task_name: cleanTaskName(task.name),
      stage: decision.stage,
      due_date: toIsoDate(task.due_date),
      content_type: dropdownValue(task.custom_fields, "Type of Content"),
      synced_at: nowIso,
      updated_at: nowIso,
    },
  };
}
