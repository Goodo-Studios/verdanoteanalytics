// vault-ads — port from Creative Vault (US-002). User-scoped only; no workspace concept.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const META_GRAPH_URL = "https://graph.facebook.com/v22.0";
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const metaToken = Deno.env.get("META_ACCESS_TOKEN");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const db = createClient(supabaseUrl, serviceRoleKey);

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    // ─── SEARCH ───────────────────────────────────────────────────
    if (req.method === "GET" && action === "search") {
      if (!metaToken) return json({ error: "META_ACCESS_TOKEN not configured" }, 500);

      const q = url.searchParams.get("q");
      const pageId = url.searchParams.get("page_id");
      const country = url.searchParams.get("country") || "US";
      const limit = url.searchParams.get("limit") || "24";

      if (!q && !pageId) return json({ error: "q or page_id required" }, 400);

      const params = new URLSearchParams({
        access_token: metaToken,
        ad_type: "ALL",
        ad_reached_countries: `["${country}"]`,
        fields: [
          "id",
          "ad_creative_bodies",
          "ad_creative_link_titles",
          "ad_creative_link_captions",
          "ad_delivery_start_time",
          "ad_delivery_stop_time",
          "page_id",
          "page_name",
          "publisher_platforms",
          "snapshot_url",
        ].join(","),
        limit,
      });

      if (pageId) params.set("search_page_ids", pageId);
      if (q) params.set("search_terms", q);

      const apiRes = await fetch(`${META_GRAPH_URL}/ads_archive?${params.toString()}`);
      const apiData = await apiRes.json();

      if (!apiRes.ok) {
        return json({ error: apiData.error?.message || "Meta API error" }, apiRes.status);
      }

      // Flag which ads are already saved by this user
      const archiveIds = (apiData.data || []).map((ad: Record<string, unknown>) => ad.id).filter(Boolean);
      let savedSet = new Set<string>();
      if (archiveIds.length > 0) {
        const { data: saved } = await db
          .from("inspiration_items")
          .select("ad_archive_id")
          .eq("user_id", user.id)
          .in("ad_archive_id", archiveIds);
        savedSet = new Set((saved || []).map((s: Record<string, unknown>) => s.ad_archive_id as string));
      }

      const ads = (apiData.data || []).map((ad: Record<string, unknown>) => {
        const bodies = (ad.ad_creative_bodies as string[] | undefined) ?? [];
        const titles = (ad.ad_creative_link_titles as string[] | undefined) ?? [];
        return {
          id: ad.id as string,
          page_name: (ad.page_name as string) || "",
          page_id: (ad.page_id as string) || "",
          body: bodies[0] || "",
          headline: titles[0] || "",
          start_date: (ad.ad_delivery_start_time as string) || null,
          stop_date: (ad.ad_delivery_stop_time as string) || null,
          platforms: (ad.publisher_platforms as string[]) || [],
          snapshot_url: (ad.snapshot_url as string) || null,
          is_saved: savedSet.has(ad.id as string),
        };
      });

      return json({ ads, paging: apiData.paging || null });
    }

    // ─── SAVE AD ──────────────────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json();
      const { ad_archive_id, page_name, ad_body, headline, snapshot_url: snapshotUrl } = body;

      if (!ad_archive_id) return json({ error: "ad_archive_id required" }, 400);

      // Prevent duplicates
      const { data: existing } = await db
        .from("inspiration_items")
        .select("id")
        .eq("user_id", user.id)
        .eq("ad_archive_id", ad_archive_id)
        .maybeSingle();

      if (existing) return json({ error: "Ad already saved", item_id: existing.id }, 409);

      // Download snapshot image → Supabase Storage
      let filePath: string | null = null;
      const thumbnailUrl: string | null = snapshotUrl || null;

      if (snapshotUrl) {
        try {
          const imgRes = await fetch(snapshotUrl, {
            headers: { "User-Agent": CHROME_UA },
          });
          if (imgRes.ok) {
            const imgBytes = await imgRes.arrayBuffer();
            const ct = imgRes.headers.get("content-type") || "image/jpeg";
            const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
            const storagePath = `uploads/${user.id}/${ad_archive_id}.${ext}`;
            const { error: uploadErr } = await db.storage
              .from("inspiration-media")
              .upload(storagePath, imgBytes, { contentType: ct, upsert: true });
            if (!uploadErr) filePath = storagePath;
          }
        } catch (e) {
          console.error("Snapshot download failed, continuing:", e);
        }
      }

      // Create inspiration_items row
      const adLibraryUrl = `https://www.facebook.com/ads/library/?id=${ad_archive_id}`;
      const { data: item, error: insertErr } = await db
        .from("inspiration_items")
        .insert({
          user_id: user.id,
          platform: "facebook_ad",
          source_url: adLibraryUrl,
          creator_handle: page_name || null,
          title: headline || null,
          thumbnail_url: thumbnailUrl,
          file_path: filePath,
          ad_archive_id,
          ad_body_text: ad_body || null,
          status: "analyzing",
        })
        .select()
        .single();

      if (insertErr || !item) throw new Error(insertErr?.message || "Failed to create item");

      // Build the "script" from ad copy — skip transcription entirely
      const adCopy = [headline, ad_body].filter(Boolean).join("\n\n");
      if (adCopy) {
        await db.from("inspiration_transcripts").insert({
          item_id: item.id,
          raw_transcript: adCopy,
          cleaned_script: adCopy, // already clean — vault-analyze will skip Call 1
          word_count: adCopy.split(/\s+/).filter(Boolean).length,
        });
      }

      // Chain straight to framework extraction
      EdgeRuntime.waitUntil(
        fetch(`${supabaseUrl}/functions/v1/vault-analyze`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ item_id: item.id }),
        }).catch(console.error)
      );

      return json({ ok: true, item_id: item.id });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("vault-ads error:", err);
    return json({ error: String(err) }, 500);
  }
});
