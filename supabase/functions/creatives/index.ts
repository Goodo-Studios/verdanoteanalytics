import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

const DISPLAY_NAMES: Record<string, string> = {
  UGCNative: "UGC Native", StudioClean: "Studio Clean", TextForward: "Text Forward",
  NoTalent: "No Talent", ProblemCallout: "Problem Callout", StatementBold: "Statement Bold",
  AuthorityIntro: "Authority Intro", BeforeAndAfter: "Before & After", PatternInterrupt: "Pattern Interrupt",
};

function toDisplayName(val: string): string { return DISPLAY_NAMES[val] || val; }

// Explicit column list avoids SELECT * overhead — only fetch what the client actually uses
const CREATIVE_COLS = [
  "ad_id", "account_id", "ad_name", "unique_code", "ad_type", "ad_status",
  "person", "style", "hook", "product", "theme", "tag_source", "notes",
  "spend", "impressions", "clicks", "ctr", "cpm", "cpc", "cpa", "roas",
  "purchases", "purchase_value", "adds_to_cart", "cost_per_add_to_cart",
  "video_views", "thumb_stop_rate", "hold_rate", "frequency", "video_avg_play_time",
  "campaign_name", "adset_name", "ad_post_url", "preview_url", "thumbnail_url", "full_res_url",
  "video_url", "scheduled_launch_date", "created_at", "updated_at",
].join(", ");

const VALID_TYPES = ["Video", "Static", "GIF", "Carousel"];
const VALID_PERSONS = ["Creator", "Customer", "Founder", "Actor", "NoTalent"];
const VALID_STYLES = ["UGCNative", "StudioClean", "TextForward", "Lifestyle"];
const VALID_HOOKS = ["ProblemCallout", "Confession", "Question", "StatementBold", "AuthorityIntro", "BeforeAndAfter", "PatternInterrupt"];

function parseAdName(adName: string) {
  const segments = adName.split("_");
  const unique_code = segments[0] || adName;
  if (segments.length === 7) {
    const [, type, person, style, product, hook, theme] = segments;
    if (VALID_TYPES.includes(type) && VALID_PERSONS.includes(person) && VALID_STYLES.includes(style) && VALID_HOOKS.includes(hook)) {
      return { unique_code, ad_type: toDisplayName(type), person: toDisplayName(person), style: toDisplayName(style), product, hook: toDisplayName(hook), theme, parsed: true };
    }
  }
  return { unique_code, ad_type: null, person: null, style: null, product: null, hook: null, theme: null, parsed: false };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Auth: require authenticated user with valid role
  const authHeader = req.headers.get("authorization");
  console.log("Auth header present:", !!authHeader, "Method:", req.method, "URL:", req.url);
  if (!authHeader) {
    console.log("No auth header found");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.replace("Bearer ", "");
  console.log("Token length:", token.length, "Token prefix:", token.substring(0, 20));
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  console.log("Auth result - user:", user?.id, "error:", authError?.message);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized", detail: authError?.message }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: userRole } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
  if (!userRole || !["builder", "employee", "client"].includes(userRole.role)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Clients can only read, not write
  if (userRole.role === "client" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Forbidden: read-only access" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/creatives\/?/, "").replace(/\/$/, "");

  try {
    // GET /creatives/filters — distinct filter values
    if (req.method === "GET" && path === "filters") {
      const controlledTypes = ["Video", "Static", "GIF", "Carousel"];
      const controlledPersons = ["Creator", "Customer", "Founder", "Actor", "No Talent"];
      const controlledStyles = ["UGC Native", "Studio Clean", "Text Forward", "Lifestyle"];
      const controlledHooks = ["Problem Callout", "Confession", "Question", "Statement Bold", "Authority Intro", "Before & After", "Pattern Interrupt"];

      const { data: products } = await supabase.from("creatives").select("product").not("product", "is", null);
      const { data: themes } = await supabase.from("creatives").select("theme").not("theme", "is", null);
      const { data: accounts } = await supabase.from("ad_accounts").select("id, name");

      const uniqueProducts = [...new Set((products || []).map((r: any) => r.product).filter(Boolean))];
      const uniqueThemes = [...new Set((themes || []).map((r: any) => r.theme).filter(Boolean))];

      return new Response(JSON.stringify({
        ad_type: controlledTypes,
        person: controlledPersons,
        style: controlledStyles,
        hook: controlledHooks,
        product: uniqueProducts,
        theme: uniqueThemes,
        accounts: accounts || [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET /creatives — list with filters + pagination
    if (req.method === "GET" && !path) {
      const accountId = url.searchParams.get("account_id");
      const adType = url.searchParams.get("ad_type");
      const person = url.searchParams.get("person");
      const style = url.searchParams.get("style");
      const hook = url.searchParams.get("hook");
      const product = url.searchParams.get("product");
      const theme = url.searchParams.get("theme");
      const tagSource = url.searchParams.get("tag_source");
      const adStatus = url.searchParams.get("ad_status");
      const delivery = url.searchParams.get("delivery");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const dateFrom = url.searchParams.get("date_from");
      const dateTo = url.searchParams.get("date_to");
      const search = url.searchParams.get("search")?.trim();

      const hasDateFilter = dateFrom || dateTo;

      if (hasDateFilter) {
        // Query daily metrics with pagination to handle >1000 rows
        const dailyData: any[] = [];
        let dmOffset = 0;
        const DM_PAGE = 1000;
        while (true) {
          let dmQuery = supabase.from("creative_daily_metrics").select("ad_id, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views, frequency, thumb_stop_rate, hold_rate, video_avg_play_time");
          if (accountId) dmQuery = dmQuery.eq("account_id", accountId);
          if (dateFrom) dmQuery = dmQuery.gte("date", dateFrom);
          if (dateTo) dmQuery = dmQuery.lte("date", dateTo);
          dmQuery = dmQuery.range(dmOffset, dmOffset + DM_PAGE - 1);

          const { data, error: dmErr } = await dmQuery;
          if (dmErr) throw dmErr;
          if (!data || data.length === 0) break;
          dailyData.push(...data);
          if (data.length < DM_PAGE) break;
          dmOffset += DM_PAGE;
        }

        // If no daily metrics exist for this date range, fall back to lifetime metrics
        if (!dailyData || dailyData.length === 0) {
          let cQuery = supabase.from("creatives").select(CREATIVE_COLS).order("spend", { ascending: false });
          if (accountId) cQuery = cQuery.eq("account_id", accountId);
          if (adType) cQuery = cQuery.eq("ad_type", adType);
          if (person) cQuery = cQuery.eq("person", person);
          if (style) cQuery = cQuery.eq("style", style);
          if (hook) cQuery = cQuery.eq("hook", hook);
          if (product) cQuery = cQuery.eq("product", product);
          if (theme) cQuery = cQuery.eq("theme", theme);
          if (tagSource) cQuery = cQuery.eq("tag_source", tagSource);
          if (adStatus) cQuery = cQuery.eq("ad_status", adStatus);
          if (delivery === "had_delivery") cQuery = cQuery.gt("spend", 0);
          if (delivery === "active") cQuery = cQuery.eq("ad_status", "ACTIVE");
          if (search) cQuery = cQuery.or(`ad_name.ilike.%${search}%,unique_code.ilike.%${search}%,campaign_name.ilike.%${search}%`);

          // Get total count
          let countQ = supabase.from("creatives").select("*", { count: "exact", head: true });
          if (accountId) countQ = countQ.eq("account_id", accountId);
          if (adType) countQ = countQ.eq("ad_type", adType);
          if (person) countQ = countQ.eq("person", person);
          if (style) countQ = countQ.eq("style", style);
          if (hook) countQ = countQ.eq("hook", hook);
          if (product) countQ = countQ.eq("product", product);
          if (theme) countQ = countQ.eq("theme", theme);
          if (tagSource) countQ = countQ.eq("tag_source", tagSource);
          if (adStatus) countQ = countQ.eq("ad_status", adStatus);
          if (delivery === "had_delivery") countQ = countQ.gt("spend", 0);
          if (delivery === "active") countQ = countQ.eq("ad_status", "ACTIVE");
          if (search) countQ = countQ.or(`ad_name.ilike.%${search}%,unique_code.ilike.%${search}%,campaign_name.ilike.%${search}%`);

          const { count } = await countQ;
          cQuery = cQuery.range(offset, offset + limit - 1);
          const { data: allC, error: cErr } = await cQuery;
          if (cErr) throw cErr;

          // Return lifetime metrics as-is (no daily data available for this range)
          return new Response(JSON.stringify({ data: allC || [], total: count || 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } else {
          // Aggregate by ad_id
          const aggMap: Record<string, any> = {};
          for (const row of dailyData) {
            if (!aggMap[row.ad_id]) {
              aggMap[row.ad_id] = { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0, adds_to_cart: 0, video_views: 0, _freq_weighted: 0, _freq_imp: 0, _tsr_weighted: 0, _tsr_imp: 0, _hr_weighted: 0, _hr_vv: 0, _vpt_weighted: 0, _vpt_vv: 0, _days: 0 };
            }
            const a = aggMap[row.ad_id];
            const imp = Number(row.impressions) || 0;
            const vv = Number(row.video_views) || 0;
            const freq = Number(row.frequency) || 0;
            const tsr = Number(row.thumb_stop_rate) || 0;
            const hr = Number(row.hold_rate) || 0;
            const vpt = Number(row.video_avg_play_time) || 0;
            a.spend += Number(row.spend) || 0;
            a.impressions += imp;
            a.clicks += Number(row.clicks) || 0;
            a.purchases += Number(row.purchases) || 0;
            a.purchase_value += Number(row.purchase_value) || 0;
            a.adds_to_cart += Number(row.adds_to_cart) || 0;
            a.video_views += vv;
            // Impressions-weighted average for frequency & thumb stop rate
            if (freq > 0 && imp > 0) { a._freq_weighted += freq * imp; a._freq_imp += imp; }
            if (tsr > 0 && imp > 0) { a._tsr_weighted += tsr * imp; a._tsr_imp += imp; }
            // Video-views-weighted average for hold rate & avg play time
            if (hr > 0 && vv > 0) { a._hr_weighted += hr * vv; a._hr_vv += vv; }
            if (vpt > 0 && vv > 0) { a._vpt_weighted += vpt * vv; a._vpt_vv += vv; }
            a._days += 1;
          }

          // Filter to ads with delivery if needed
          let relevantAdIds = Object.keys(aggMap);
          if (delivery === "had_delivery") {
            relevantAdIds = relevantAdIds.filter(id => aggMap[id].spend > 0);
          }

          if (relevantAdIds.length === 0) {
            return new Response(JSON.stringify({ data: [], total: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          // Fetch creative details for relevant ads only (batched)
          const allCreatives: any[] = [];
          for (let i = 0; i < relevantAdIds.length; i += 100) {
            const batch = relevantAdIds.slice(i, i + 100);
            let cQuery = supabase.from("creatives").select(CREATIVE_COLS).in("ad_id", batch);
            if (adType) cQuery = cQuery.eq("ad_type", adType);
            if (person) cQuery = cQuery.eq("person", person);
            if (style) cQuery = cQuery.eq("style", style);
            if (hook) cQuery = cQuery.eq("hook", hook);
            if (product) cQuery = cQuery.eq("product", product);
            if (theme) cQuery = cQuery.eq("theme", theme);
            if (tagSource) cQuery = cQuery.eq("tag_source", tagSource);
            if (adStatus) cQuery = cQuery.eq("ad_status", adStatus);
            if (search) cQuery = cQuery.or(`ad_name.ilike.%${search}%,unique_code.ilike.%${search}%,campaign_name.ilike.%${search}%`);
            const { data: cData } = await cQuery;
            if (cData) allCreatives.push(...cData);
          }

          // Merge aggregated metrics
          const result = allCreatives.map((c: any) => {
            const a = aggMap[c.ad_id] || { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0, adds_to_cart: 0, video_views: 0, _freq_weighted: 0, _freq_imp: 0, _tsr_weighted: 0, _tsr_imp: 0, _hr_weighted: 0, _hr_vv: 0, _vpt_weighted: 0, _vpt_vv: 0, _days: 1 };
            return {
              ...c,
              spend: a.spend,
              impressions: a.impressions,
              clicks: a.clicks,
              ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
              cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
              cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
              cpa: a.purchases > 0 ? a.spend / a.purchases : 0,
              roas: a.spend > 0 ? a.purchase_value / a.spend : 0,
              purchases: a.purchases,
              purchase_value: a.purchase_value,
              adds_to_cart: a.adds_to_cart,
              cost_per_add_to_cart: a.adds_to_cart > 0 ? a.spend / a.adds_to_cart : 0,
              video_views: a.video_views,
              thumb_stop_rate: a._tsr_imp > 0 ? a._tsr_weighted / a._tsr_imp : 0,
              hold_rate: a._hr_vv > 0 ? a._hr_weighted / a._hr_vv : 0,
              frequency: a._freq_imp > 0 ? a._freq_weighted / a._freq_imp : 0,
              video_avg_play_time: a._vpt_vv > 0 ? a._vpt_weighted / a._vpt_vv : 0,
            };
          });

          result.sort((a: any, b: any) => (b.spend || 0) - (a.spend || 0));
          const total = result.length;
          return new Response(JSON.stringify({ data: result.slice(offset, offset + limit), total }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // No date filter — use aggregated totals from creatives table
      // First get total count
      let countQuery = supabase.from("creatives").select("*", { count: "exact", head: true });
      if (accountId) countQuery = countQuery.eq("account_id", accountId);
      if (adType) countQuery = countQuery.eq("ad_type", adType);
      if (person) countQuery = countQuery.eq("person", person);
      if (style) countQuery = countQuery.eq("style", style);
      if (hook) countQuery = countQuery.eq("hook", hook);
      if (product) countQuery = countQuery.eq("product", product);
      if (theme) countQuery = countQuery.eq("theme", theme);
      if (tagSource) countQuery = countQuery.eq("tag_source", tagSource);
      if (adStatus) countQuery = countQuery.eq("ad_status", adStatus);
      if (delivery === "had_delivery") countQuery = countQuery.gt("spend", 0);
      if (delivery === "active") countQuery = countQuery.eq("ad_status", "ACTIVE");
      if (search) countQuery = countQuery.or(`ad_name.ilike.%${search}%,unique_code.ilike.%${search}%,campaign_name.ilike.%${search}%`);

      const { count } = await countQuery;

      let query = supabase.from("creatives").select(CREATIVE_COLS).order("spend", { ascending: false });
      if (accountId) query = query.eq("account_id", accountId);
      if (adType) query = query.eq("ad_type", adType);
      if (person) query = query.eq("person", person);
      if (style) query = query.eq("style", style);
      if (hook) query = query.eq("hook", hook);
      if (product) query = query.eq("product", product);
      if (theme) query = query.eq("theme", theme);
      if (tagSource) query = query.eq("tag_source", tagSource);
      if (adStatus) query = query.eq("ad_status", adStatus);
      if (delivery === "had_delivery") query = query.gt("spend", 0);
      if (delivery === "active") query = query.eq("ad_status", "ACTIVE");
      if (search) query = query.or(`ad_name.ilike.%${search}%,unique_code.ilike.%${search}%,campaign_name.ilike.%${search}%`);

      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify({ data: data || [], total: count || 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // PUT /creatives/:id — update tags
    if (req.method === "PUT" && path) {
      const body = await req.json();
      const { ad_type, person, style, product, hook, theme, tag_source, notes, scheduled_launch_date } = body;

      const update: Record<string, any> = {};
      if (ad_type !== undefined) update.ad_type = ad_type;
      if (person !== undefined) update.person = person;
      if (style !== undefined) update.style = style;
      if (product !== undefined) update.product = product;
      if (hook !== undefined) update.hook = hook;
      if (theme !== undefined) update.theme = theme;
      if (notes !== undefined) update.notes = notes;
      if (scheduled_launch_date !== undefined) update.scheduled_launch_date = scheduled_launch_date;

      if (tag_source === "untagged") {
        // Reset to auto — re-run tagging
        update.tag_source = "untagged";
        update.ad_type = null;
        update.person = null;
        update.style = null;
        update.product = null;
        update.hook = null;
        update.theme = null;

        const { data: creative } = await supabase.from("creatives").select("ad_name, account_id").eq("ad_id", path).single();
        if (creative) {
          const parsed = parseAdName(creative.ad_name);
          if (parsed.parsed) {
            update.ad_type = parsed.ad_type;
            update.person = parsed.person;
            update.style = parsed.style;
            update.product = parsed.product;
            update.hook = parsed.hook;
            update.theme = parsed.theme;
            update.tag_source = "parsed";
            update.unique_code = parsed.unique_code;
          } else {
            const { data: mapping } = await supabase.from("name_mappings").select("*").eq("account_id", creative.account_id).eq("unique_code", parsed.unique_code).single();
            if (mapping) {
              update.ad_type = mapping.ad_type;
              update.person = mapping.person;
              update.style = mapping.style;
              update.product = mapping.product;
              update.hook = mapping.hook;
              update.theme = mapping.theme;
              update.tag_source = "csv_match";
            }
          }
        }
      } else {
        update.tag_source = "manual";
      }

      const { data, error } = await supabase.from("creatives").update(update).eq("ad_id", path).select().single();
      if (error) throw error;

      // Update account untagged count
      if (data) {
        const { count } = await supabase.from("creatives").select("*", { count: "exact", head: true }).eq("account_id", data.account_id).eq("tag_source", "untagged");
        await supabase.from("ad_accounts").update({ untagged_count: count || 0 }).eq("id", data.account_id);
      }

      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // POST /creatives/bulk-untag — mark selected as untagged
    if (req.method === "POST" && path === "bulk-untag") {
      const { ad_ids } = await req.json();
      if (!Array.isArray(ad_ids)) {
        return new Response(JSON.stringify({ error: "ad_ids array required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { error } = await supabase.from("creatives").update({
        tag_source: "untagged", ad_type: null, person: null, style: null, product: null, hook: null, theme: null,
      }).in("ad_id", ad_ids);

      if (error) throw error;
      return new Response(JSON.stringify({ success: true, count: ad_ids.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // POST /creatives/auto-tag — infer tags from ad names for untagged creatives
    if (req.method === "POST" && path === "auto-tag") {
      const { account_id, dry_run } = await req.json();
      if (!account_id) {
        return new Response(JSON.stringify({ error: "account_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Fetch untagged creatives (tag_source = 'untagged')
      const { data: untagged, error: fetchErr } = await supabase
        .from("creatives")
        .select("ad_id, ad_name")
        .eq("account_id", account_id)
        .eq("tag_source", "untagged");
      if (fetchErr) throw fetchErr;

      // Auto-tag inference patterns
      const FORMAT_PATTERNS: [RegExp, string][] = [
        [/\bugc\b/i, "UGC"], [/\bgfx\b|graphic/i, "Graphic"],
        [/\bstatic\b|\bimg\b|\bimage\b/i, "Static Image"], [/\bvid\b|\bvideo\b/i, "Video"],
        [/carousel/i, "Carousel"], [/\bdpa\b/i, "DPA"],
      ];
      const HOOK_PATTERNS: [RegExp, string][] = [
        [/testimonial|review/i, "Testimonial"], [/unboxing/i, "Unboxing"],
        [/comparison|\bvs\b|competitor/i, "Competitor Comparison"],
        [/problem|pain/i, "Problem/Solution"], [/educational|\bedu\b|how\s*to/i, "Educational"],
        [/founder|behind/i, "Founder Story"],
      ];
      const ANGLE_PATTERNS: [RegExp, string][] = [
        [/sale|discount|%|\boff\b/i, "Offer/Discount"], [/\bfree\b/i, "Free Gift/Trial"],
        [/too expensive|objection/i, "Objection Handling"],
        [/social proof|reviews/i, "Social Proof"], [/benefit|results/i, "Benefits"],
      ];

      function inferFromName(name: string) {
        const tags: Record<string, string | null> = { ad_type: null, hook: null, theme: null };
        for (const [re, val] of FORMAT_PATTERNS) { if (re.test(name)) { tags.ad_type = val; break; } }
        for (const [re, val] of HOOK_PATTERNS) { if (re.test(name)) { tags.hook = val; break; } }
        if (!tags.hook && /\bugc\b/i.test(name)) tags.hook = "Social Proof";
        for (const [re, val] of ANGLE_PATTERNS) { if (re.test(name)) { tags.theme = val; break; } }
        return tags;
      }

      const taggable: { ad_id: string; tags: Record<string, string | null> }[] = [];
      for (const c of (untagged || [])) {
        const tags = inferFromName(c.ad_name);
        if (tags.ad_type || tags.hook || tags.theme) {
          taggable.push({ ad_id: c.ad_id, tags });
        }
      }

      if (dry_run) {
        return new Response(JSON.stringify({ count: taggable.length, total_untagged: (untagged || []).length, preview: taggable.slice(0, 20).map(t => ({ ad_id: t.ad_id, ...t.tags })) }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Apply tags — batch updates by tag signature to reduce round-trips
      let applied = 0;
      const signatureMap = new Map<string, { update: Record<string, any>; ad_ids: string[] }>();
      for (const item of taggable) {
        const update: Record<string, any> = { tag_source: "inferred" };
        if (item.tags.ad_type) update.ad_type = item.tags.ad_type;
        if (item.tags.hook) update.hook = item.tags.hook;
        if (item.tags.theme) update.theme = item.tags.theme;
        const sig = JSON.stringify(update);
        if (!signatureMap.has(sig)) {
          signatureMap.set(sig, { update, ad_ids: [] });
        }
        signatureMap.get(sig)!.ad_ids.push(item.ad_id);
      }
      for (const { update, ad_ids } of signatureMap.values()) {
        const { error: upErr, data: upData } = await supabase
          .from("creatives")
          .update(update)
          .in("ad_id", ad_ids)
          .select("ad_id");
        if (!upErr) applied += (upData?.length ?? ad_ids.length);
      }

      // Update untagged count
      const { count } = await supabase.from("creatives").select("*", { count: "exact", head: true }).eq("account_id", account_id).eq("tag_source", "untagged");
      await supabase.from("ad_accounts").update({ untagged_count: count || 0 }).eq("id", account_id);

      return new Response(JSON.stringify({ success: true, applied, total_untagged: (untagged || []).length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Creatives error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
