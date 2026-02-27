import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withApiAuth, corsHeaders } from "../_shared/api-auth.ts";

serve(withApiAuth(async (req, { userId, permissions }) => {
  if (!permissions.includes("read")) {
    return new Response(
      JSON.stringify({ error: "Insufficient permissions" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\/functions\/v1\/api\/?/, "").replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const resource = pathParts[0];
  const resourceId = pathParts[1];

  try {
    // GET /api/accounts
    if (resource === "accounts" && req.method === "GET") {
      const { data, error } = await supabase
        .from("ad_accounts")
        .select("id, name, creative_count, untagged_count, last_synced_at, is_active, created_at")
        .order("name");

      if (error) throw error;
      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /api/creatives or /api/creatives/:id
    if (resource === "creatives" && req.method === "GET") {
      if (resourceId) {
        const { data, error } = await supabase
          .from("creatives")
          .select("ad_id, ad_name, account_id, spend, roas, ctr, cpa, cpm, cpc, impressions, clicks, purchases, purchase_value, adds_to_cart, hook, theme, product, style, person, ad_type, ad_status, thumbnail_url, created_at, updated_at")
          .eq("ad_id", resourceId)
          .single();

        if (error) throw error;
        return new Response(JSON.stringify({ data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const accountId = url.searchParams.get("account_id");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
      const offset = parseInt(url.searchParams.get("offset") || "0");

      let query = supabase
        .from("creatives")
        .select("ad_id, ad_name, account_id, spend, roas, ctr, cpa, cpm, cpc, impressions, clicks, purchases, purchase_value, adds_to_cart, hook, theme, product, style, person, ad_type, ad_status, thumbnail_url, created_at, updated_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (accountId) query = query.eq("account_id", accountId);

      const { data, error, count } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ data, total: count, limit, offset }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /api/metrics
    if (resource === "metrics" && req.method === "GET") {
      const accountId = url.searchParams.get("account_id");

      // Use server-side aggregation via RPC to handle accounts with 10k+ creatives
      // without hitting the 1000-row REST limit
      const { data, error } = await supabase.rpc("get_account_metrics", {
        p_account_id: accountId || null,
      });

      if (error) {
        // Fallback: paginate manually if RPC doesn't exist yet
        let allRows: any[] = [];
        let from = 0;
        const pageSize = 1000;
        while (true) {
          let q = supabase
            .from("creatives")
            .select("spend, impressions, clicks, purchases, purchase_value")
            .range(from, from + pageSize - 1);
          if (accountId) q = q.eq("account_id", accountId);
          const { data: page, error: pageErr } = await q;
          if (pageErr || !page || page.length === 0) break;
          allRows = allRows.concat(page);
          if (page.length < pageSize) break;
          from += pageSize;
        }

        const total_spend = allRows.reduce((s, c) => s + (c.spend || 0), 0);
        const total_purchase_value = allRows.reduce((s, c) => s + (c.purchase_value || 0), 0);
        const total_impressions = allRows.reduce((s, c) => s + (c.impressions || 0), 0);
        const total_clicks = allRows.reduce((s, c) => s + (c.clicks || 0), 0);
        const total_purchases = allRows.reduce((s, c) => s + (c.purchases || 0), 0);

        return new Response(JSON.stringify({
          data: {
            total_creatives: allRows.length,
            total_spend: Math.round(total_spend * 100) / 100,
            total_purchase_value: Math.round(total_purchase_value * 100) / 100,
            total_impressions,
            total_clicks,
            total_purchases,
            blended_roas: total_spend > 0 ? Math.round((total_purchase_value / total_spend) * 100) / 100 : 0,
            avg_ctr: total_impressions > 0 ? Math.round((total_clicks / total_impressions) * 10000) / 100 : 0,
            avg_cpa: total_purchases > 0 ? Math.round((total_spend / total_purchases) * 100) / 100 : 0,
          },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("API error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
