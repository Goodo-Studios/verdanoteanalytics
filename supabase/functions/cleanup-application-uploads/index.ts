import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/internal-auth.ts";

// Deletes the uploaded files of public application drafts that will never become an application.
// Service role only (the daily cron job in migration 20261208100004, or a person with the key).
//
//   POST { dry_run?: boolean (default true), limit?: number (1 to 100, default 25) }
//
// What it deletes, and only this:
//   1. Drafts that were never submitted and expired more than 3 hours ago, or whose submit was
//      dropped because the email already had a pending application. The database chooses them
//      (public_application_cleanup_candidates) and never offers a draft that an application, an
//      application video or a headshot still points at. Each path is checked to sit inside
//      applications/<draft id>/ before it is removed.
//   2. Folders in the application buckets that no draft row remembers (older drafts were tidied
//      away before this existed), with no application and no path reference, and whose files are
//      all more than 3 days old.
// Files of a submitted application are never in either set.
//
// Dry run lists the same sets and deletes nothing, writes nothing. A real run also needs the
// outbound_switches row 'application_upload_cleanup' to exist and be enabled (no row is created by
// the migration), otherwise it answers { status: "switch_off" } and does nothing.
// The answer carries counts only, never file names.

export const SWITCH_NAME = "application_upload_cleanup";
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
const ORPHAN_MIN_AGE_MS = 3 * 24 * 3600 * 1000;
const MAX_FOLDER_PAGES = 20;
const FOLDER_PAGE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BUCKETS: Record<string, { bucket: string; folder: "headshot" | "video" }[]> = {
  creator: [
    { bucket: "creator-application-headshots", folder: "headshot" },
    { bucket: "creator-application-videos", folder: "video" },
  ],
  actor: [
    { bucket: "actor-application-headshots", folder: "headshot" },
    { bucket: "actor-application-videos", folder: "video" },
  ],
};
const ALL_BUCKETS = Object.values(BUCKETS).flat();

export interface StoredFile {
  name: string;
  created_at: string | null;
}

/** The database and storage calls this function makes. Tests pass a stand-in. */
export interface CleanupStore {
  switchEnabled(name: string): Promise<boolean>;
  candidates(limit: number): Promise<{ draft_id: string; kind: string }[]>;
  markCleaned(ids: string[]): Promise<number>;
  unprotected(ids: string[]): Promise<string[]>;
  listFiles(bucket: string, folder: string): Promise<StoredFile[]>;
  listFolders(bucket: string, offset: number, limit: number): Promise<string[]>;
  remove(bucket: string, paths: string[]): Promise<void>;
}

export interface Deps {
  authorize?: (req: Request) => Promise<Response | null>;
  env?: (name: string) => string | undefined;
  store?: CleanupStore;
  now?: () => number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type QueryResult = { data: unknown; error: { message: string } | null };
interface StorageBucket {
  list(path: string, opts: Record<string, unknown>): PromiseLike<QueryResult>;
  remove(paths: string[]): PromiseLike<QueryResult>;
}
interface SupabaseLike {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
  from(table: string): {
    select(columns: string): { eq(column: string, value: unknown): { maybeSingle(): PromiseLike<QueryResult> } };
  };
  storage: { from(bucket: string): StorageBucket };
}

function supabaseStore(sb: SupabaseLike): CleanupStore {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  };
  return {
    async switchEnabled(name) {
      const { data, error } = await sb.from("outbound_switches").select("enabled").eq("name", name).maybeSingle();
      if (error) throw new Error(`outbound_switches: ${error.message}`);
      return (data as { enabled?: boolean } | null)?.enabled === true;
    },
    async candidates(limit) {
      const data = await rpc("public_application_cleanup_candidates", { p_limit: limit });
      return Array.isArray(data) ? (data as { draft_id: string; kind: string }[]) : [];
    },
    async markCleaned(ids) {
      const data = await rpc("public_application_cleanup_mark", { p_ids: ids });
      return typeof data === "number" ? data : 0;
    },
    async unprotected(ids) {
      const data = await rpc("public_application_unprotected_ids", { p_ids: ids });
      return Array.isArray(data) ? (data as string[]) : [];
    },
    async listFiles(bucket, folder) {
      const { data, error } = await sb.storage.from(bucket).list(folder, { limit: 100 });
      if (error) throw new Error(`list: ${error.message}`);
      return (Array.isArray(data) ? data : [])
        .filter((o: { id?: string | null }) => o.id)
        .map((o: { name: string; created_at?: string | null }) => ({ name: o.name, created_at: o.created_at ?? null }));
    },
    async listFolders(bucket, offset, limit) {
      const { data, error } = await sb.storage.from(bucket).list("applications", { limit, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(`list: ${error.message}`);
      return (Array.isArray(data) ? data : [])
        .filter((o: { id?: string | null }) => !o.id)
        .map((o: { name: string }) => o.name);
    },
    async remove(bucket, paths) {
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await sb.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) throw new Error(`remove: ${error.message}`);
      }
    },
  };
}

/** Object paths to delete: plain file names only, so a name can never climb out of the draft folder. */
export function safePaths(prefix: string, id: string, files: StoredFile[]): string[] {
  return files
    .filter((f) => f.name && !f.name.includes("/") && !f.name.includes("..") && !f.name.includes("\\"))
    .map((f) => `${prefix}/${f.name}`)
    .filter((p) => p.startsWith(`applications/${id}/`));
}

interface Tally {
  dry_run: boolean;
  drafts_examined: number;
  drafts_cleaned: number;
  objects_found: number;
  objects_deleted: number;
  orphan_folders_found: number;
  orphan_folders_deleted: number;
  errors: number;
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const denied = deps.authorize ? await deps.authorize(req) : await requireServiceRole(req);
  if (denied) return denied;

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim()) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "bad_request" }, 400);
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  // Anything but an explicit false is a dry run.
  const dryRun = body.dry_run !== false;
  const limitIn = typeof body.limit === "number" && Number.isFinite(body.limit) ? Math.floor(body.limit) : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(limitIn, 1), MAX_LIMIT);

  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  let store = deps.store;
  if (!store) {
    const url = env("SUPABASE_URL");
    const key = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ error: "Server misconfigured" }, 500);
    store = supabaseStore(createClient(url, key) as unknown as SupabaseLike);
  }

  try {
    if (!dryRun && !(await store.switchEnabled(SWITCH_NAME))) {
      return json({ status: "switch_off", dry_run: false, deleted: 0, note: `The '${SWITCH_NAME}' switch is off. Nothing was deleted.` });
    }
    const now = (deps.now ?? Date.now)();
    const tally: Tally = {
      dry_run: dryRun, drafts_examined: 0, drafts_cleaned: 0, objects_found: 0, objects_deleted: 0,
      orphan_folders_found: 0, orphan_folders_deleted: 0, errors: 0,
    };

    // 1. Drafts that will never become an application.
    const candidates = await store.candidates(limit);
    const cleaned: string[] = [];
    for (const c of candidates) {
      const targets = BUCKETS[c.kind];
      if (!UUID.test(c.draft_id) || !targets) continue;
      tally.drafts_examined++;
      let ok = true;
      for (const t of targets) {
        try {
          const prefix = `applications/${c.draft_id}/${t.folder}`;
          const files = await store.listFiles(t.bucket, prefix);
          const paths = safePaths(prefix, c.draft_id, files);
          tally.objects_found += paths.length;
          if (!dryRun && paths.length > 0) {
            await store.remove(t.bucket, paths);
            tally.objects_deleted += paths.length;
          }
        } catch {
          ok = false;
          tally.errors++;
        }
      }
      if (ok && !dryRun) cleaned.push(c.draft_id);
    }
    if (!dryRun && cleaned.length > 0) tally.drafts_cleaned = await store.markCleaned(cleaned);

    // 2. Folders no draft row remembers, until the batch limit is reached.
    let budget = limit;
    for (const t of ALL_BUCKETS) {
      if (budget <= 0) break;
      for (let page = 0; page < MAX_FOLDER_PAGES && budget > 0; page++) {
        let names: string[];
        try {
          names = await store.listFolders(t.bucket, page * FOLDER_PAGE, FOLDER_PAGE);
        } catch {
          tally.errors++;
          break;
        }
        if (names.length === 0) break;
        const ids = names.filter((n) => UUID.test(n));
        const free = ids.length > 0 ? await store.unprotected(ids) : [];
        for (const id of free) {
          if (budget <= 0) break;
          try {
            const prefix = `applications/${id}/${t.folder}`;
            const files = await store.listFiles(t.bucket, prefix);
            if (files.length === 0) continue;
            const old = files.every((f) => f.created_at !== null && now - Date.parse(f.created_at) > ORPHAN_MIN_AGE_MS);
            if (!old) continue;
            tally.orphan_folders_found++;
            budget--;
            const paths = safePaths(prefix, id, files);
            tally.objects_found += paths.length;
            if (!dryRun && paths.length > 0) {
              await store.remove(t.bucket, paths);
              tally.objects_deleted += paths.length;
              tally.orphan_folders_deleted++;
            }
          } catch {
            tally.errors++;
          }
        }
        if (names.length < FOLDER_PAGE) break;
      }
    }
    return json(tally);
  } catch {
    return json({ error: "server_error" }, 500);
  }
}

// Tests import the handler with CLEANUP_APPLICATION_UPLOADS_NO_SERVE set.
if (!Deno.env.get("CLEANUP_APPLICATION_UPLOADS_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
