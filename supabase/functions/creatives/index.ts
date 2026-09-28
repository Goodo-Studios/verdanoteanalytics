import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveConvention } from "../_shared/naming-convention.ts";
import { parseAdName } from "../_shared/parse-ad-name.ts";
import { parsedDisplayTags } from "../_shared/ad-name-display.ts";
import { applyAdTypeFilter, distinctValues } from "../_shared/creative-filters.ts";
import { buildNameSyncChange, nameSyncUpdate, validateSyncFromNameBody, type NameSyncRow } from "../_shared/name-sync-logic.ts";
import { resolveTags, type PartialTags } from "../_shared/resolve-tags.ts";
import { sanitizeSearchTerm } from "../_shared/postgrest-search.ts";
import { errorMessage } from "../_shared/error-message.ts";
import { aggregateDailyByAd, computeWeightedAggregates } from "../_shared/creatives-aggregate.ts";
import { TtlCache, makeCreativesCacheKey } from "../_shared/creatives-page-cache.ts";

// Caches the full computed (pre-pagination) result of the date-filtered
// branch below — see creatives-page-cache.ts for why. 30s balances "page 2
// shouldn't redo page 1's full-account aggregation" against picking up a
// fresh Meta sync quickly. Cleared on every tag-changing mutation (PUT /
// bulk-untag / auto-tag / sync-from-name) below so a retag is never served back stale.
const creativesPageCache = new TtlCache<{
  result: any[];
  total: number;
  aggregates: { total_spend: number; avg_cpa: number; avg_roas: number };
  noDailyData?: boolean;
}>({ ttlMs: 30_000, maxEntries: 200 });


// Explicit column list avoids SELECT * overhead — only fetch what the client actually uses.
// Intentionally omits preview_url / scheduled_launch_date / created_at / updated_at: no GET
// consumer reads them (scheduled_launch_date is write-only via PUT). Trims response width.
const CREATIVE_COLS = [
  "ad_id", "account_id", "ad_name", "unique_code", "ad_type", "ad_status",
  "person", "style", "hook", "product", "theme", "tag_source", "notes",
  "spend", "impressions", "clicks", "ctr", "cpm", "cpc", "cpa", "roas",
  "purchases", "purchase_value", "adds_to_cart", "cost_per_add_to_cart",
  "video_views", "thumb_stop_rate", "hold_rate", "frequency", "video_avg_play_time",
  "play_curve", "retention_p25", "retention_p50", "retention_p75", "retention_p100",
  "campaign_name", "adset_name", "ad_post_url", "thumbnail_url", "full_res_url",
  // meta_video_ids (US-014): the modal uses it to detect real video intent when
  // video_url is the ambiguous 'no-video' sentinel, so the Meta preview embed
  // still renders a player instead of a static thumbnail.
  "video_url", "meta_video_ids",
].join(", ");

// US-003: the strict 7-segment parseAdName + VALID_* allow-lists were removed.
// All tagging now flows through the single canonical parser (_shared/parse-ad-name.ts,
// driven by the convention/vocab store) and the single precedence resolver
// (_shared/resolveTags). Stored tag columns hold display names, so parser output
// (canonical vocab) is mapped through the shared parsedDisplayTags (_shared/ad-name-display.ts) before it enters the resolver.

/** unique_code is always the first separator-split token (matches the parser contract). */
function uniqueCodeOf(adName: string): string {
  return adName.split("_")[0] || adName;
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
  console.log("Validating bearer token");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  console.log("Auth result - authenticated:", !!user, "error:", authError?.message);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized", detail: authError?.message }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Resolve roles tolerantly: a user may hold MULTIPLE user_roles rows
  // (UNIQUE(user_id, role) — e.g. a builder can also be a client). `.single()`
  // THROWS on >1 rows, collapsing multi-role users to a spurious 403/500.
  // Fetch all rows and test membership instead (same pattern as accounts).
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = (roleRows || []).map((r) => r.role);
  const isStaff = roles.includes("builder") || roles.includes("employee");
  const isClientRole = roles.includes("client");
  if (!isStaff && !isClientRole) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Clients (non-staff) can only read, not write
  if (!isStaff && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Forbidden: read-only access" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Tenant scope. This function runs on a SERVICE-ROLE client, which bypasses RLS,
  // so row visibility has to be enforced here. Holding *a* role is not authorization
  // to read *any* account: without this, a client of account A could pass
  // ?account_id=<account B> and read another agency client's spend/ROAS/revenue.
  // null = unrestricted (builder/employee); an array = the caller's linked accounts.
  // Mirrors verifyAccountOwnership in the api function.
  let allowedIds: string[] | null = null;
  if (!isStaff) {
    const { data: links, error: linksError } = await supabase
      .from("user_accounts").select("account_id").eq("user_id", user.id);
    if (linksError) {
      return new Response(JSON.stringify({ error: "Failed to resolve account access" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    allowedIds = (links || []).map((l: { account_id: string }) => l.account_id);
  }

  /** 403 unless the caller may read this account; null when allowed. */
  const denyAccount = (id: string | null): Response | null => {
    if (!id || !allowedIds || allowedIds.includes(id)) return null;
    return new Response(JSON.stringify({ error: "Access denied" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/creatives\/?/, "").replace(/\/$/, "");

  try {
    // GET /creatives/filters — distinct filter values
    if (req.method === "GET" && path === "filters") {
      const controlledTypes = ["Video", "Static", "GIF", "Carousel"];
      const controlledPersons = ["Creator", "Customer", "Founder", "Actor", "No Talent"];
      const controlledStyles = ["UGC Native", "Studio Clean", "Text Forward", "Lifestyle"];

      // Scope every lookup to the caller's accounts. This endpoint used to hand any
      // authenticated user the id + name of EVERY account, plus the distinct product
      // and theme values across all of them — which also supplied the account ids
      // needed to read other tenants' creatives below.
      let productsQuery = supabase.from("creatives").select("product").not("product", "is", null);
      let themesQuery = supabase.from("creatives").select("theme").not("theme", "is", null);
      let accountsQuery = supabase.from("ad_accounts").select("id, name");
      if (allowedIds) {
        productsQuery = productsQuery.in("account_id", allowedIds);
        themesQuery = themesQuery.in("account_id", allowedIds);
        accountsQuery = accountsQuery.in("id", allowedIds);
      }

      const { data: products } = await productsQuery;
      const { data: themes } = await themesQuery;
      const { data: accounts } = await accountsQuery;

      // Hooks are free text in the naming convention, so the option list is the
      // distinct hook values actually stored for the caller's accounts (same
      // allowedIds scope as products/themes). Paged: one PostgREST select is
      // capped at 1000 rows; bounded at 50 pages so this stays cheap.
      const hookValues: unknown[] = [];
      for (let page = 0; page < 50; page++) {
        let hooksQuery = supabase.from("creatives").select("hook").not("hook", "is", null)
          .order("hook").range(page * 1000, page * 1000 + 999);
        if (allowedIds) hooksQuery = hooksQuery.in("account_id", allowedIds);
        const { data: hookRows, error: hooksErr } = await hooksQuery;
        if (hooksErr) throw hooksErr;
        hookValues.push(...(hookRows || []).map((r: { hook: string | null }) => r.hook));
        if (!hookRows || hookRows.length < 1000) break;
      }

      const uniqueProducts = [...new Set((products || []).map((r: any) => r.product).filter(Boolean))];
      const uniqueThemes = [...new Set((themes || []).map((r: any) => r.theme).filter(Boolean))];

      return new Response(JSON.stringify({
        ad_type: controlledTypes,
        person: controlledPersons,
        style: controlledStyles,
        hook: distinctValues(hookValues),
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
      // Sanitized before .or() interpolation — raw input could inject PostgREST
      // filter clauses via `,` / `(` / `)` (see _shared/postgrest-search.ts).
      const search = sanitizeSearchTerm(url.searchParams.get("search"));
      // ?all=1 — return the complete filtered set in one response (used by the
      // useAllCreatives hook). Removes the client-side count + N parallel page
      // requests, each of which re-ran the full aggregation below.
      const all = url.searchParams.get("all") === "1";

      // Reject an explicit request for an account the caller isn't linked to.
      const accountDenied = denyAccount(accountId);
      if (accountDenied) return accountDenied;

      // Shared filter application for the full-table creatives query paths
      // (count, lifetime fallback, no-date branch). The aggregated daily-metrics
      // branch scopes by ad_id batches instead and is intentionally excluded.
      const applyCreativeFilters = (q: any): any => {
        let qq = q;
        // Tenant scope first: with no account_id a client must still see only their
        // own accounts, never the whole table.
        if (allowedIds) qq = qq.in("account_id", allowedIds);
        if (accountId) qq = qq.eq("account_id", accountId);
        qq = applyAdTypeFilter(qq, adType); // Static also matches legacy Image/Photo
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
        // Page turns (and repeat renders a few seconds apart) re-request this
        // same filter+range combination — check the cache before re-scanning
        // creative_daily_metrics and re-running the aggregation below.
        const cacheKey = makeCreativesCacheKey({
          accountId, adType, person, style, hook, product, theme, tagSource, adStatus, delivery,
          dateFrom, dateTo, search, allowedIds,
        });
        const cachedPage = creativesPageCache.get(cacheKey);
        if (cachedPage) {
          if (cachedPage.noDailyData) {
            return new Response(JSON.stringify({
              data: [], total: 0, aggregates: cachedPage.aggregates, no_daily_data: true,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          return new Response(JSON.stringify({
            data: all ? cachedPage.result : cachedPage.result.slice(offset, offset + limit),
            total: cachedPage.total,
            aggregates: cachedPage.aggregates,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Query daily metrics with pagination to handle >1000 rows
        const dailyData: any[] = [];
        let dmOffset = 0;
        const DM_PAGE = 1000;
        while (true) {
          let dmQuery = supabase.from("creative_daily_metrics").select("ad_id, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views, frequency, thumb_stop_rate, hold_rate, video_avg_play_time")
            .order("ad_id", { ascending: true })
            .order("date", { ascending: true });
          // Same tenant scope as applyCreativeFilters — this branch queries
          // creative_daily_metrics directly and would otherwise span all accounts.
          if (allowedIds) dmQuery = dmQuery.in("account_id", allowedIds);
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

        // No daily-metrics rows for this date range → genuinely no delivery on
        // these dates. Return an honest empty/zero result. The old code fell
        // back to LIFETIME metrics here, which mislabeled all-time spend as
        // range spend (e.g. picking "Today" before the daily sync ran showed
        // lifetime totals) and contradicted get_period_metrics, which returns 0
        // for the same empty range. `no_daily_data` lets the UI optionally show
        // a "no data for this range" notice instead of an unexplained empty set.
        if (!dailyData || dailyData.length === 0) {
          const emptyAggregates = { total_spend: 0, avg_cpa: 0, avg_roas: 0 };
          creativesPageCache.set(cacheKey, { result: [], total: 0, aggregates: emptyAggregates, noDailyData: true });
          return new Response(JSON.stringify({
            data: [],
            total: 0,
            aggregates: emptyAggregates,
            no_daily_data: true,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } else {
          // Aggregate by ad_id — sums spend/conversions and impression-weighted
          // rate metrics across the picked date range (see _shared/creatives-aggregate.ts).
          const aggMap = aggregateDailyByAd(dailyData);

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
            cQuery = applyAdTypeFilter(cQuery, adType); // Static also matches legacy Image/Photo
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
          // Aggregate totals across ALL creatives in range (not just the page
          // slice). Spend-weighted to match get_period_metrics — see
          // computeWeightedAggregates.
          const { total_spend: aggTotalSpend, avg_cpa: aggAvgCpa, avg_roas: aggAvgRoas } = computeWeightedAggregates(result);
          const aggregates = { total_spend: aggTotalSpend, avg_cpa: aggAvgCpa, avg_roas: aggAvgRoas };
          creativesPageCache.set(cacheKey, { result, total, aggregates });
          return new Response(JSON.stringify({ data: all ? result : result.slice(offset, offset + limit), total, aggregates }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // No date filter — use aggregated totals from creatives table
      let data: any[];
      let total: number;
      if (all) {
        // ?all=1 already scans the complete filtered set — its length IS the
        // total, so the separate exact-count query is redundant here.
        data = await fetchAllCreatives();
        total = data.length;
      } else {
        const { count } = await applyCreativeFilters(
          supabase.from("creatives").select("*", { count: "exact", head: true })
        );
        const { data: pageData, error } = await applyCreativeFilters(
          supabase.from("creatives").select(CREATIVE_COLS).order("spend", { ascending: false })
        ).range(offset, offset + limit - 1);
        if (error) throw error;
        data = pageData || [];
        total = count || 0;
      }

      // Aggregates cover ALL matching creatives (not just the page slice).
      // When ?all=1 the full filtered set is already in memory — compute from
      // it directly instead of re-scanning the table. Only the paged path needs
      // a second scan, and that scan stays narrow (spend/purchases/value — the
      // inputs to the spend-weighted average).
      let aggRows: any[];
      if (all) {
        aggRows = data;
      } else {
        aggRows = [];
        let aggOffset = 0;
        const AGG_PAGE = 1000;
        while (true) {
          const { data: aggData } = await applyCreativeFilters(
            supabase.from("creatives").select("spend, purchases, purchase_value")
          ).order("ad_id", { ascending: true }).range(aggOffset, aggOffset + AGG_PAGE - 1);
          if (!aggData || aggData.length === 0) break;
          aggRows.push(...aggData);
          if (aggData.length < AGG_PAGE) break;
          aggOffset += AGG_PAGE;
        }
      }
      // Spend-weighted, consistent with the date-filtered path and the RPC.
      const { total_spend: aggTotalSpend, avg_cpa: aggAvgCpa, avg_roas: aggAvgRoas } = computeWeightedAggregates(aggRows);

      return new Response(JSON.stringify({ data: data || [], total, aggregates: { total_spend: aggTotalSpend, avg_cpa: aggAvgCpa, avg_roas: aggAvgRoas } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
          // Record the name these tags came from (sync re-parses on rename).
          update.parsed_ad_name = creative.ad_name;
        }
      } else {
        update.tag_source = "manual";
      }

      const { data, error } = await supabase.from("creatives").update(update).eq("ad_id", path).select().single();
      if (error) throw error;
      // A retag changes what the date-filtered list/cache above would return —
      // clear it so the next request can't serve back the pre-edit tags.
      creativesPageCache.clear();

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

      // parsed_ad_name := null so the next sync re-parses these from their names
      // (the behaviour untagged rows had before rename tracking existed).
      const { error } = await supabase.from("creatives").update({
        tag_source: "untagged", ad_type: null, person: null, style: null, product: null, hook: null, theme: null,
        parsed_ad_name: null,
      }).in("ad_id", ad_ids);

      if (error) throw error;
      creativesPageCache.clear();
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
      if (applied > 0) creativesPageCache.clear();

      // Update untagged count
      const { count } = await supabase.from("creatives").select("*", { count: "exact", head: true }).eq("account_id", account_id).eq("tag_source", "untagged");
      await supabase.from("ad_accounts").update({ untagged_count: count || 0 }).eq("id", account_id);

      return new Response(JSON.stringify({ success: true, applied, total_untagged: (untagged || []).length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /creatives/sync-from-name — re-derive all six tags from the ad name.
    // Explicit user action: the name wins over EVERY tag_source, including
    // 'manual'. dry_run=true returns the before/after preview and writes nothing.
    // Staff-only like every other write here (clients were rejected above).
    if (req.method === "POST" && path === "sync-from-name") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        body = null;
      }
      const v = validateSyncFromNameBody(body);
      if (!v.ok) {
        return new Response(JSON.stringify({ error: v.error }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Fetched in chunks of 100 ids to keep the PostgREST query URL short.
      const rows: Record<string, any>[] = [];
      for (let i = 0; i < v.ids.length; i += 100) {
        const { data, error: fetchErr } = await supabase
          .from("creatives")
          .select("ad_id, account_id, ad_name, ad_type, person, style, product, hook, theme")
          .in("ad_id", v.ids.slice(i, i + 100));
        if (fetchErr) throw fetchErr;
        rows.push(...(data || []));
      }

      // Tenant check on every row touched (no-op for staff, whose scope is
      // unrestricted — kept so this path can never widen access if the
      // read-only-client rule above changes).
      for (const r of rows) {
        const denied = denyAccount(r.account_id);
        if (denied) return denied;
      }

      // One convention per account (override or global), resolved once.
      const conventionByAccount = new Map<string, Awaited<ReturnType<typeof resolveConvention>>>();
      for (const accountId of new Set(rows.map((r) => r.account_id as string))) {
        conventionByAccount.set(accountId, await resolveConvention(supabase, accountId));
      }
      const missing = [...conventionByAccount.entries()].filter(([, c]) => !c).map(([id]) => id);
      if (missing.length > 0) {
        return new Response(JSON.stringify({ error: "No naming convention configured", account_ids: missing }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const order = new Map(v.ids.map((id, i) => [id, i]));
      const changes = rows
        .filter((r) => typeof r.ad_name === "string")
        .sort((a, b) => (order.get(a.ad_id) ?? 0) - (order.get(b.ad_id) ?? 0))
        .map((r) => buildNameSyncChange(r as NameSyncRow, conventionByAccount.get(r.account_id)!));

      if (!v.dry_run && changes.length > 0) {
        // Every requested row is written (not only changed ones) so tag_source
        // becomes 'parsed' even where a manual tag already matched the name.
        for (let i = 0; i < changes.length; i += 50) {
          const chunk = changes.slice(i, i + 50);
          const results = await Promise.all(chunk.map((c) =>
            supabase.from("creatives").update(nameSyncUpdate(c)).eq("ad_id", c.id)
          ));
          const failed = results.find((r) => r.error);
          if (failed?.error) throw failed.error;
        }
        creativesPageCache.clear();

        for (const accountId of conventionByAccount.keys()) {
          const { count } = await supabase.from("creatives").select("*", { count: "exact", head: true }).eq("account_id", accountId).eq("tag_source", "untagged");
          await supabase.from("ad_accounts").update({ untagged_count: count || 0 }).eq("id", accountId);
        }
      }

      return new Response(JSON.stringify({
        changes: changes.map(({ id, ad_name, before, after, changed }) => ({ id, ad_name, before, after, changed })),
        applied: !v.dry_run,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Creatives error:", errorMessage(e));
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
