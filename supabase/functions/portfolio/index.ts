import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  fetchAllRows,
  PORTFOLIO_MIN_TOP_SPEND,
  PORTFOLIO_TOP_COUNT,
  summarizePortfolio,
} from "../_shared/portfolio-logic.ts";


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

    // Totals over ALL of the account's creatives. Offset paging needs a unique order, so order by
    // ad_id (creatives.ad_id is unique); the old single query was capped at 1000 rows ordered by ROAS,
    // which understated spend and purchases for large accounts.
    const rows = await fetchAllRows<{ spend: number | null; purchases: number | null; purchase_value: number | null }>(
      (from, to) =>
        supabase
          .from("creatives")
          .select("spend, purchases, purchase_value")
          .eq("account_id", account.id)
          .order("ad_id", { ascending: true })
          .range(from, to),
    );
    const { totalSpend, totalPurchases, blendedRoas } = summarizePortfolio(rows);

    // Top creatives by ROAS (with thumbnail). A minimum spend keeps a $3 ad with one lucky purchase
    // from headlining the public page.
    const { data: top, error: topErr } = await supabase
      .from("creatives")
      .select("thumbnail_url, roas, spend, ad_id")
      .eq("account_id", account.id)
      .gte("spend", PORTFOLIO_MIN_TOP_SPEND)
      .gt("roas", 0)
      .not("thumbnail_url", "is", null)
      .neq("thumbnail_url", "")
      .order("roas", { ascending: false })
      .order("ad_id", { ascending: true })
      .limit(PORTFOLIO_TOP_COUNT);
    if (topErr) throw new Error(topErr.message);

    const topCreatives = (top || []).map((c: any) => ({
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
