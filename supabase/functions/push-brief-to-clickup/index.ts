import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { clickUpWritePolicy, mayWriteToList, READ_ONLY_MESSAGE } from "../_shared/clickup-write-guard.ts";
import { type Caller, resolveCaller } from "../_shared/internal-auth.ts";
import {
  CLICKUP_CLIENT_SPACE_ID,
  type ClientRow,
  isAssetTask,
  pickProjectList,
  resolveClientSlug,
} from "../_shared/clickup-pipeline.ts";
import {
  BRIEF_STATUS,
  buildBriefDescription,
  type ClickUpBriefTask,
  cleanTitle,
  type CreativeReference,
  currentMonthName,
  HTML_TAG,
  isDescriptionEmpty,
  isPickable,
  MAX_BODY_CHARS,
  newTaskName,
  nextAssetNumber,
  assetNumber,
  SAFE_ACCOUNT_ID,
  SAFE_AD_ID,
  SAFE_CLIENT_SLUG,
  SAFE_TASK_ID,
  taskStatus,
  taskUrl,
} from "../_shared/clickup-brief.ts";

// Push a brief to ClickUp (replaces "Push to Coda" and "Create brief in Coda";
// Coda was retired on 2026-10-09 and ClickUp is the task system).
//
// POST { action: "list", client_slug | account_id }
//   -> the client's asset tasks that can take a brief: asset name, empty
//      description, status "assigned" or "brief creation". Read-only.
// POST { action: "push", client_slug | account_id, title, body, creative?, target }
//   target = a ClickUp task id: the task must be in the client's Project View
//            list, be an asset task and have an empty description. The brief
//            goes into the description and the status becomes "brief creation".
//            A task that already has a description is refused: a strategist's
//            work is never overwritten.
//   target = "new": creates "{Current month} Asset {next N} - {title}" in that
//            list with the brief as description and status "brief creation", and
//            with the ClickUp task type "Asset" (custom_item_id). The type id is
//            looked up by name at run time (GET /team, then
//            /team/{id}/custom_item), never hard coded. If the type cannot be
//            found or read, the task is created without a type and the answer
//            carries a plain "note" saying so. A task that already exists keeps
//            its own type.
//   -> { task_id, task_name, url, created, task_type?, note? }
// Only the description and status are written (plus the name on a new task).
// Assignees and every other field are left alone.
//
// The client's ClickUp folder is resolved the same way as sync-clickup-tasks:
// an active source_mappings row first, then the name rules. No folder, or two,
// is refused.
//
// Gate: a signed-in builder or employee. Clients and the service role are
// refused. Fails closed: without CLICKUP_API_TOKEN it answers 503 before any
// database read or ClickUp call. Staging has no token on purpose.

const CLICKUP_API = "https://api.clickup.com/api/v2";
const MAX_PAGES_PER_LIST = 20; // 100 tasks per page
export const ASSET_TASK_TYPE_NAME = "Asset";
export const NO_TASK_TYPE_NOTE =
  'The task was created without the "Asset" task type because that type could not be found in ClickUp. Set the type on the task by hand.';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface QueryResult {
  data: Record<string, string>[] | null;
  error: { message: string } | null;
}
interface QueryBuilder extends PromiseLike<QueryResult> {
  select(columns: string): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
}
export interface SupabaseLike {
  from(table: string): QueryBuilder;
}

export interface Deps {
  /** Who is calling: a 401 Response, or the caller with roles. */
  resolveCaller?: (req: Request) => Promise<Caller | Response>;
  env?: (name: string) => string | undefined;
  fetch?: FetchLike;
  db?: () => SupabaseLike;
  now?: () => Date;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class ClickUpError extends Error {
  constructor(readonly status: number, path: string) {
    super(`ClickUp API error [${status}] for ${path}`);
  }
}

class Refusal extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

function serviceClient(): SupabaseLike {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server misconfigured");
  return createClient(url, key) as unknown as SupabaseLike;
}

async function defaultResolveCaller(req: Request): Promise<Caller | Response> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server misconfigured" }, 500);
  return await resolveCaller(req, createClient(url, key));
}

function isStaffLogin(caller: Caller): boolean {
  if (caller.kind !== "user") return false;
  return caller.roles.includes("builder") || caller.roles.includes("employee");
}

function makeClickUp(token: string, fetchImpl: FetchLike, refuseAllWrites = false) {
  return async function clickup(
    path: string,
    init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {},
  ): Promise<Record<string, unknown>> {
    // Second safety net behind the list check in the handler: when this
    // environment allows no ClickUp writes at all, no non-GET request leaves.
    if (refuseAllWrites && (init.method ?? "GET") !== "GET") {
      throw new Refusal(403, READ_ONLY_MESSAGE, { read_only: true });
    }
    const res = await fetchImpl(`${CLICKUP_API}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) {
      // The body can echo request details; keep only the status.
      await res.body?.cancel();
      throw new ClickUpError(res.status, path.split("?")[0]);
    }
    return await res.json();
  };
}

type ClickUp = ReturnType<typeof makeClickUp>;

interface Input {
  action: "list" | "push";
  clientSlug: string | null;
  accountId: string | null;
  title: string;
  body: string;
  creative: CreativeReference | null;
  target: "new" | string | null;
}

function parseInput(raw: Record<string, unknown>): Input | string {
  const action = raw.action;
  if (action !== "list" && action !== "push") return 'action must be "list" or "push"';
  const clientSlug = typeof raw.client_slug === "string" && raw.client_slug.trim() ? raw.client_slug.trim() : null;
  const accountId = typeof raw.account_id === "string" && raw.account_id.trim() ? raw.account_id.trim() : null;
  if (!clientSlug && !accountId) return "client_slug or account_id is required";
  if (clientSlug && !SAFE_CLIENT_SLUG.test(clientSlug)) return "client_slug is not valid";
  if (accountId && !SAFE_ACCOUNT_ID.test(accountId)) return "account_id is not valid";
  const input: Input = { action, clientSlug, accountId, title: "", body: "", creative: null, target: null };
  if (action === "list") return input;

  input.body = typeof raw.body === "string" ? raw.body : "";
  if (!input.body.trim()) return "body (the brief) is required";
  if (input.body.length > MAX_BODY_CHARS) return `body is longer than ${MAX_BODY_CHARS} characters`;
  input.title = typeof raw.title === "string" ? cleanTitle(raw.title) : "";

  const target = raw.target;
  if (target === "new") {
    if (!input.title) return "title is required for a new asset task";
    input.target = "new";
  } else if (typeof target === "string" && SAFE_TASK_ID.test(target.trim())) {
    input.target = target.trim();
  } else {
    return 'target must be "new" or a ClickUp task id';
  }

  if (raw.creative !== undefined && raw.creative !== null) {
    const c = raw.creative as Record<string, unknown>;
    const adId = typeof c?.ad_id === "string" ? c.ad_id.trim() : "";
    if (!SAFE_AD_ID.test(adId)) return "creative.ad_id is not valid";
    input.creative = { ad_id: adId, ad_name: typeof c.ad_name === "string" ? c.ad_name : null };
  }
  return input;
}

async function read(table: string, query: PromiseLike<QueryResult>) {
  const { data, error } = await query;
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  return data ?? [];
}

/** The client's slug and every client row the folder name rules need. */
async function loadClients(db: SupabaseLike, input: Input) {
  const clientRows = await read("clients", db.from("clients").select("slug, name").eq("active", true));
  const linkRows = await read("client_ad_accounts", db.from("client_ad_accounts").select("account_id, client_slug"));
  const accountRows = await read("ad_accounts", db.from("ad_accounts").select("id, name").eq("is_active", true));
  const mappingRows = await read(
    "source_mappings",
    db.from("source_mappings").select("external_id, client_slug").eq("provider", "clickup").eq("kind", "folder")
      .eq("active", true),
  );

  const activeAccountNames = new Map(accountRows.map((a) => [a.id, a.name]));
  const clients = new Map<string, ClientRow>();
  for (const c of clientRows) clients.set(c.slug, { slug: c.slug, name: c.name, accountIds: [], accountNames: [] });
  for (const link of linkRows) {
    const client = clients.get(link.client_slug);
    if (!client) continue;
    client.accountIds.push(link.account_id);
    const name = activeAccountNames.get(link.account_id);
    if (name) client.accountNames.push(name);
  }
  const mappings: Record<string, string> = {};
  for (const m of mappingRows) mappings[m.external_id] = m.client_slug;

  let slug = input.clientSlug;
  if (!slug) {
    const link = linkRows.find((l) => l.account_id === input.accountId);
    if (!link) throw new Refusal(404, "This ad account is not linked to a client.");
    slug = link.client_slug;
  }
  if (!clients.has(slug)) throw new Refusal(404, "No active client with that slug.");
  return { slug, clients: [...clients.values()], mappings };
}

async function resolveProjectList(clickup: ClickUp, slug: string, clients: ClientRow[], mappings: Record<string, string>) {
  const data = await clickup(`/space/${CLICKUP_CLIENT_SPACE_ID}/folder?archived=false`);
  const folders = (data.folders as { id: string; name: string; lists?: { id: string; name: string }[] }[] | undefined) ??
    [];
  const matches = folders
    .map((folder) => ({ folder, resolution: resolveClientSlug(folder, clients, mappings) }))
    .filter((m) => m.resolution.kind === "client" && m.resolution.slug === slug);
  const byMapping = matches.filter((m) => m.resolution.kind === "client" && m.resolution.via === "mapping");
  const chosen = byMapping.length > 0 ? byMapping : matches;
  if (chosen.length === 0) {
    // The page turns needs_setup into a link to the client's Setup tab, where a builder links a folder.
    throw new Refusal(
      404,
      "This client has no ClickUp folder linked yet. A builder can link one on the client's Setup tab.",
      { needs_setup: true, client_slug: slug },
    );
  }
  if (chosen.length > 1) {
    throw new Refusal(
      409,
      "More than one ClickUp folder matches this client. A builder can pick the right one on the client's Setup tab.",
      { needs_setup: true, client_slug: slug },
    );
  }
  const list = pickProjectList(chosen[0].folder.lists);
  if (!list) throw new Refusal(409, "The client's ClickUp folder has no single Project View list.");
  return list;
}

async function listTasks(clickup: ClickUp, listId: string): Promise<ClickUpBriefTask[]> {
  const tasks: ClickUpBriefTask[] = [];
  for (let page = 0; page < MAX_PAGES_PER_LIST; page++) {
    const data = await clickup(
      `/list/${listId}/task?page=${page}&include_closed=true&subtasks=false&archived=false&include_markdown_description=true`,
    );
    const batch = (data.tasks as ClickUpBriefTask[] | undefined) ?? [];
    tasks.push(...batch);
    if (data.last_page === true || batch.length === 0) break;
  }
  return tasks;
}

/**
 * The id of the workspace task type named "Asset", looked up read-only by name. Null when it
 * cannot be found or the lookup fails: the caller then creates the task without a type.
 */
export async function resolveAssetTaskTypeId(clickup: ClickUp): Promise<number | null> {
  try {
    const teams = ((await clickup("/team")).teams as { id?: string | number }[] | undefined) ?? [];
    for (const team of teams) {
      if (team.id === undefined || !/^\d{1,20}$/.test(String(team.id))) continue;
      const data = await clickup(`/team/${team.id}/custom_item`);
      const items = (data.custom_items as { id?: string | number; name?: string }[] | undefined) ?? [];
      const hit = items.find((i) => (i.name ?? "").trim().toLowerCase() === ASSET_TASK_TYPE_NAME.toLowerCase());
      const id = hit?.id === undefined ? NaN : Number(hit.id);
      if (Number.isInteger(id) && id > 0) return id;
    }
  } catch (error) {
    if (!(error instanceof ClickUpError)) throw error;
  }
  return null;
}

function checkedDescription(input: Input): string {
  const description = buildBriefDescription(input.body, input.creative);
  // toPlainMarkdown already removes tags; never send one if that ever changes.
  if (HTML_TAG.test(description)) throw new Error("brief still contains an HTML tag");
  return description;
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const caller = await (deps.resolveCaller ?? defaultResolveCaller)(req);
  if (caller instanceof Response) return caller;
  if (!isStaffLogin(caller)) return json({ error: "Forbidden: staff only" }, 403);

  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const token = env("CLICKUP_API_TOKEN")?.trim();
  if (!token) {
    return json({ error: "ClickUp is not connected in this environment: CLICKUP_API_TOKEN is not set." }, 503);
  }

  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
  } catch {
    return json({ error: "Body must be a JSON object" }, 400);
  }
  const input = parseInput(raw);
  if (typeof input === "string") return json({ error: input }, 400);

  const writePolicy = clickUpWritePolicy(env);
  const clickup = makeClickUp(
    token,
    deps.fetch ?? ((url, init) => fetch(url, init)),
    writePolicy.blocked && writePolicy.allowedListIds.size === 0,
  );
  try {
    const db = (deps.db ?? serviceClient)();
    const { slug, clients, mappings } = await loadClients(db, input);
    const list = await resolveProjectList(clickup, slug, clients, mappings);

    if (input.action === "push" && !mayWriteToList(writePolicy, list.id)) {
      throw new Refusal(403, READ_ONLY_MESSAGE, { read_only: true });
    }

    if (input.action === "list") {
      const tasks = (await listTasks(clickup, list.id))
        .filter(isPickable)
        .sort((a, b) => (assetNumber(a.name) ?? 0) - (assetNumber(b.name) ?? 0))
        .map((t) => ({ id: t.id, name: t.name ?? "", status: taskStatus(t), url: taskUrl(t) }));
      return json({ client_slug: slug, list: { id: list.id, name: list.name }, tasks });
    }

    const description = checkedDescription(input);

    if (input.target === "new") {
      const names = (await listTasks(clickup, list.id)).map((t) => t.name);
      const now = (deps.now ?? (() => new Date()))();
      const name = newTaskName(currentMonthName(now), nextAssetNumber(names), input.title);
      const typeId = await resolveAssetTaskTypeId(clickup);
      const created = (await clickup(`/list/${list.id}/task`, {
        method: "POST",
        body: {
          name,
          markdown_content: description,
          status: BRIEF_STATUS,
          ...(typeId === null ? {} : { custom_item_id: typeId }),
        },
      })) as unknown as ClickUpBriefTask;
      return json({
        client_slug: slug,
        task_id: created.id,
        task_name: created.name ?? name,
        url: taskUrl(created),
        created: true,
        task_type: typeId === null ? null : ASSET_TASK_TYPE_NAME,
        ...(typeId === null ? { note: NO_TASK_TYPE_NOTE } : {}),
      });
    }

    const taskId = input.target!;
    let task: ClickUpBriefTask;
    try {
      task = (await clickup(`/task/${taskId}?include_markdown_description=true`)) as unknown as ClickUpBriefTask;
    } catch (error) {
      if (error instanceof ClickUpError && error.status === 404) throw new Refusal(404, "ClickUp task not found.");
      throw error;
    }
    if (task.list?.id !== list.id) {
      throw new Refusal(409, "That task is not in this client's Project View list.");
    }
    if (!isAssetTask(task.name)) throw new Refusal(409, "That task is not an asset task.");
    if (!isDescriptionEmpty(task)) {
      throw new Refusal(409, "That task already has a description. Nothing was changed; pick an empty task or a new one.");
    }
    const updated = (await clickup(`/task/${taskId}`, {
      method: "PUT",
      body: { markdown_content: description, status: BRIEF_STATUS },
    })) as unknown as ClickUpBriefTask;
    return json({
      client_slug: slug,
      task_id: taskId,
      task_name: updated.name ?? task.name ?? "",
      url: taskUrl(updated.id ? updated : task),
      created: false,
    });
  } catch (error) {
    if (error instanceof Refusal) return json({ error: error.message, ...error.extra }, error.status);
    if (error instanceof ClickUpError) {
      if (error.status === 401) return json({ error: "ClickUp rejected CLICKUP_API_TOKEN." }, 503);
      return json({ error: `ClickUp request failed (${error.status})` }, 502);
    }
    console.error("push-brief-to-clickup error:", error instanceof Error ? error.message : error);
    return json({ error: "Push to ClickUp failed" }, 500);
  }
}

// Tests import the handler with PUSH_BRIEF_TO_CLICKUP_NO_SERVE set.
if (!Deno.env.get("PUSH_BRIEF_TO_CLICKUP_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
