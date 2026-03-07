import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const META_API_VERSION = "v22.0";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: { user }, error } = await anonClient.auth.getUser(token);
      if (error || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { account_id } = await req.json();
    if (!account_id) {
      return new Response(JSON.stringify({ error: "account_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get account settings
    const { data: account, error: accErr } = await supabase
      .from("ad_accounts")
      .select("id, name, date_range_days, click_window, view_window")
      .eq("id", account_id)
      .single();

    if (accErr || !account) {
      return new Response(JSON.stringify({ error: "Account not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const metaToken = Deno.env.get("META_ACCESS_TOKEN");
    if (!metaToken) {
      return new Response(JSON.stringify({ error: "META_ACCESS_TOKEN not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dateRangeDays = account.date_range_days || 180;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - dateRangeDays);

    const since = startDate.toISOString().split("T")[0];
    const until = endDate.toISOString().split("T")[0];
    const timeRange = JSON.stringify({ since, until });

    // 1) Fetch account-level spend from Meta (single API call)
    const metaUrl =
      `https://graph.facebook.com/${META_API_VERSION}/${account_id}/insights?` +
      `time_range=${encodeURIComponent(timeRange)}` +
      `&fields=spend,impressions,clicks,actions,action_values` +
      `&access_token=${encodeURIComponent(metaToken)}`;

    const metaResp = await fetch(metaUrl);
    const metaJson = await metaResp.json();

    let metaSpend = 0;
    let metaImpressions = 0;
    let metaPurchases = 0;
    let metaPurchaseValue = 0;

    if (metaJson.error) {
      console.error("Meta API error:", metaJson.error);
      return new Response(JSON.stringify({
        error: `Meta API error: ${metaJson.error.message}`,
      }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (metaJson.data && metaJson.data.length > 0) {
      const row = metaJson.data[0];
      metaSpend = parseFloat(row.spend || "0");
      metaImpressions = parseInt(row.impressions || "0");

      // Parse purchases from actions
      if (row.actions) {
        for (const action of row.actions) {
          if (
            action.action_type === "purchase" ||
            action.action_type === "omni_purchase" ||
            action.action_type === "offsite_conversion.fb_pixel_purchase"
          ) {
            metaPurchases += parseInt(action.value || "0");
          }
        }
      }
      if (row.action_values) {
        for (const av of row.action_values) {
          if (
            av.action_type === "purchase" ||
            av.action_type === "omni_purchase" ||
            av.action_type === "offsite_conversion.fb_pixel_purchase"
          ) {
            metaPurchaseValue += parseFloat(av.value || "0");
          }
        }
      }
    }

    // 2) Sum spend from Verdanote's creatives table (snapshot) for same account
    const { data: creatives, error: crErr } = await supabase
      .from("creatives")
      .select("spend, impressions, purchases, purchase_value")
      .eq("account_id", account_id);

    if (crErr) {
      return new Response(JSON.stringify({ error: crErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let vnSpend = 0;
    let vnImpressions = 0;
    let vnPurchases = 0;
    let vnPurchaseValue = 0;
    let creativeCount = 0;

    for (const c of creatives || []) {
      vnSpend += c.spend || 0;
      vnImpressions += c.impressions || 0;
      vnPurchases += c.purchases || 0;
      vnPurchaseValue += c.purchase_value || 0;
      creativeCount++;
    }

    // 2b) Sum spend from creative_daily_metrics (accurate historical aggregation)
    let dailySpend = 0;
    let dailyImpressions = 0;
    let dailyPurchases = 0;
    let dailyPurchaseValue = 0;
    let dailyAdIds = new Set<string>();
    let dailyOffset = 0;
    const DAILY_PAGE = 1000;

    while (true) {
      const { data: dailyRows, error: dailyErr } = await supabase
        .from("creative_daily_metrics")
        .select("ad_id, spend, impressions, purchases, purchase_value")
        .eq("account_id", account_id)
        .gte("date", since)
        .lte("date", until)
        .range(dailyOffset, dailyOffset + DAILY_PAGE - 1);

      if (dailyErr) {
        console.error("Daily metrics query error:", dailyErr.message);
        break;
      }
      if (!dailyRows || dailyRows.length === 0) break;

      for (const row of dailyRows) {
        dailySpend += row.spend || 0;
        dailyImpressions += row.impressions || 0;
        dailyPurchases += row.purchases || 0;
        dailyPurchaseValue += row.purchase_value || 0;
        if (row.ad_id) dailyAdIds.add(row.ad_id);
      }

      if (dailyRows.length < DAILY_PAGE) break;
      dailyOffset += DAILY_PAGE;
    }

    // 3) Also check ad-level insights count from Meta to compare creative counts
    const countUrl =
      `https://graph.facebook.com/${META_API_VERSION}/${account_id}/insights?` +
      `time_range=${encodeURIComponent(timeRange)}&level=ad` +
      `&fields=ad_id&limit=0&summary=total_count` +
      `&access_token=${encodeURIComponent(metaToken)}`;

    let metaAdCount: number | null = null;
    try {
      const countResp = await fetch(countUrl);
      const countJson = await countResp.json();
      if (countJson.summary?.total_count !== undefined) {
        metaAdCount = countJson.summary.total_count;
      }
    } catch (e) {
      console.error("Failed to fetch ad count:", e);
    }

    const spendDelta = vnSpend - metaSpend;
    const spendDeltaPct = metaSpend > 0 ? ((spendDelta / metaSpend) * 100) : 0;

    const result = {
      account_name: account.name,
      date_range: { since, until, days: dateRangeDays },
      attribution: { click_window: account.click_window, view_window: account.view_window },
      meta: {
        spend: Math.round(metaSpend * 100) / 100,
        impressions: metaImpressions,
        purchases: metaPurchases,
        purchase_value: Math.round(metaPurchaseValue * 100) / 100,
        roas: metaSpend > 0 ? Math.round((metaPurchaseValue / metaSpend) * 100) / 100 : 0,
        ad_count: metaAdCount,
      },
      verdanote: {
        spend: Math.round(vnSpend * 100) / 100,
        impressions: vnImpressions,
        purchases: vnPurchases,
        purchase_value: Math.round(vnPurchaseValue * 100) / 100,
        roas: vnSpend > 0 ? Math.round((vnPurchaseValue / vnSpend) * 100) / 100 : 0,
        creative_count: creativeCount,
      },
      delta: {
        spend: Math.round(spendDelta * 100) / 100,
        spend_pct: Math.round(spendDeltaPct * 100) / 100,
        impressions: vnImpressions - metaImpressions,
        ad_count: metaAdCount !== null ? creativeCount - metaAdCount : null,
      },
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Spend diagnostic error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
