import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Debug tool exposing Apify run data. verify_jwt=true admits any project JWT
  // including the public anon key, so an internal staff gate is required.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) return json({ error: "Unauthorized" }, 401);
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = (roleRows || []).map((r: { role: string }) => r.role);
  if (!roles.includes("builder")) return json({ error: "Forbidden" }, 403);

  const apifyToken = Deno.env.get("APIFY_TOKEN")!;
  const body = await req.json().catch(() => ({}));
  const runId = body.run_id;

  if (runId) {
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${apifyToken}`);
    const items = await res.json();
    const first = items?.[0] ?? {};
    const snap = first.snapshot ?? {};
    // Find all URL-like values anywhere in the item
    const findUrls = (obj: unknown, path = ""): string[] => {
      if (typeof obj === "string" && (obj.startsWith("https://video") || obj.includes(".mp4") || obj.includes("fbcdn.net/o1"))) {
        return [path + ": " + obj.slice(0, 120)];
      }
      if (Array.isArray(obj)) return obj.flatMap((v, i) => findUrls(v, `${path}[${i}]`));
      if (obj && typeof obj === "object") {
        return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => findUrls(v, path ? `${path}.${k}` : k));
      }
      return [];
    };
    const videoUrls = findUrls(first);
    return json({
      page_name: first.pageName ?? first.page_name,
      ad_archive_id: first.adArchiveID ?? first.adArchiveId,
      snapshot_display_format: snap.displayFormat,
      snapshot_video_count: Array.isArray(snap.videos) ? snap.videos.length : snap.videos,
      snapshot_image_count: Array.isArray(snap.images) ? snap.images.length : snap.images,
      snapshot_cards_count: Array.isArray(snap.cards) ? snap.cards.length : snap.cards,
      extra_videos: snap.extraVideos,
      extra_images: snap.extraImages,
      video_urls_found: videoUrls,
      all_snapshot_keys: Object.keys(snap),
    });
  }

  const res = await fetch(`https://api.apify.com/v2/acts/apify~facebook-ads-scraper/runs?token=${apifyToken}&limit=10&desc=true`);
  const data = await res.json();
  return json(data?.data?.items?.map((r: Record<string, unknown>) => ({ id: r.id, status: r.status, startedAt: r.startedAt })) ?? data);
});
