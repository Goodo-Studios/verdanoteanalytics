import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Auth
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const { data: userRole } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
  if (!userRole || !["builder", "employee"].includes(userRole.role)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/competitor-ads\/?/, "").replace(/\/$/, "");

  try {
    // GET /competitor-ads — list competitors
    if (req.method === "GET" && !path) {
      const accountId = url.searchParams.get("account_id");
      let query = supabase.from("competitors").select("*").order("created_at", { ascending: false });
      if (accountId && accountId !== "all") query = query.eq("account_id", accountId);
      const { data, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify(data || []), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // POST /competitor-ads — create competitor
    if (req.method === "POST" && !path) {
      const body = await req.json();
      const { account_id, brand_name, facebook_page_id, facebook_page_name, notes } = body;
      if (!account_id || !brand_name) {
        return new Response(JSON.stringify({ error: "account_id and brand_name required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data, error } = await supabase.from("competitors").insert({
        account_id, brand_name,
        facebook_page_id: facebook_page_id || null,
        facebook_page_name: facebook_page_name || null,
        notes: notes || null,
      }).select().single();
      if (error) throw error;
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // DELETE /competitor-ads/:id
    if (req.method === "DELETE" && path) {
      const { error } = await supabase.from("competitors").delete().eq("id", path);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // PUT /competitor-ads/:id — update competitor
    if (req.method === "PUT" && path) {
      const body = await req.json();
      const update: Record<string, any> = {};
      if (body.brand_name !== undefined) update.brand_name = body.brand_name;
      if (body.facebook_page_id !== undefined) update.facebook_page_id = body.facebook_page_id;
      if (body.facebook_page_name !== undefined) update.facebook_page_name = body.facebook_page_name;
      if (body.notes !== undefined) update.notes = body.notes;
      const { data, error } = await supabase.from("competitors").update(update).eq("id", path).select().single();
      if (error) throw error;
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET /competitor-ads/library?page_id=...&search_terms=...
    if (req.method === "GET" && path === "library") {
      const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
      if (!META_TOKEN) {
        return new Response(JSON.stringify({ error: "Meta access token not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const pageId = url.searchParams.get("page_id");
      const searchTerms = url.searchParams.get("search_terms");
      const country = url.searchParams.get("country") || "US";
      const limit = url.searchParams.get("limit") || "25";

      if (!pageId && !searchTerms) {
        return new Response(JSON.stringify({ error: "page_id or search_terms required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Build Ad Library API URL
      const params = new URLSearchParams({
        access_token: META_TOKEN,
        ad_type: "ALL",
        ad_reached_countries: `["${country}"]`,
        ad_active_status: "ACTIVE",
        fields: "id,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_creative_link_descriptions,ad_delivery_start_time,ad_delivery_stop_time,page_id,page_name,publisher_platforms,estimated_audience_size,spend_data",
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
        return new Response(JSON.stringify({ error: data.error?.message || "Ad Library API error", detail: data }), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Transform results
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
      }));

      return new Response(JSON.stringify({
        ads,
        paging: data.paging || null,
        total: ads.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET /competitor-ads/page-search?q=... — search for FB pages
    if (req.method === "GET" && path === "page-search") {
      const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
      if (!META_TOKEN) {
        return new Response(JSON.stringify({ error: "Meta access token not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const q = url.searchParams.get("q");
      if (!q) {
        return new Response(JSON.stringify({ error: "q parameter required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Use the Ad Library API page search
      const apiUrl = `https://graph.facebook.com/v22.0/ads_archive?access_token=${META_TOKEN}&ad_type=ALL&ad_reached_countries=["US"]&search_terms=${encodeURIComponent(q)}&fields=page_id,page_name&limit=10`;

      const resp = await fetch(apiUrl);
      const data = await resp.json();

      if (!resp.ok) {
        return new Response(JSON.stringify({ error: data.error?.message || "Page search failed" }), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Extract unique pages
      const pageMap = new Map<string, string>();
      for (const ad of data.data || []) {
        if (ad.page_id && ad.page_name) pageMap.set(ad.page_id, ad.page_name);
      }
      const pages = Array.from(pageMap.entries()).map(([id, name]) => ({ page_id: id, page_name: name }));

      return new Response(JSON.stringify(pages), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("competitor-ads error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
