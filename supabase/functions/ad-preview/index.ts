import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Returns a Meta ad-preview iframe URL for embedding in-app.
//
// Meta's GET /{ad_id}/previews returns an <iframe> whose src (preview_iframe.php) is
// SAFE to embed: the `t` param is a short, preview-SCOPED token Meta mints for the
// browser — NOT the full access token (that stays server-side, used only here to call
// /previews). So we resolve the real token server-side, fetch the preview, and return
// just the scoped iframe URL for the client to embed.
//
// This is the workaround for page-owned videos whose raw source the token can't read
// (#10 — needs page permissions): the preview renders them regardless, so they PLAY
// in-app instead of via an external link only.

const META_API_VERSION = "v22.0";
// Try in order; first format that yields a preview body wins. MOBILE_FEED_STANDARD
// renders most video ads with an inline player.
const FORMATS = ["MOBILE_FEED_STANDARD", "DESKTOP_FEED_STANDARD", "INSTAGRAM_STANDARD", "FACEBOOK_STORY_MOBILE"];

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, max-age=900" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  let adId = url.searchParams.get("ad_id");
  if (!adId && req.method === "POST") {
    try { adId = (await req.clone().json())?.ad_id || null; } catch { /* no body */ }
  }
  if (!adId || !/^\d+$/.test(adId)) return json({ error: "invalid ad_id" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let token = Deno.env.get("META_ACCESS_TOKEN") || null;
  if (!token) {
    const { data } = await supabase.from("settings").select("value").eq("key", "meta_access_token").single();
    token = (data?.value as string) || null;
  }
  if (!token) return json({ error: "no token" }, 500);

  try {
    for (const fmt of FORMATS) {
      const r = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${adId}/previews?ad_format=${fmt}&access_token=${token}`);
      if (!r.ok) continue;
      const j = await r.json().catch(() => ({}));
      const body = j?.data?.[0]?.body as string | undefined;
      if (!body) continue;
      const m = body.match(/https?:\/\/[^"'\s]*preview_iframe\.php[^"'\s]*/);
      if (!m) continue;
      // Decode HTML entities in the URL (&amp; → &). The `t` here is a scoped preview
      // token (safe for the browser), not the real access token.
      const previewUrl = m[0].replace(/&amp;/g, "&").replace(/&#0?37;/g, "%");
      return json({ url: previewUrl, format: fmt });
    }
    return json({ error: "no_preview" }, 404);
  } catch (e) {
    return json({ error: (e as Error).message || "preview_error" }, 500);
  }
});
