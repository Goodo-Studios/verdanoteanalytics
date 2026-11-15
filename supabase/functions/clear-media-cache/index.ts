import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

export interface Deps {
  createClient?: typeof createClient;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BATCH = 500;
const LIST_PAGE = 1000;
// Hard ceiling on loop iterations so a write that silently changes nothing can never spin forever.
const MAX_BATCHES = 10_000;

/** Throws when a database or storage call came back with an error. */
function must(label: string, result: { error?: { message?: string } | null }): void {
  if (result.error) throw new Error(`${label}: ${result.error.message ?? "failed"}`);
}

export async function handler(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = (deps.createClient ?? createClient)(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Destructive ops tool (wipes every cached thumbnail/video URL + storage
  // objects). verify_jwt=true admits any project JWT including the public anon
  // key, so an internal staff gate is required.
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) return json({ error: "Unauthorized" }, 401);
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = (roleRows || []).map((r: { role: string }) => r.role);
  if (!roles.includes("builder")) return json({ error: "Forbidden" }, 403);

  // Explicit confirmation: a stray POST must never wipe the cache.
  let body: { confirm?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (body?.confirm !== true) {
    return json({ error: 'This deletes every cached thumbnail, video and storage object. Send {"confirm": true} to proceed.' }, 400);
  }

  let totalThumbReset = 0;
  let totalVideoReset = 0;
  let totalStorageDeleted = 0;
  let totalAssetRowsDeleted = 0;

  try {
    // 1. Reset thumbnail URLs and the asset back-reference — fetch IDs first, update in chunks.
    for (let i = 0; i < MAX_BATCHES; i++) {
      const read = await supabase
        .from("creatives")
        .select("ad_id")
        .like("thumbnail_url", "%/storage/v1/object/public/ad-thumbnails/%")
        .limit(BATCH);
      must("creatives thumbnail read", read);
      const rows = read.data;
      if (!rows || rows.length === 0) break;
      const ids = rows.map((r: { ad_id: string }) => r.ad_id);
      must(
        "creatives thumbnail reset",
        await supabase
          .from("creatives")
          .update({ thumbnail_url: null, full_res_url: null, thumbnail_storage_path: null, thumb_asset_id: null })
          .in("ad_id", ids),
      );
      totalThumbReset += ids.length;
      console.log(`Reset ${totalThumbReset} thumbnail rows so far...`);
    }

    // 2. Reset video URLs and the asset back-reference.
    for (let i = 0; i < MAX_BATCHES; i++) {
      const read = await supabase
        .from("creatives")
        .select("ad_id")
        .like("video_url", "%/storage/v1/object/public/ad-videos/%")
        .limit(BATCH);
      must("creatives video read", read);
      const rows = read.data;
      if (!rows || rows.length === 0) break;
      const ids = rows.map((r: { ad_id: string }) => r.ad_id);
      must(
        "creatives video reset",
        await supabase.from("creatives").update({ video_url: null, video_asset_id: null }).in("ad_id", ids),
      );
      totalVideoReset += ids.length;
      console.log(`Reset ${totalVideoReset} video rows so far...`);
    }

    // 3. Clear storage buckets. List the whole top level first (paginated), because
    // removing while paging would shift the offsets.
    for (const bucket of ["ad-thumbnails", "ad-videos"]) {
      const top: Array<{ id?: string | null; name: string }> = [];
      for (let offset = 0; ; offset += LIST_PAGE) {
        const page = await supabase.storage.from(bucket).list("", { limit: LIST_PAGE, offset });
        must(`storage list ${bucket}`, page);
        const items = page.data ?? [];
        top.push(...items);
        if (items.length < LIST_PAGE) break;
      }

      for (const item of top) {
        if (item.id) {
          must(`storage remove ${bucket}`, await supabase.storage.from(bucket).remove([item.name]));
          totalStorageDeleted++;
          continue;
        }
        // Folder: list and delete contents in batches. Always re-list from offset 0 because
        // each batch is removed before the next list.
        for (let i = 0; i < MAX_BATCHES; i++) {
          const sub = await supabase.storage.from(bucket).list(item.name, { limit: BATCH, offset: 0 });
          must(`storage list ${bucket}/${item.name}`, sub);
          const subFiles = sub.data ?? [];
          if (subFiles.length === 0) break;
          const paths = subFiles.map((f: { name: string }) => `${item.name}/${f.name}`);
          for (let j = 0; j < paths.length; j += 100) {
            must(`storage remove ${bucket}`, await supabase.storage.from(bucket).remove(paths.slice(j, j + 100)));
          }
          totalStorageDeleted += paths.length;
          console.log(`Deleted ${totalStorageDeleted} storage files total...`);
          // A folder entry that is itself a nested folder cannot be removed as a file; stop
          // instead of re-listing the same entries forever.
          if (subFiles.every((f: { id?: string | null }) => !f.id)) break;
        }
      }

      // 3b. The storage objects are gone, so the registry rows pointing at them are dangling.
      // creatives and media_archive reference media_assets with ON DELETE SET NULL.
      for (let i = 0; i < MAX_BATCHES; i++) {
        const read = await supabase.from("media_assets").select("id").eq("bucket", bucket).limit(BATCH);
        must(`media_assets read ${bucket}`, read);
        const rows = read.data;
        if (!rows || rows.length === 0) break;
        const ids = rows.map((r: { id: string }) => r.id);
        must(`media_assets delete ${bucket}`, await supabase.from("media_assets").delete().in("id", ids));
        totalAssetRowsDeleted += ids.length;
      }
    }

    // 4. Reset last_media_sync
    must("ad_accounts reset", await supabase.from("ad_accounts").update({ last_media_sync: null }).neq("id", ""));

    console.log(
      `Done! Thumbs reset: ${totalThumbReset}, Videos reset: ${totalVideoReset}, Storage deleted: ${totalStorageDeleted}, Asset rows deleted: ${totalAssetRowsDeleted}`,
    );

    return json({
      success: true,
      thumbnails_reset: totalThumbReset,
      videos_reset: totalVideoReset,
      storage_files_deleted: totalStorageDeleted,
      media_assets_deleted: totalAssetRowsDeleted,
    });
  } catch (err) {
    console.error("Error:", err);
    return json({
      error: err instanceof Error ? err.message : String(err),
      progress: {
        thumbnails_reset: totalThumbReset,
        videos_reset: totalVideoReset,
        storage_files_deleted: totalStorageDeleted,
        media_assets_deleted: totalAssetRowsDeleted,
      },
    }, 500);
  }
}

// Tests import the handler with CLEAR_MEDIA_CACHE_NO_SERVE set.
if (!Deno.env.get("CLEAR_MEDIA_CACHE_NO_SERVE")) {
  serve((req) => handler(req));
}
