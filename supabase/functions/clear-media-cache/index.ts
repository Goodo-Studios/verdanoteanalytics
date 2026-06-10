import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Destructive ops tool (wipes every cached thumbnail/video URL + storage
  // objects). verify_jwt=true admits any project JWT including the public anon
  // key, so an internal staff gate is required.
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = (roleRows || []).map((r: { role: string }) => r.role);
  if (!roles.includes("builder")) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let totalThumbReset = 0;
  let totalVideoReset = 0;
  let totalStorageDeleted = 0;

  try {
    // 1. Batch reset thumbnail URLs — fetch IDs first, update in chunks
    let hasMore = true;
    while (hasMore) {
      const { data: rows } = await supabase
        .from("creatives")
        .select("ad_id")
        .like("thumbnail_url", "%/storage/v1/object/public/ad-thumbnails/%")
        .limit(500);

      if (!rows || rows.length === 0) { hasMore = false; break; }
      const ids = rows.map((r: any) => r.ad_id);
      await supabase
        .from("creatives")
        .update({ thumbnail_url: null, full_res_url: null, thumbnail_storage_path: null })
        .in("ad_id", ids);
      totalThumbReset += ids.length;
      console.log(`Reset ${totalThumbReset} thumbnail rows so far...`);
    }

    // 2. Batch reset video URLs
    hasMore = true;
    while (hasMore) {
      const { data: rows } = await supabase
        .from("creatives")
        .select("ad_id")
        .like("video_url", "%/storage/v1/object/public/ad-videos/%")
        .limit(500);

      if (!rows || rows.length === 0) { hasMore = false; break; }
      const ids = rows.map((r: any) => r.ad_id);
      await supabase
        .from("creatives")
        .update({ video_url: null })
        .in("ad_id", ids);
      totalVideoReset += ids.length;
      console.log(`Reset ${totalVideoReset} video rows so far...`);
    }

    // 3. Clear storage buckets
    for (const bucket of ["ad-thumbnails", "ad-videos"]) {
      const { data: folders } = await supabase.storage.from(bucket).list("", { limit: 1000 });
      if (!folders) continue;

      for (const item of folders) {
        if (item.id) {
          await supabase.storage.from(bucket).remove([item.name]);
          totalStorageDeleted++;
          continue;
        }
        // Folder — list and delete contents in batches
        let offset = 0;
        while (true) {
          const { data: subFiles } = await supabase.storage.from(bucket).list(item.name, { limit: 500, offset });
          if (!subFiles || subFiles.length === 0) break;
          const paths = subFiles.map((f: any) => `${item.name}/${f.name}`);
          for (let i = 0; i < paths.length; i += 100) {
            await supabase.storage.from(bucket).remove(paths.slice(i, i + 100));
          }
          totalStorageDeleted += paths.length;
          console.log(`Deleted ${totalStorageDeleted} storage files total...`);
          if (subFiles.length < 500) break;
          offset += 500;
        }
      }
    }

    // 4. Reset last_media_sync
    await supabase.from("ad_accounts").update({ last_media_sync: null }).neq("id", "");

    console.log(`Done! Thumbs reset: ${totalThumbReset}, Videos reset: ${totalVideoReset}, Storage deleted: ${totalStorageDeleted}`);

    return new Response(JSON.stringify({
      success: true,
      thumbnails_reset: totalThumbReset,
      videos_reset: totalVideoReset,
      storage_files_deleted: totalStorageDeleted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      progress: { thumbnails_reset: totalThumbReset, videos_reset: totalVideoReset, storage_files_deleted: totalStorageDeleted },
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
