import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const slug = url.pathname.split("/").pop();

    if (!slug) {
      return new Response(JSON.stringify({ error: "Slug required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch account by slug
    const { data: account, error: accErr } = await supabase
      .from("ad_accounts")
      .select("id, name, logo_url, portfolio_enabled, portfolio_headline, portfolio_results, portfolio_cta_url")
      .eq("portfolio_slug", slug)
      .eq("portfolio_enabled", true)
      .single();

    if (accErr || !account) {
      return new Response(JSON.stringify({ error: "Portfolio not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch aggregate metrics
    const { data: creatives } = await supabase
      .from("creatives")
      .select("spend, roas, purchases, thumbnail_url, ad_id")
      .eq("account_id", account.id)
      .order("roas", { ascending: false });

    const all = creatives || [];
    const totalSpend = all.reduce((s, c) => s + (Number(c.spend) || 0), 0);
    const totalPurchases = all.reduce((s, c) => s + (Number(c.purchases) || 0), 0);
    const withSpend = all.filter(c => (Number(c.spend) || 0) > 0);
    const blendedRoas = withSpend.length > 0
      ? withSpend.reduce((s, c) => s + (Number(c.roas) || 0) * (Number(c.spend) || 0), 0) / totalSpend
      : 0;

    // Top 6 creatives by ROAS (with thumbnail)
    const topCreatives = all
      .filter(c => c.thumbnail_url && (Number(c.roas) || 0) > 0)
      .slice(0, 6)
      .map(c => ({
        thumbnail_url: c.thumbnail_url,
        roas: Number(c.roas) || 0,
        spend: Number(c.spend) || 0,
      }));

    return new Response(JSON.stringify({
      name: account.name,
      logo_url: account.logo_url,
      headline: account.portfolio_headline || "Creative Performance",
      results: account.portfolio_results || [],
      cta_url: account.portfolio_cta_url || "https://goodostudios.com",
      metrics: {
        totalSpend,
        blendedRoas,
        totalPurchases,
      },
      topCreatives,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("portfolio error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
