import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";


const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Auth
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json({ error: "Unauthorized" }, 401);
  const { data: userRole } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
  if (!userRole || !["builder", "employee"].includes(userRole.role)) return json({ error: "Forbidden" }, 403);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/competitor-ads\/?/, "").replace(/\/$/, "");

  try {
    // ─── COMPETITORS CRUD ───

    // GET /competitor-ads — list competitors with saved ad counts
    if (req.method === "GET" && !path) {
      const accountId = url.searchParams.get("account_id");
      let query = supabase.from("competitors").select("*").order("created_at", { ascending: false });
      if (accountId && accountId !== "all") query = query.eq("account_id", accountId);
      const { data: competitors, error } = await query;
      if (error) throw error;

      // Attach saved ad counts
      const ids = (competitors || []).map((c: any) => c.id);
      const adCounts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: ads } = await supabase
          .from("competitor_ads")
          .select("competitor_id")
          .in("competitor_id", ids);
        for (const ad of ads || []) {
          adCounts[ad.competitor_id] = (adCounts[ad.competitor_id] || 0) + 1;
        }
      }

      const result = (competitors || []).map((c: any) => ({
        ...c,
        saved_ad_count: adCounts[c.id] || 0,
      }));

      return json(result);
    }

    // POST /competitor-ads — create competitor
    if (req.method === "POST" && !path) {
      const body = await req.json();
      const { account_id, brand_name, facebook_page_id, facebook_page_name, notes } = body;
      if (!account_id || !brand_name) return json({ error: "account_id and brand_name required" }, 400);
      const { data, error } = await supabase.from("competitors").insert({
        account_id, brand_name,
        facebook_page_id: facebook_page_id || null,
        facebook_page_name: facebook_page_name || null,
        notes: notes || null,
      }).select().single();
      if (error) throw error;
      return json(data);
    }

    // DELETE /competitor-ads/:id (competitor)
    if (req.method === "DELETE" && path && !path.includes("/")) {
      // Check if it's a saved-ad delete
      const isSavedAd = url.searchParams.get("type") === "saved-ad";
      if (isSavedAd) {
        const { error } = await supabase.from("competitor_ads").delete().eq("id", path);
        if (error) throw error;
        return json({ success: true });
      }
      const { error } = await supabase.from("competitors").delete().eq("id", path);
      if (error) throw error;
      return json({ success: true });
    }

    // PUT /competitor-ads/:id — update competitor
    if (req.method === "PUT" && path && !path.includes("/")) {
      const body = await req.json();
      const update: Record<string, any> = {};
      if (body.brand_name !== undefined) update.brand_name = body.brand_name;
      if (body.facebook_page_id !== undefined) update.facebook_page_id = body.facebook_page_id;
      if (body.facebook_page_name !== undefined) update.facebook_page_name = body.facebook_page_name;
      if (body.notes !== undefined) update.notes = body.notes;
      const { data, error } = await supabase.from("competitors").update(update).eq("id", path).select().single();
      if (error) throw error;
      return json(data);
    }

    // ─── FETCH ADS FROM META AD LIBRARY ───

    // GET /competitor-ads/library?page_id=...&search_terms=...
    if (req.method === "GET" && path === "library") {
      const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
      if (!META_TOKEN) return json({ error: "Meta access token not configured" }, 500);

      const pageId = url.searchParams.get("page_id");
      const searchTerms = url.searchParams.get("search_terms");
      const country = url.searchParams.get("country") || "US";
      const limit = url.searchParams.get("limit") || "25";

      if (!pageId && !searchTerms) return json({ error: "page_id or search_terms required" }, 400);

      const params = new URLSearchParams({
        access_token: META_TOKEN,
        ad_type: "ALL",
        ad_reached_countries: `["${country}"]`,
        ad_active_status: "ACTIVE",
        fields: "id,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_creative_link_descriptions,ad_delivery_start_time,ad_delivery_stop_time,page_id,page_name,publisher_platforms,estimated_audience_size",
        limit,
      });

      if (pageId) params.set("search_page_ids", pageId);
      if (searchTerms) params.set("search_terms", searchTerms);

      const apiUrl = `https://graph.facebook.com/v22.0/ads_archive?${params.toString()}`;
      console.log("Fetching Ad Library:", apiUrl.replace(META_TOKEN, "***"));

      const resp = await fetch(apiUrl);
      const data = await resp.json();

      if (!resp.ok) {
        console.error("Ad Library API error:", JSON.stringify(data));
        return json({ error: data.error?.message || "Ad Library API error", detail: data }, resp.status);
      }

      // Check which ads are already saved
      const archiveIds = (data.data || []).map((ad: any) => ad.id).filter(Boolean);
      let savedSet = new Set<string>();
      if (archiveIds.length > 0) {
        const { data: saved } = await supabase
          .from("competitor_ads")
          .select("ad_archive_id")
          .in("ad_archive_id", archiveIds);
        savedSet = new Set((saved || []).map((s: any) => s.ad_archive_id));
      }

      const ads = (data.data || []).map((ad: any) => ({
        id: ad.id,
        page_name: ad.page_name || "",
        page_id: ad.page_id || "",
        bodies: ad.ad_creative_bodies || [],
        titles: ad.ad_creative_link_titles || [],
        captions: ad.ad_creative_link_captions || [],
        descriptions: ad.ad_creative_link_descriptions || [],
        start_date: ad.ad_delivery_start_time || null,
        stop_date: ad.ad_delivery_stop_time || null,
        platforms: ad.publisher_platforms || [],
        audience_size: ad.estimated_audience_size || null,
        is_saved: savedSet.has(ad.id),
      }));

      return json({ ads, paging: data.paging || null, total: ads.length });
    }

    // ─── SAVE / UNSAVE ADS ───

    // POST /competitor-ads/save-ad — save an ad to swipe file
    if (req.method === "POST" && path === "save-ad") {
      const body = await req.json();
      const { competitor_id, ad_archive_id, ad_creative_body, thumbnail_url, video_url, started_running, is_active, platforms } = body;
      if (!competitor_id || !ad_archive_id) return json({ error: "competitor_id and ad_archive_id required" }, 400);

      const { data, error } = await supabase.from("competitor_ads").upsert({
        competitor_id,
        ad_archive_id,
        ad_creative_body: ad_creative_body || null,
        thumbnail_url: thumbnail_url || null,
        video_url: video_url || null,
        started_running: started_running || null,
        is_active: is_active ?? true,
        platforms: platforms || [],
      }, { onConflict: "ad_archive_id" }).select().single();
      if (error) throw error;
      return json(data);
    }

    // GET /competitor-ads/saved?competitor_id=... — list saved ads
    if (req.method === "GET" && path === "saved") {
      const competitorId = url.searchParams.get("competitor_id");
      let query = supabase.from("competitor_ads").select("*").order("saved_at", { ascending: false });
      if (competitorId) query = query.eq("competitor_id", competitorId);
      const { data, error } = await query;
      if (error) throw error;
      return json(data || []);
    }

    // ─── PAGE SEARCH ───

    if (req.method === "GET" && path === "page-search") {
      const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
      if (!META_TOKEN) return json({ error: "Meta access token not configured" }, 500);

      const q = url.searchParams.get("q");
      if (!q) return json({ error: "q parameter required" }, 400);

      const apiUrl = `https://graph.facebook.com/v22.0/ads_archive?access_token=${META_TOKEN}&ad_type=ALL&ad_reached_countries=["US"]&search_terms=${encodeURIComponent(q)}&fields=page_id,page_name&limit=10`;
      const resp = await fetch(apiUrl);
      const data = await resp.json();

      if (!resp.ok) return json({ error: data.error?.message || "Page search failed" }, resp.status);

      const pageMap = new Map<string, string>();
      for (const ad of data.data || []) {
        if (ad.page_id && ad.page_name) pageMap.set(ad.page_id, ad.page_name);
      }
      return json(Array.from(pageMap.entries()).map(([id, name]) => ({ page_id: id, page_name: name })));
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("competitor-ads error:", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});
