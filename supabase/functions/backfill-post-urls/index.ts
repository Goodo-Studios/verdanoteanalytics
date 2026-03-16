import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_API_VERSION = "v22.0";
const BUDGET_MS = 100_000; // 100s budget

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const metaToken = Deno.env.get("META_ACCESS_TOKEN")!;
  const startMs = Date.now();
  const isTimedOut = () => Date.now() - startMs > BUDGET_MS;

  try {
    const body = await req.json().catch(() => ({}));
    const accountId = body.account_id;

    if (!accountId) {
      return new Response(JSON.stringify({ error: "account_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch creatives missing ad_post_url
    const { data: missing, error: fetchErr } = await supabase
      .from("creatives")
      .select("ad_id")
      .eq("account_id", accountId)
      .is("ad_post_url", null)
      .gt("impressions", 0)
      .limit(500);

    if (fetchErr) throw fetchErr;
    if (!missing?.length) {
      return new Response(JSON.stringify({ status: "none_missing", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Backfilling ad_post_url for ${missing.length} creatives in ${accountId}`);

    let updated = 0;
    let failed = 0;

    // Process in batches of 50 using Meta batch API field expansion
    const batchSize = 50;
    for (let i = 0; i < missing.length && !isTimedOut(); i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const adIds = batch.map((c: any) => c.ad_id);

      // Fetch creative data for batch
      const url = `https://graph.facebook.com/${META_API_VERSION}/?ids=${adIds.join(",")}&fields=creative{effective_object_story_id}&access_token=${encodeURIComponent(metaToken)}`;

      try {
        const resp = await fetch(url);
        const json = await resp.json();

        if (json.error) {
          console.error("Batch fetch error:", json.error.message);
          failed += batch.length;
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        const updates: { ad_id: string; ad_post_url: string }[] = [];

        for (const adId of adIds) {
          const adData = json[adId];
          if (!adData || adData.error) continue;

          let postUrl: string | null = null;

          // Try effective_object_story_id first
          const storyId = adData.creative?.effective_object_story_id;
          if (storyId && storyId.includes("_")) {
            const [pageId, postId] = storyId.split("_", 2);
            if (pageId && postId) {
              postUrl = `https://www.facebook.com/${pageId}/posts/${postId}/`;
            }
          }

          // Fallback to permalink_url
          if (!postUrl && adData.creative?.permalink_url) {
            postUrl = adData.creative.permalink_url;
          }

          if (postUrl) {
            updates.push({ ad_id: adId, ad_post_url: postUrl });
          }
        }

        // Batch update
        for (const u of updates) {
          const { error: updErr } = await supabase
            .from("creatives")
            .update({ ad_post_url: u.ad_post_url })
            .eq("ad_id", u.ad_id);
          if (!updErr) updated++;
          else failed++;
        }

        // Rate limit courtesy delay
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error("Batch processing error:", err);
        failed += batch.length;
      }
    }

    console.log(`Backfill complete: ${updated} updated, ${failed} failed`);

    return new Response(
      JSON.stringify({ status: "completed", updated, failed, total_missing: missing.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("backfill-post-urls error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
