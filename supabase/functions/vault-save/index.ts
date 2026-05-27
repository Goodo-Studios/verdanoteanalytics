// vault-save — port from Creative Vault (US-002).
// Differences from source:
//   • workspace_id stripped (Verdanote scopes inspiration_items by user_id directly).
//   • brand_name retained because the inspiration_items schema (US-001) keeps it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { detectPlatform } from "../_shared/platform.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { url, file_path, platform: explicitPlatform, mime_type, brand_name, thumbnail_url } = body;

    if (!url && !file_path) return json({ error: "url or file_path is required" }, 400);

    const platform = explicitPlatform ?? (url ? detectPlatform(url) : "upload");
    const isVideo = !mime_type || mime_type.startsWith("video/");

    let adArchiveId: string | null = null;
    if (platform === "facebook_ad" && url) {
      try {
        adArchiveId = new URL(url).searchParams.get("id");
      } catch { /* ignore malformed URLs */ }
    }

    // Insert the item — user-scoped only, no workspace_id.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: item, error: insertError } = await adminClient
      .from("inspiration_items")
      .insert({
        user_id: user.id,
        source_url: url ?? null,
        platform,
        file_path: file_path ?? null,
        thumbnail_url: thumbnail_url ?? null,
        brand_name: brand_name ?? null,
        ad_archive_id: adArchiveId,
        status: url ? "extracting" : (isVideo ? "transcribing" : "analyzing"),
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Kick off the pipeline asynchronously.
    const nextFunction = url ? "vault-extract" : (isVideo ? "vault-transcribe" : "vault-analyze");
    EdgeRuntime.waitUntil(
      fetch(`${supabaseUrl}/functions/v1/${nextFunction}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ item_id: item.id }),
      }).catch(console.error)
    );

    return json({ item_id: item.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    console.error("vault-save error:", msg);
    return json({ error: msg }, 500);
  }
});
