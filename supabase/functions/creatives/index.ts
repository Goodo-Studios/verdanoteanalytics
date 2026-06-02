import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveConvention } from "../_shared/naming-convention.ts";
import { parseAdName, type ParsedAdName, type AdNameTags } from "../_shared/parse-ad-name.ts";
import { resolveTags, type PartialTags } from "../_shared/resolve-tags.ts";


const DISPLAY_NAMES: Record<string, string> = {
  UGCNative: "UGC Native", StudioClean: "Studio Clean", TextForward: "Text Forward",
  NoTalent: "No Talent", ProblemCallout: "Problem Callout", StatementBold: "Statement Bold",
  AuthorityIntro: "Authority Intro", BeforeAndAfter: "Before & After", PatternInterrupt: "Pattern Interrupt",
};

function toDisplayName(val: string): string { return DISPLAY_NAMES[val] || val; }

// Explicit column list avoids SELECT * overhead — only fetch what the client actually uses.
// Intentionally omits preview_url / scheduled_launch_date / created_at / updated_at: no GET
// consumer reads them (scheduled_launch_date is write-only via PUT). Trims response width.
const CREATIVE_COLS = [
  "ad_id", "account_id", "ad_name", "unique_code", "ad_type", "ad_status",
  "person", "style", "hook", "product", "theme", "tag_source", "notes",
  "spend", "impressions", "clicks", "ctr", "cpm", "cpc", "cpa", "roas",
  "purchases", "purchase_value", "adds_to_cart", "cost_per_add_to_cart",
  "video_views", "thumb_stop_rate", "hold_rate", "frequency", "video_avg_play_time",
  "campaign_name", "adset_name", "ad_post_url", "thumbnail_url", "full_res_url",
  "video_url",
].join(", ");

// US-003: the strict 7-segment parseAdName + VALID_* allow-lists were removed.
// All tagging now flows through the single canonical parser (_shared/parse-ad-name.ts,
// driven by the convention/vocab store) and the single precedence resolver
// (_shared/resolveTags). Stored tag columns hold display names, so parser output
// (canonical vocab) is mapped through toDisplayName before it enters the resolver.

/** unique_code is always the first separator-split token (matches the parser contract). */
function uniqueCodeOf(adName: string): string {
  return adName.split("_")[0] || adName;
}

/** Parser tags (canonical vocab) -> display-name PartialTags for the resolver's parser layer. */
function parsedDisplayTags(parsed: ParsedAdName | null): AdNameTags | null {
  if (!parsed) return null;
  const t = parsed.tags;
  return {
    ad_type: t.ad_type ? toDisplayName(t.ad_type) : null,
    person: t.person ? toDisplayName(t.person) : null,
    style: t.style ? toDisplayName(t.style) : null,
    product: t.product,
    hook: t.hook ? toDisplayName(t.hook) : null,
    theme: t.theme,
  };
}

/** A name_mappings row -> PartialTags for the resolver's Coda (csv_match) layer. */
function mappingTags(m: Record<string, unknown> | null): PartialTags | null {
  if (!m) return null;
  return {
    ad_type: (m.ad_type as string) ?? null,
    person: (m.person as string) ?? null,
    style: (m.style as string) ?? null,
    product: (m.product as string) ?? null,
    hook: (m.hook as string) ?? null,
    theme: (m.theme as string) ?? null,
  };
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
      // ?all=1 — return the complete filtered set in one response (used by the
      // useAllCreatives hook). Removes the client-side count + N parallel page
      // requests, each of which re-ran the full aggregation below.
      const all = url.searchParams.get("all") === "1";

      // Shared filter application for the full-table creatives query paths
      // (count, lifetime fallback, no-date branch). The aggregated daily-metrics
      // branch scopes by ad_id batches instead and is intentionally excluded.
      const applyCreativeFilters = (q: any): any => {
        let qq = q;
        if (accountId) qq = qq.eq("account_id", accountId);
        if (adType) qq = qq.eq("ad_type", adType);
        if (person) qq = qq.eq("person", person);
        if (style) qq = qq.eq("style", style);
        if (hook) qq = qq.eq("hook", hook);
        if (product) qq = qq.eq("product", product);
        if (theme) qq = qq.eq("theme", theme);
        if (tagSource) qq = qq.eq("tag_source", tagSource);
        if (adStatus) qq = qq.eq("ad_status", adStatus);
        if (delivery === "had_delivery") qq = qq.gt("spend", 0);
        if (delivery === "active") qq = qq.eq("ad_status", "ACTIVE");
        if (search) qq = qq.or(`ad_name.ilike.%${search}%,unique_code.ilike.%${search}%,campaign_name.ilike.%${search}%`);
        return qq;
      };

      // Fetch every matching creative, paging past the 1000-row PostgREST cap.
      const fetchAllCreatives = async (): Promise<any[]> => {
        const out: any[] = [];
        let off = 0;
        const PAGE = 1000;
        while (true) {
          const { data: pageData, error: pageErr } = await applyCreativeFilters(
            supabase.from("creatives").select(CREATIVE_COLS).order("spend", { ascending: false })
          ).range(off, off + PAGE - 1);
          if (pageErr) throw pageErr;
          if (!pageData || pageData.length === 0) break;
          out.push(...pageData);
          if (pageData.length < PAGE) break;
          off += PAGE;
        }
        return out;
      };

      const hasDateFilter = dateFrom || dateTo;

      if (hasDateFilter) {
        // Query daily metrics with pagination to handle >1000 rows
        const dailyData: any[] = [];
        let dmOffset = 0;
        const DM_PAGE = 1000;
        while (true) {
          let dmQuery = supabase.from("creative_daily_metrics").select("ad_id, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views, frequency, thumb_stop_rate, hold_rate, video_avg_play_time")
            .order("ad_id", { ascending: true })
            .order("date", { ascending: true });
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
          const { count } = await applyCreativeFilters(
            supabase.from("creatives").select("*", { count: "exact", head: true })
          );

          let allC: any[];
          if (all) {
            allC = await fetchAllCreatives();
          } else {
            const { data: pageData, error: cErr } = await cQuery.range(offset, offset + limit - 1);
            if (cErr) throw cErr;
            allC = pageData || [];
          }

          // Compute aggregates from lifetime data for this fallback path
          const fbAggTotalSpend = (allC || []).reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);
          const fbWithSpend = (allC || []).filter((c: any) => (Number(c.spend) || 0) > 0);
          const fbAvgCpa = fbWithSpend.length > 0 ? fbWithSpend.reduce((s: number, c: any) => s + (Number(c.cpa) || 0), 0) / fbWithSpend.length : 0;
          const fbAvgRoas = fbWithSpend.length > 0 ? fbWithSpend.reduce((s: number, c: any) => s + (Number(c.roas) || 0), 0) / fbWithSpend.length : 0;
          return new Response(JSON.stringify({ data: allC || [], total: count || 0, aggregates: { total_spend: fbAggTotalSpend, avg_cpa: fbAvgCpa, avg_roas: fbAvgRoas } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
          // Compute aggregate totals across ALL creatives (not just the page slice)
          const aggTotalSpend = result.reduce((s: number, c: any) => s + (Number(c.spend) || 0), 0);
          const withSpend = result.filter((c: any) => c.spend > 0);
          const aggAvgCpa = withSpend.length > 0 ? withSpend.reduce((s: number, c: any) => s + (Number(c.cpa) || 0), 0) / withSpend.length : 0;
          const aggAvgRoas = withSpend.length > 0 ? withSpend.reduce((s: number, c: any) => s + (Number(c.roas) || 0), 0) / withSpend.length : 0;
          return new Response(JSON.stringify({ data: all ? result : result.slice(offset, offset + limit), total, aggregates: { total_spend: aggTotalSpend, avg_cpa: aggAvgCpa, avg_roas: aggAvgRoas } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // No date filter — use aggregated totals from creatives table
      // First get total count
      const { count } = await applyCreativeFilters(
        supabase.from("creatives").select("*", { count: "exact", head: true })
      );

      let data: any[];
      if (all) {
        data = await fetchAllCreatives();
      } else {
        const { data: pageData, error } = await applyCreativeFilters(
          supabase.from("creatives").select(CREATIVE_COLS).order("spend", { ascending: false })
        ).range(offset, offset + limit - 1);
        if (error) throw error;
        data = pageData || [];
      }

      // Compute aggregates across ALL matching creatives (not just the page slice)
      // Fetch all matching ad spends for aggregate computation
      const aggSpends: number[] = [];
      const aggCpas: number[] = [];
      const aggRoases: number[] = [];
      let aggOffset = 0;
      const AGG_PAGE = 1000;
      while (true) {
        let aggQ = supabase.from("creatives").select("spend, cpa, roas");
        if (accountId) aggQ = aggQ.eq("account_id", accountId);
        if (adType) aggQ = aggQ.eq("ad_type", adType);
        if (person) aggQ = aggQ.eq("person", person);
        if (style) aggQ = aggQ.eq("style", style);
        if (hook) aggQ = aggQ.eq("hook", hook);
        if (product) aggQ = aggQ.eq("product", product);
        if (theme) aggQ = aggQ.eq("theme", theme);
        if (tagSource) aggQ = aggQ.eq("tag_source", tagSource);
        if (adStatus) aggQ = aggQ.eq("ad_status", adStatus);
        if (delivery === "had_delivery") aggQ = aggQ.gt("spend", 0);
        if (delivery === "active") aggQ = aggQ.eq("ad_status", "ACTIVE");
        if (search) aggQ = aggQ.or(`ad_name.ilike.%${search}%,unique_code.ilike.%${search}%,campaign_name.ilike.%${search}%`);
        aggQ = aggQ.order("ad_id", { ascending: true }).range(aggOffset, aggOffset + AGG_PAGE - 1);
        const { data: aggData } = await aggQ;
        if (!aggData || aggData.length === 0) break;
        for (const row of aggData) {
          const s = Number(row.spend) || 0;
          aggSpends.push(s);
          if (s > 0) {
            aggCpas.push(Number(row.cpa) || 0);
            aggRoases.push(Number(row.roas) || 0);
          }
        }
        if (aggData.length < AGG_PAGE) break;
        aggOffset += AGG_PAGE;
      }
      const aggTotalSpend = aggSpends.reduce((s, v) => s + v, 0);
      const aggAvgCpa = aggCpas.length > 0 ? aggCpas.reduce((s, v) => s + v, 0) / aggCpas.length : 0;
      const aggAvgRoas = aggRoases.length > 0 ? aggRoases.reduce((s, v) => s + v, 0) / aggRoases.length : 0;

      return new Response(JSON.stringify({ data: data || [], total: count || 0, aggregates: { total_spend: aggTotalSpend, avg_cpa: aggAvgCpa, avg_roas: aggAvgRoas } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        // Reset to auto — re-resolve via the canonical parser + name_mappings,
        // applying the locked precedence (manual is absent on a reset, so:
        // Coda(name_mappings) > parser > untagged). resolveTags sets tag_source.
        update.tag_source = "untagged";
        update.ad_type = null;
        update.person = null;
        update.style = null;
        update.product = null;
        update.hook = null;
        update.theme = null;

        const { data: creative } = await supabase.from("creatives").select("ad_name, account_id").eq("ad_id", path).single();
        if (creative) {
          const convention = await resolveConvention(supabase, creative.account_id);
          const parsed = convention ? parseAdName(creative.ad_name, convention) : null;
          const unique_code = parsed?.unique_code ?? uniqueCodeOf(creative.ad_name);
          const { data: mapping } = await supabase.from("name_mappings").select("*").eq("account_id", creative.account_id).eq("unique_code", unique_code).maybeSingle();

          const { tags, tag_source: resolvedSource } = resolveTags(
            parsedDisplayTags(parsed),
            mappingTags(mapping),
            null,
          );
          update.ad_type = tags.ad_type;
          update.person = tags.person;
          update.style = tags.style;
          update.product = tags.product;
          update.hook = tags.hook;
          update.theme = tags.theme;
          update.tag_source = resolvedSource;
          update.unique_code = unique_code;
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

      // US-003: tagging now flows through the single canonical parser + resolver.
      // Resolve the account's naming convention once, preload its name_mappings into
      // a Map keyed by unique_code, then per creative apply the locked precedence
      // (no manual layer here, so: Coda(name_mappings) > parser > untagged).
      const convention = await resolveConvention(supabase, account_id);
      const { data: mappings } = await supabase
        .from("name_mappings")
        .select("*")
        .eq("account_id", account_id);
      const mappingByCode = new Map<string, Record<string, unknown>>();
      for (const m of (mappings || [])) {
        if (m.unique_code) mappingByCode.set(m.unique_code, m);
      }

      // Resolve each untagged creative; keep only those that gained a real tag.
      const taggable: { ad_id: string; update: Record<string, any> }[] = [];
      for (const c of (untagged || [])) {
        const parsed = convention ? parseAdName(c.ad_name, convention) : null;
        const unique_code = parsed?.unique_code ?? uniqueCodeOf(c.ad_name);
        const { tags, tag_source } = resolveTags(
          parsedDisplayTags(parsed),
          mappingTags(mappingByCode.get(unique_code) ?? null),
          null,
        );
        if (tag_source === "untagged") continue;
        taggable.push({
          ad_id: c.ad_id,
          update: {
            tag_source,
            unique_code,
            ad_type: tags.ad_type,
            person: tags.person,
            style: tags.style,
            product: tags.product,
            hook: tags.hook,
            theme: tags.theme,
          },
        });
      }

      if (dry_run) {
        return new Response(JSON.stringify({ count: taggable.length, total_untagged: (untagged || []).length, preview: taggable.slice(0, 20).map(t => ({ ad_id: t.ad_id, ...t.update })) }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Apply tags — batch updates by tag signature to reduce round-trips
      let applied = 0;
      const signatureMap = new Map<string, { update: Record<string, any>; ad_ids: string[] }>();
      for (const item of taggable) {
        const sig = JSON.stringify(item.update);
        if (!signatureMap.has(sig)) {
          signatureMap.set(sig, { update: item.update, ad_ids: [] });
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
