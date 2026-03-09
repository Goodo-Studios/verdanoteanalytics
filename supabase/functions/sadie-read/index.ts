import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Private API key for Sadie — set this in Supabase edge function secrets
const SADIE_API_KEY = Deno.env.get("SADIE_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sadie-key",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth check
  const apiKey = req.headers.get("x-sadie-key");
  if (!apiKey || apiKey !== SADIE_API_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  const path = url.pathname.split("/sadie-read/")[1] || "";
  const accountId = url.searchParams.get("account_id");
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const orderBy = url.searchParams.get("order_by") || "spend";
  const direction = url.searchParams.get("direction") === "asc" ? true : false;

  try {
    // GET /sadie-read/accounts — list all active accounts
    if (path === "accounts" || path === "") {
      const { data, error } = await supabase
        .from("ad_accounts")
        .select("id, name, creative_count, last_synced_at, kill_scale_kpi, winner_kpi, date_range_days")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return json({ accounts: data });
    }

    // GET /sadie-read/creatives — top creatives for an account
    if (path === "creatives") {
      if (!accountId) return json({ error: "account_id required" }, 400);
      const { data, error } = await supabase
        .from("creatives")
        .select(`
          ad_id, ad_name, unique_code,
          spend, roas, cpa, ctr, cpm, cpc,
          impressions, clicks, purchases, purchase_value,
          video_views, thumb_stop_rate, hold_rate, video_avg_play_time,
          adds_to_cart, cost_per_add_to_cart,
          frequency, ad_status, tag_source,
          campaign_name, adset_name,
          created_at
        `)
        .eq("account_id", accountId)
        .gt("impressions", 0)
        .order(orderBy, { ascending: direction, nullsFirst: false })
        .limit(limit);
      if (error) throw error;
      return json({ creatives: data, count: data?.length });
    }

    // GET /sadie-read/top — top performers across ALL accounts
    if (path === "top") {
      const query = supabase
        .from("creatives")
        .select(`
          ad_id, ad_name, unique_code, account_id,
          spend, roas, cpa, ctr, purchases,
          video_views, thumb_stop_rate, hold_rate,
          ad_status, campaign_name, tag_source
        `)
        .gt("spend", 500)
        .gt("impressions", 0)
        .order("roas", { ascending: false, nullsFirst: false })
        .limit(limit);
      const { data, error } = await query;
      if (error) throw error;
      return json({ creatives: data, count: data?.length });
    }

    // GET /sadie-read/summary — account-level summary stats
    if (path === "summary") {
      if (!accountId) {
        // All accounts summary
        const { data, error } = await supabase
          .from("ad_accounts")
          .select("id, name, creative_count, last_synced_at")
          .eq("is_active", true);
        if (error) throw error;

        // Get aggregate stats per account
        const summaries = await Promise.all((data || []).map(async (acc) => {
          const { data: stats } = await supabase
            .from("creatives")
            .select("spend, roas, cpa, purchases, impressions")
            .eq("account_id", acc.id)
            .gt("impressions", 0);

          const totals = (stats || []).reduce((acc, c) => ({
            total_spend: acc.total_spend + (c.spend || 0),
            total_purchases: acc.total_purchases + (c.purchases || 0),
            total_impressions: acc.total_impressions + (c.impressions || 0),
            count: acc.count + 1,
          }), { total_spend: 0, total_purchases: 0, total_impressions: 0, count: 0 });

          const avgRoas = stats?.length
            ? stats.filter(c => c.roas).reduce((s, c) => s + (c.roas || 0), 0) / stats.filter(c => c.roas).length
            : null;

          return { ...acc, ...totals, avg_roas: avgRoas ? Math.round(avgRoas * 100) / 100 : null };
        }));

        return json({ accounts: summaries });
      }

      // Single account summary
      const { data: stats, error } = await supabase
        .from("creatives")
        .select("spend, roas, cpa, purchases, impressions, thumb_stop_rate, hold_rate, ad_status")
        .eq("account_id", accountId)
        .gt("impressions", 0);
      if (error) throw error;

      const active = (stats || []).filter(c => c.ad_status === "ACTIVE");
      const withRoas = (stats || []).filter(c => c.roas && c.roas > 0);
      const withThumb = (stats || []).filter(c => c.thumb_stop_rate);
      const withHold = (stats || []).filter(c => c.hold_rate);

      const summary = {
        total_creatives: stats?.length,
        active_creatives: active.length,
        total_spend: Math.round((stats || []).reduce((s, c) => s + (c.spend || 0), 0) * 100) / 100,
        total_purchases: (stats || []).reduce((s, c) => s + (c.purchases || 0), 0),
        avg_roas: withRoas.length ? Math.round(withRoas.reduce((s, c) => s + (c.roas || 0), 0) / withRoas.length * 100) / 100 : null,
        avg_cpa: stats?.length ? Math.round((stats || []).filter(c => c.cpa).reduce((s, c) => s + (c.cpa || 0), 0) / (stats || []).filter(c => c.cpa).length * 100) / 100 : null,
        avg_thumb_stop_rate: withThumb.length ? Math.round(withThumb.reduce((s, c) => s + (c.thumb_stop_rate || 0), 0) / withThumb.length * 100) / 100 : null,
        avg_hold_rate: withHold.length ? Math.round(withHold.reduce((s, c) => s + (c.hold_rate || 0), 0) / withHold.length * 100) / 100 : null,
      };

      return json({ summary });
    }

    // GET /sadie-read/tags — tag performance breakdown
    if (path === "tags") {
      if (!accountId) return json({ error: "account_id required" }, 400);
      const { data, error } = await supabase
        .from("creatives")
        .select("spend, roas, cpa, ctr, purchases, impressions, tag_source, ad_status")
        .eq("account_id", accountId)
        .gt("impressions", 0)
        .neq("tag_source", "untagged");
      if (error) throw error;
      return json({ tags: data, count: data?.length });
    }

    // GET /sadie-read/media-stats — media URL health across one account (or all accounts)
    if (path === "media-stats") {
      const acctFilter = accountId;
      let query = supabase
        .from("creatives")
        .select("ad_id, video_url, thumbnail_url, video_views, spend, impressions")
        .gt("impressions", 0);
      if (acctFilter) query = query.eq("account_id", acctFilter);

      const { data, error } = await query.limit(50000);
      if (error) throw error;

      const rows = data || [];
      const total = rows.length;

      // Video URL buckets
      const video_storage = rows.filter(c => c.video_url && c.video_url.includes("/storage/v1/")).length;
      const video_meta_cdn = rows.filter(c => c.video_url && (c.video_url.includes("fbcdn") || c.video_url.includes("facebook.com/video"))).length;
      const video_no_video = rows.filter(c => c.video_url === "no-video").length;
      const video_null = rows.filter(c => !c.video_url).length;
      const video_other = total - video_storage - video_meta_cdn - video_no_video - video_null;

      // Thumbnail URL buckets
      const thumb_storage = rows.filter(c => c.thumbnail_url && c.thumbnail_url.includes("/storage/v1/")).length;
      const thumb_meta_cdn = rows.filter(c => c.thumbnail_url && (c.thumbnail_url.includes("fbcdn") || c.thumbnail_url.includes("scontent"))).length;
      const thumb_sentinel = rows.filter(c => c.thumbnail_url === "no-thumbnail").length;
      const thumb_null = rows.filter(c => !c.thumbnail_url).length;
      const thumb_other = total - thumb_storage - thumb_meta_cdn - thumb_sentinel - thumb_null;

      // Video ads (has video_views) with broken video_url
      const video_ad_rows = rows.filter(c => (c.video_views || 0) > 0);
      const video_ads_total = video_ad_rows.length;
      const video_ads_working = video_ad_rows.filter(c => c.video_url && c.video_url !== "no-video").length;
      const video_ads_no_url = video_ad_rows.filter(c => !c.video_url || c.video_url === "no-video").length;
      const video_ads_storage = video_ad_rows.filter(c => c.video_url && c.video_url.includes("/storage/v1/")).length;
      const video_ads_meta_cdn = video_ad_rows.filter(c => c.video_url && (c.video_url.includes("fbcdn") || c.video_url.includes("facebook.com/video"))).length;

      // Sample some broken ones for debugging
      const broken_samples = rows
        .filter(c => (c.video_views || 0) > 0 && (!c.video_url || c.video_url === "no-video"))
        .sort((a, b) => (b.spend || 0) - (a.spend || 0))
        .slice(0, 10)
        .map(c => ({ ad_id: c.ad_id, spend: c.spend, video_views: c.video_views, video_url: c.video_url }));

      // Sample working storage URLs for URL format verification
      const storage_samples = rows
        .filter(c => c.video_url && c.video_url.includes("/storage/v1/"))
        .slice(0, 3)
        .map(c => ({ ad_id: c.ad_id, video_url: c.video_url }));

      return json({
        total_creatives: total,
        account_id: acctFilter || "all",
        video_url: {
          storage: video_storage,
          meta_cdn: video_meta_cdn,
          no_video_sentinel: video_no_video,
          null: video_null,
          other: video_other,
          storage_pct: total ? ((video_storage / total) * 100).toFixed(1) + "%" : "0%",
        },
        thumbnail_url: {
          storage: thumb_storage,
          meta_cdn: thumb_meta_cdn,
          sentinel: thumb_sentinel,
          null: thumb_null,
          other: thumb_other,
          storage_pct: total ? ((thumb_storage / total) * 100).toFixed(1) + "%" : "0%",
        },
        video_ads: {
          total: video_ads_total,
          working_url: video_ads_working,
          no_url: video_ads_no_url,
          in_storage: video_ads_storage,
          on_meta_cdn: video_ads_meta_cdn,
          coverage_pct: video_ads_total ? ((video_ads_working / video_ads_total) * 100).toFixed(1) + "%" : "0%",
        },
        broken_video_samples: broken_samples,
        storage_url_samples: storage_samples,
      });
    }

    return json({ error: "Unknown endpoint. Available: accounts, creatives, top, summary, tags, media-stats" }, 404);

  } catch (e) {
    console.error("sadie-read error:", e);
    return json({ error: String(e) }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
