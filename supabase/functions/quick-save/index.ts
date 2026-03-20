import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const { url, extracted_data } = body;

    if (!url) {
      return json({ success: false, error: "URL is required" }, 400);
    }

    // Build ad record from extracted DOM data or minimal info
    const adRecord: Record<string, unknown> = {
      user_id: user.id,
      source_url: url,
      platform: "facebook",
    };

    if (extracted_data) {
      adRecord.advertiser_name = extracted_data.advertiser_name || null;
      adRecord.body_text = extracted_data.body_text || null;
      adRecord.headline = extracted_data.headline || null;
      adRecord.ad_format = extracted_data.ad_format || null;
      adRecord.cta_text = extracted_data.cta_text || null;
      adRecord.landing_page_url = extracted_data.landing_page_url || null;
      adRecord.media_urls = extracted_data.media_urls || [];
      adRecord.thumbnail_url = extracted_data.thumbnail_url || null;
      adRecord.started_running = extracted_data.started_running || null;
      adRecord.raw_data = extracted_data.raw || null;

      // Try to cache first media URL
      if (extracted_data.thumbnail_url || (extracted_data.media_urls && extracted_data.media_urls.length > 0)) {
        const imageUrl = extracted_data.thumbnail_url || extracted_data.media_urls[0];
        try {
          const cached = await cacheThumbnail(supabase, imageUrl, user.id);
          if (cached) adRecord.thumbnail_url = cached;
        } catch (e) {
          console.error("Thumbnail cache failed:", e);
        }
      }
    }

    // Check for duplicate by source_url
    const { data: existing } = await supabase
      .from("ad_library_saved_ads")
      .select("id")
      .eq("user_id", user.id)
      .eq("source_url", url)
      .maybeSingle();

    if (existing) {
      return json({ success: true, ad_id: existing.id, duplicate: true });
    }

    const { data: saved, error: insertError } = await supabase
      .from("ad_library_saved_ads")
      .insert(adRecord)
      .select("id")
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return json({ success: false, error: insertError.message }, 500);
    }

    return json({ success: true, ad_id: saved.id });
  } catch (e) {
    console.error("quick-save error:", e);
    return json({ success: false, error: "Internal error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function cacheThumbnail(
  supabase: any,
  imageUrl: string,
  userId: string
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch(imageUrl, {
      headers: { "User-Agent": CHROME_UA },
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!resp.ok) return null;

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const blob = await resp.arrayBuffer();
    const path = `${userId}/${Date.now()}-quick.${ext}`;

    const { error } = await supabase.storage
      .from("ad-media")
      .upload(path, new Uint8Array(blob), { contentType, upsert: true });

    if (error) return null;

    const { data: urlData } = supabase.storage
      .from("ad-media")
      .getPublicUrl(path);

    return urlData?.publicUrl || null;
  } catch {
    return null;
  }
}
