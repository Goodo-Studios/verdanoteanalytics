import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/internal-auth.ts";
import {
  CLICKUP_CLIENT_SPACE_ID,
  type ClickUpTask,
  type ClientRow,
  CLICKUP_NO_TOKEN_STATE,
  type DeliveredRecord,
  type PipelineRecord,
  boardAccountId,
  pickProjectList,
  resolveClientSlug,
  toPipelineRecord,
} from "../_shared/clickup-pipeline.ts";

// ClickUp -> pipeline_tasks. Feeds the client-facing Content Pipeline board
// (/pipeline). Replaces sync-coda-tasks: Coda was retired on 2026-10-09 and
// ClickUp is the task system.
//
// Read-only against ClickUp (GET only). For every client folder in the Client
// Operations space it reads the "{Client} Project View" list, keeps asset tasks,
// maps each ClickUp status to one of five client-facing columns and writes only
// client-safe fields. See _shared/clickup-pipeline.ts for the rules.
//
// Each folder is resolved to a client (`clients.slug`): first through a staff-set
// `source_mappings` row (provider clickup, kind folder), then by name against the
// clients and their linked ad accounts. A folder that does not resolve to exactly
// one client is skipped and listed in the result. Every row carries client_slug;
// account_id is written only when the client has exactly one linked ad account,
// because the /pipeline page filters by ad account.
//
// The sync is authoritative: rows not refreshed by a clean run are deleted, so
// a task that is cleared, archived, moved to "stuck" or aged out leaves the board.
//
// Delivered work (phase 5): delivered in the last 30 days stays on the board
// (pipeline_tasks, stage "Ready to Launch"); delivered earlier, up to a year back, is
// written to pipeline_delivered so a client's past cycles keep their finished tasks.
// Both tables get the same authoritative delete, under the same safety rule.
//
// No ClickUp token: the run stops before any read or write, answers 503 with the state
// "clickup.no_token" (the note integration-health shows for the connector) and logs it.
// Nothing is deleted, so clients keep the last good board and its "Updated ... ago" line.

const CLICKUP_API = "https://api.clickup.com/api/v2";
const MAX_PAGES_PER_LIST = 50; // 100 tasks per page
const UPSERT_CHUNK = 500;

// The small part of the Supabase client this handler uses. Tests inject a
// recording stand-in; production passes a real createClient().
interface QueryResult {
  data: Record<string, string>[] | null;
  error: { message: string } | null;
  count?: number | null;
}
interface QueryBuilder extends PromiseLike<QueryResult> {
  select(columns: string): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  upsert(rows: unknown[], options: { onConflict: string }): QueryBuilder;
  delete(options: { count: "exact" }): QueryBuilder;
  lt(column: string, value: string): QueryBuilder;
  not(column: string, operator: string, value: string): QueryBuilder;
}

// Made-up demo cards seeded on staging (scripts/seed-staging-dashboard-lib.mjs) use
// clickup_task_id values starting with this prefix. Real ClickUp ids never do, so the
// authoritative delete leaves these rows alone and the staging client wall check keeps
// cards to test against after a real sync. On production no row has this prefix.
export const DEMO_SEED_ID_PATTERN = "demo-seed-%";
interface SupabaseLike {
  from(table: string): QueryBuilder;
}

async function clickupGet(path: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${CLICKUP_API}${path}`, {
    headers: { Authorization: token, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    // The body can echo request details; keep only the status in the message.
    await res.body?.cancel();
    throw new Error(`ClickUp API error [${res.status}] for ${path.split("?")[0]}`);
  }
  return await res.json();
}

async function fetchListTasks(listId: string, token: string): Promise<ClickUpTask[]> {
  const tasks: ClickUpTask[] = [];
  for (let page = 0; page < MAX_PAGES_PER_LIST; page++) {
    const data = await clickupGet(
      `/list/${listId}/task?page=${page}&include_closed=true&subtasks=false&archived=false`,
      token,
    );
    const batch = (data.tasks as ClickUpTask[] | undefined) ?? [];
    tasks.push(...batch);
    if (data.last_page === true || batch.length === 0) break;
  }
  return tasks;
}

export async function handler(
  req: Request,
  injectedClient?: SupabaseLike,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // verify_jwt = false: this check is the only gate. pg_cron forwards the real
  // service-role key. Skipped when a test injects a client.
  const isInjectedClient =
    !!injectedClient && typeof (injectedClient as { from?: unknown }).from === "function";
  if (!isInjectedClient) {
    const authFailure = await requireServiceRole(req);
    if (authFailure) return authFailure;
  }

  try {
    const token = Deno.env.get("CLICKUP_API_TOKEN");
    if (!token) {
      console.error(
        `${CLICKUP_NO_TOKEN_STATE}: CLICKUP_API_TOKEN is not set. The board sync did not run and no row was changed; clients keep the last synced board.`,
      );
      return new Response(
        JSON.stringify({
          success: false,
          state: CLICKUP_NO_TOKEN_STATE,
          error: "ClickUp is not connected: CLICKUP_API_TOKEN is not set. No row was changed.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase: SupabaseLike = isInjectedClient
      ? injectedClient!
      : (createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        ) as unknown as SupabaseLike);

    // Any failed read stops the run before ClickUp is called or a row is written.
    const read = async (table: string, query: PromiseLike<QueryResult>) => {
      const { data, error } = await query;
      if (error) throw new Error(`${table} read failed: ${error.message}`);
      return data ?? [];
    };

    const clientRows = await read(
      "clients",
      supabase.from("clients").select("slug, name").eq("active", true),
    );
    const linkRows = await read(
      "client_ad_accounts",
      supabase.from("client_ad_accounts").select("account_id, client_slug"),
    );
    const accountRows = await read(
      "ad_accounts",
      supabase.from("ad_accounts").select("id, name").eq("is_active", true),
    );
    const mappingRows = await read(
      "source_mappings",
      supabase
        .from("source_mappings")
        .select("external_id, client_slug")
        .eq("provider", "clickup")
        .eq("kind", "folder")
        .eq("active", true),
    );

    const activeAccountNames = new Map(accountRows.map((a) => [a.id, a.name]));
    const clients = new Map<string, ClientRow>();
    for (const c of clientRows) {
      clients.set(c.slug, { slug: c.slug, name: c.name, accountIds: [], accountNames: [] });
    }
    for (const link of linkRows) {
      const client = clients.get(link.client_slug);
      if (!client) continue;
      client.accountIds.push(link.account_id);
      const name = activeAccountNames.get(link.account_id);
      if (name) client.accountNames.push(name);
    }
    const mappings: Record<string, string> = {};
    for (const m of mappingRows) mappings[m.external_id] = m.client_slug;

    const folderData = await clickupGet(
      `/space/${CLICKUP_CLIENT_SPACE_ID}/folder?archived=false`,
      token,
    );
    const folders =
      (folderData.folders as { id: string; name: string; lists?: { id: string; name: string }[] }[] | undefined) ??
      [];

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const records = new Map<string, PipelineRecord>();
    const delivered = new Map<string, DeliveredRecord>();
    const unmatchedFolders: string[] = [];
    const ambiguousFolders: string[] = [];
    const staleMappingFolders: string[] = [];
    const failedFolders: string[] = [];
    const clientsWithoutBoardAccount = new Set<string>();
    const unknownStatuses = new Set<string>();
    let seen = 0;
    let skipped = 0;
    let matchedFolders = 0;
    let matchedByMapping = 0;
    let matchedByName = 0;

    for (const folder of folders) {
      const resolution = resolveClientSlug(folder, [...clients.values()], mappings);
      const list = pickProjectList(folder.lists);
      if (resolution.kind !== "client" || !list) {
        // unmatchedFolders lists every skipped folder, as before; the two lists
        // below say why for the ones that had a candidate.
        unmatchedFolders.push(folder.name);
        if (resolution.kind === "none" && resolution.reason === "ambiguous") {
          ambiguousFolders.push(folder.name);
        }
        if (resolution.kind === "none" && resolution.reason === "stale_mapping") {
          staleMappingFolders.push(folder.name);
        }
        continue;
      }
      matchedFolders++;
      if (resolution.via === "mapping") matchedByMapping++;
      else matchedByName++;

      const client = clients.get(resolution.slug)!;
      const owner = { client_slug: client.slug, account_id: boardAccountId(client) };
      if (!owner.account_id) clientsWithoutBoardAccount.add(client.slug);

      let tasks: ClickUpTask[];
      try {
        tasks = await fetchListTasks(list.id, token);
      } catch (err) {
        console.error(`Task read failed for folder ${folder.name}:`, err);
        failedFolders.push(folder.name);
        continue;
      }

      for (const task of tasks) {
        seen++;
        const outcome = toPipelineRecord(task, owner, nowMs);
        if (outcome.kind === "record") {
          records.set(outcome.record.clickup_task_id, outcome.record);
        } else if (outcome.kind === "archive") {
          delivered.set(outcome.record.clickup_task_id, outcome.record);
        } else {
          skipped++;
          if (outcome.kind === "unknown") unknownStatuses.add(outcome.status);
        }
      }
    }

    const rows = [...records.values()];
    let upserted = 0;
    let upsertFailed = false;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase
        .from("pipeline_tasks")
        .upsert(chunk, { onConflict: "clickup_task_id" });
      if (error) {
        upsertFailed = true;
        console.error(`Upsert error for chunk ${i}-${i + chunk.length}:`, error.message);
      } else {
        upserted += chunk.length;
      }
    }

    const archiveRows = [...delivered.values()];
    let archived = 0;
    for (let i = 0; i < archiveRows.length; i += UPSERT_CHUNK) {
      const chunk = archiveRows.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase
        .from("pipeline_delivered")
        .upsert(chunk, { onConflict: "clickup_task_id" });
      if (error) {
        upsertFailed = true;
        console.error(`Delivered upsert error for chunk ${i}-${i + chunk.length}:`, error.message);
      } else {
        archived += chunk.length;
      }
    }

    // Authoritative delete: every row written this run carries synced_at = nowIso,
    // so anything older was not part of the board this time.
    //
    // SAFETY: skipped when an upsert chunk failed OR when any client folder could
    // not be read. In both cases live rows still carry an old synced_at, and
    // deleting by timestamp would empty a client's board over a transient error.
    let deleted = 0;
    const deleteSkipped = upsertFailed || failedFolders.length > 0;
    if (deleteSkipped) {
      console.warn("Skipping authoritative delete: this run was not clean.");
    } else {
      const { error: deleteError, count } = await supabase
        .from("pipeline_tasks")
        .delete({ count: "exact" })
        .lt("synced_at", nowIso)
        .not("clickup_task_id", "like", DEMO_SEED_ID_PATTERN);
      if (deleteError) {
        console.error("Authoritative delete error:", deleteError.message);
      } else {
        deleted = count ?? 0;
      }
      // A task that moved between the board and the delivered list, or left ClickUp, is removed
      // from the table it no longer belongs to.
      const { error: archiveDeleteError, count: archiveCount } = await supabase
        .from("pipeline_delivered")
        .delete({ count: "exact" })
        .lt("synced_at", nowIso)
        .not("clickup_task_id", "like", DEMO_SEED_ID_PATTERN);
      if (archiveDeleteError) {
        console.error("Delivered delete error:", archiveDeleteError.message);
      } else {
        deleted += archiveCount ?? 0;
      }
    }

    if (unknownStatuses.size > 0) {
      console.warn(
        `ClickUp status drift: unmapped statuses were left off the board: ${[...unknownStatuses].join(", ")}`,
      );
    }
    if (unmatchedFolders.length > 0) {
      console.warn(
        `Client folders with no single client match (add a source_mappings row, provider clickup, kind folder): ${unmatchedFolders.join(", ")}`,
      );
    }

    return new Response(
      JSON.stringify({
        success: !upsertFailed && failedFolders.length === 0,
        folders: folders.length,
        matchedFolders,
        matchedByMapping,
        matchedByName,
        unmatchedFolders,
        ambiguousFolders,
        staleMappingFolders,
        failedFolders,
        // Clients whose rows carry no account_id (no linked ad account, or more
        // than one). The current /pipeline page filters by ad account, so their
        // board is stored but not shown there yet.
        clientsWithoutBoardAccount: [...clientsWithoutBoardAccount].sort(),
        seen,
        upserted,
        archived,
        skipped,
        deleted,
        deleteSkipped,
        unknownStatuses: [...unknownStatuses],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    console.error("sync-clickup-tasks error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Bind the server unless a test imports this module. Only `req` reaches the
// handler: Deno.serve calls (req, connInfo) and connInfo must not be taken for
// an injected Supabase client.
if (!Deno.env.get("SYNC_CLICKUP_TASKS_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
