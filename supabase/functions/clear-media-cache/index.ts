import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // 1. Reset thumbnail URLs that point to storage
    const { count: thumbCount, error: thumbErr } = await supabase
      .from("creatives")
      .update({ thumbnail_url: null, full_res_url: null, thumbnail_storage_path: null })
      .like("thumbnail_url", "%/storage/v1/object/public/ad-thumbnails/%")
      .select("ad_id", { count: "exact", head: true });

    console.log(`Reset thumbnails: ${thumbCount ?? 0} rows`, thumbErr?.message || "ok");

    // 2. Reset video URLs that point to storage
    const { count: videoCount, error: videoErr } = await supabase
      .from("creatives")
      .update({ video_url: null })
      .like("video_url", "%/storage/v1/object/public/ad-videos/%")
      .select("ad_id", { count: "exact", head: true });

    console.log(`Reset videos: ${videoCount ?? 0} rows`, videoErr?.message || "ok");

    // 3. Clear storage buckets
    for (const bucket of ["ad-thumbnails", "ad-videos"]) {
      const { data: files, error: listErr } = await supabase.storage.from(bucket).list("", { limit: 1000 });
      if (listErr) { console.log(`List ${bucket} error:`, listErr.message); continue; }

      // Files might be in subdirectories (account_id folders)
      for (const item of files || []) {
        if (item.id) {
          // It's a file at root
          await supabase.storage.from(bucket).remove([item.name]);
        } else {
          // It's a folder — list contents
          const { data: subFiles } = await supabase.storage.from(bucket).list(item.name, { limit: 10000 });
          if (subFiles && subFiles.length > 0) {
            const paths = subFiles.map((f: any) => `${item.name}/${f.name}`);
            // Delete in batches of 100
            for (let i = 0; i < paths.length; i += 100) {
              await supabase.storage.from(bucket).remove(paths.slice(i, i + 100));
            }
            console.log(`Cleared ${paths.length} files from ${bucket}/${item.name}`);
          }
        }
      }
    }

    // 4. Reset last_media_sync on all accounts
    await supabase.from("ad_accounts").update({ last_media_sync: null }).neq("id", "");

    return new Response(JSON.stringify({
      success: true,
      thumbnails_reset: thumbCount ?? 0,
      videos_reset: videoCount ?? 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
