import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
// Win rate is decided by SPEND FIRST, shared with the Creative Library
// classifier. This used to be an ad-hoc `roas > 1` filter here, which agreed
// with neither the Library nor the Overview.
import { selectWinnersBySpend } from "../_shared/creative-classification.ts";
import { addVideoRow, computeBlendedMetrics, emptyVideoAccumulator, roundOrNull, videoMetricsFromAccumulator } from "../_shared/metric-math.ts";
import { validateAccountIds, validateDateRange } from "../_shared/report-input.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";


function spendWeightedPercentile(items: { value: number; spend: number }[], pct: number): number {
  if (!items.length) return 0;
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, i) => s + i.spend, 0);
  if (total === 0) return sorted[Math.floor(sorted.length / 2)].value;
  const target = total * (pct / 100);
  let cum = 0;
  for (const item of sorted) { cum += item.spend; if (cum >= target) return item.value; }
  return sorted[sorted.length - 1].value;
}

const RECOMMENDATIONS: Record<string, string> = {
  weak_hook: "Test new opening hooks. The body and CTA are working — only change the first 3 seconds.",
  weak_body: "The hook grabs attention but viewers drop off. Tighten the pacing or restructure the middle section.",
  weak_cta: "Strong engagement but low clicks. Test a different end card, CTA overlay, or offer framing.",
  weak_hook_body: "Consider a full creative rework. The concept or execution isn't connecting.",
  landing_page: "People are watching the full video but not clicking. Check the landing page, offer, or CTA clarity.",
  all_weak: "This creative needs a complete rebuild — start with a new concept rather than iterating.",
  weak_cta_image: "This image ad has a weak CTR. Test different headlines, copy, or visual hierarchy to drive more clicks.",
};

const DIAG_LABELS: Record<string, string> = {
  weak_hook: "Weak Hook", weak_body: "Weak Body", weak_cta: "Weak CTA",
  weak_hook_body: "Weak Hook + Body", landing_page: "Landing Page Issue",
  all_weak: "Full Rebuild", weak_cta_image: "Weak CTR (Image)",
};

function computeDiagnostics(creatives: any[]) {
  const items = creatives.map((c: any) => ({
    ad_id: c.ad_id, ad_name: c.ad_name || c.ad_id, unique_code: c.unique_code,
    hookRate: Number(c.thumb_stop_rate) || 0, holdRate: Number(c.hold_rate) || 0,
    ctr: Number(c.ctr) || 0, spend: Number(c.spend) || 0,
    adType: (c.ad_type || "").toLowerCase(), adName: (c.ad_name || "").toLowerCase(),
  }));
  const hookItems = items.map(i => ({ value: i.hookRate, spend: i.spend }));
  const holdItems = items.map(i => ({ value: i.holdRate, spend: i.spend }));
  const ctrItems = items.map(i => ({ value: i.ctr, spend: i.spend }));
  const p25h = spendWeightedPercentile(hookItems, 25), p75h = spendWeightedPercentile(hookItems, 75);
  const p25d = spendWeightedPercentile(holdItems, 25), p75d = spendWeightedPercentile(holdItems, 75);
  const p25c = spendWeightedPercentile(ctrItems, 25), p75c = spendWeightedPercentile(ctrItems, 75);
  const level = (v: number, lo: number, hi: number) => v >= hi ? "strong" : v <= lo ? "weak" : "average";

  const counts = { diag_weak_hook: 0, diag_weak_body: 0, diag_weak_cta: 0, diag_weak_hook_body: 0, diag_landing_page: 0, diag_all_weak: 0, diag_weak_cta_image: 0, diag_total_diagnosed: 0 };
  const suggestions: any[] = [];

  for (const i of items) {
    const isImage = i.adType === "image" || i.adType === "carousel" || i.adType === "static" || i.adName.includes("static") || (i.adType !== "video" && i.hookRate === 0 && i.holdRate === 0);
    const hk = isImage ? "average" : level(i.hookRate, p25h, p75h);
    const hd = isImage ? "average" : level(i.holdRate, p25d, p75d);
    const ct = level(i.ctr, p25c, p75c);
    let diag = "";
    if (isImage) { if (ct === "weak") diag = "weak_cta_image"; }
    else {
      if (hk === "weak" && hd === "weak" && ct === "weak") diag = "all_weak";
      else if (hk === "weak" && hd === "weak") diag = "weak_hook_body";
      else if (hk === "strong" && hd === "strong" && ct === "weak") diag = "landing_page";
      else if (hk === "weak") diag = "weak_hook";
      else if (hd === "weak") diag = "weak_body";
      else if (ct === "weak") diag = "weak_cta";
    }
    if (diag && i.spend >= 100) {
      (counts as any)[`diag_${diag}`]++;
      counts.diag_total_diagnosed++;
      suggestions.push({
        ad_id: i.ad_id, ad_name: i.ad_name, unique_code: i.unique_code,
        diagnostic: diag, label: DIAG_LABELS[diag] || diag,
        recommendation: RECOMMENDATIONS[diag] || "",
        spend: Math.round(i.spend * 100) / 100,
      });
    }
  }
  // Sort by spend descending so highest-spend issues appear first
  suggestions.sort((a, b) => b.spend - a.spend);
  return { counts, suggestions };
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function cleanAdName(name: string): string {
  if (!name) return "Unknown";
  const m = name.match(/(?:^|>)iName:([^>]+)/i);
  if (m) return m[1];
  if (name.includes(">")) return name.split(">")[0] || name.substring(0, 40);
  return name.length > 45 ? name.substring(0, 42) + "…" : name;
}

async function sendReportToSlack(report: any) {
  const webhookUrl = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!webhookUrl) return;

  const fmtMoney = (v: number | null) =>
    v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`;
  const fmtDecimal = (v: number | null, suf = "") =>
    v == null ? "—" : `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}${suf}`;

  const topPerformers: any[] = (() => { try { return JSON.parse(report.top_performers || "[]"); } catch { return []; } })();
  const appUrl = Deno.env.get("APP_URL") || "https://verdanote.com";

  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: `📊 ${report.report_name}`, emoji: true } },
  ];

  if (report.date_range_start && report.date_range_end) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `${report.date_range_start} – ${report.date_range_end}` }] });
  }

  blocks.push({ type: "section", fields: [
    { type: "mrkdwn", text: `*Spend*\n${fmtMoney(report.total_spend)}` },
    { type: "mrkdwn", text: `*CPA*\n${fmtMoney(report.average_cpa)}` },
  ]});

  if (topPerformers.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*🏆 Top 5 This Week*" } });

    for (const p of topPerformers.slice(0, 5)) {
      const name = cleanAdName(p.ad_name);
      const metrics = [
        fmtMoney(p.spend) + " spent",
        p.thumb_stop_rate != null ? `Hook ${fmtDecimal(p.thumb_stop_rate, "%")}` : null,
        p.hold_rate != null       ? `Hold ${fmtDecimal(p.hold_rate, "%")}` : null,
        p.ctr != null             ? `CTR ${fmtDecimal(p.ctr, "%")}` : null,
        p.roas != null            ? `ROAS ${fmtDecimal(p.roas, "x")}` : null,
      ].filter(Boolean).join(" · ");

      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${name}*\n${metrics}` },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Preview" },
          url: `https://www.facebook.com/ads/library/?id=${p.ad_id}`,
        },
      });
    }
  }

  if (report.id) {
    blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "View Full Report →", emoji: true }, url: `${appUrl}/public/reports/${report.id}` }] });
  }

  try { await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blocks }) }); }
  catch (e) { console.error("Slack webhook error:", e); }
}

// Aggregate daily metrics per ad_id within a date range, returning enriched creative objects
async function aggregateDailyMetrics(supabase: any, accountId: string | null, dateStart: string, dateEnd: string) {
  // Fetch daily metrics within range
  let dmQuery = supabase
    .from("creative_daily_metrics")
    .select("*")
    .gte("date", dateStart)
    .lte("date", dateEnd)
    // Offset paging needs a total order or pages can skip/duplicate rows; (ad_id, date) is the primary key.
    .order("ad_id", { ascending: true })
    .order("date", { ascending: true });
  if (accountId) dmQuery = dmQuery.eq("account_id", accountId);

  // Paginate to handle >1000 rows
  const allMetrics: any[] = [];
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await dmQuery.range(offset, offset + batchSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allMetrics.push(...data);
    if (data.length < batchSize) break;
    offset += batchSize;
  }

  // Aggregate per ad_id
  const byAd: Record<string, any> = {};
  for (const m of allMetrics) {
    if (!byAd[m.ad_id]) {
      byAd[m.ad_id] = {
        ad_id: m.ad_id, account_id: m.account_id,
        spend: 0, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0,
        adds_to_cart: 0, video_views: 0,
        _days: 0, _ctr_sum: 0, _cpm_sum: 0, _cpc_sum: 0, _cpa_sum: 0, _roas_sum: 0,
        _cpac_sum: 0,
        // Hook, hold, play time and frequency are built from counts (audit 6.1).
        _video: emptyVideoAccumulator(),
      };
    }
    const a = byAd[m.ad_id];
    a.spend += Number(m.spend || 0);
    a.impressions += Number(m.impressions || 0);
    a.clicks += Number(m.clicks || 0);
    a.purchases += Number(m.purchases || 0);
    a.purchase_value += Number(m.purchase_value || 0);
    a.adds_to_cart += Number(m.adds_to_cart || 0);
    a.video_views += Number(m.video_views || 0);
    a._days++;
    a._ctr_sum += Number(m.ctr || 0);
    a._cpm_sum += Number(m.cpm || 0);
    a._cpc_sum += Number(m.cpc || 0);
    a._cpa_sum += Number(m.cpa || 0);
    a._roas_sum += Number(m.roas || 0);
    addVideoRow(a._video, m);
    a._cpac_sum += Number(m.cost_per_add_to_cart || 0);
  }

  // Compute averages and fetch creative metadata
  const adIds = Object.keys(byAd);
  if (adIds.length === 0) return [];

  // Fetch creative metadata in batches
  const creativeMap: Record<string, any> = {};
  for (let i = 0; i < adIds.length; i += 100) {
    const batch = adIds.slice(i, i + 100);
    const { data: crs } = await supabase
      .from("creatives")
      .select("ad_id, ad_name, unique_code, ad_type, tag_source, person, style, hook, product, theme, campaign_name, adset_name")
      .in("ad_id", batch);
    for (const c of crs || []) creativeMap[c.ad_id] = c;
  }

  return adIds.map(adId => {
    const a = byAd[adId];
    const meta = creativeMap[adId] || {};
    const video = videoMetricsFromAccumulator(a._video);
    return {
      ...meta,
      ad_id: adId,
      account_id: a.account_id,
      spend: a.spend,
      impressions: a.impressions,
      clicks: a.clicks,
      purchases: a.purchases,
      purchase_value: a.purchase_value,
      adds_to_cart: a.adds_to_cart,
      video_views: a.video_views,
      ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
      cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
      cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
      cpa: a.purchases > 0 ? a.spend / a.purchases : 0,
      roas: a.spend > 0 ? a.purchase_value / a.spend : 0,
      // 0 when there is no data, as before; screens get null handling in a later part of 6.1.
      thumb_stop_rate: video.hook_rate ?? 0,
      hold_rate: video.hold_rate ?? 0,
      frequency: video.frequency_approx ?? 0,
      video_avg_play_time: video.avg_play_time ?? 0,
      cost_per_add_to_cart: a.adds_to_cart > 0 ? a.spend / a.adds_to_cart : 0,
    };
  }).filter(c => c.spend > 0);
}

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
  // Fetch ALL role rows (a user may hold multiple) — `.single()` throws on >1
  // rows, turning a legitimate multi-role staff user into a spurious 403.
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = (roleRows || []).map((r: { role: string }) => r.role);
  if (!roles.includes("builder") && !roles.includes("employee")) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/reports\/?/, "").replace(/\/$/, "");

  try {
    // GET /reports
    if (req.method === "GET" && !path) {
      const { data, error } = await supabase.from("reports").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // POST /reports — generate report using daily metrics
    if (req.method === "POST" && !path) {
      const body = await req.json();
      const { report_name, account_id, date_start, date_end } = body;

      const range = validateDateRange(date_start, date_end, {
        start: new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0],
        end: new Date().toISOString().split("T")[0],
      });
      if (!range.ok) return jsonError(range.error, 400);
      const { dateStart, dateEnd, days } = range;
      if (account_id != null && account_id !== "") {
        const one = validateAccountIds([account_id]);
        if (!one.ok) return jsonError("account_id must be a valid account id string", 400);
      }

      // Aggregate from daily metrics
      const list = await aggregateDailyMetrics(supabase, account_id || null, dateStart, dateEnd);

      // Blended ratios come from summed totals (null when the denominator is 0), not a mean of per-creative ratios.
      const blended = computeBlendedMetrics(list);
      const totalSpend = blended.spend;

      const winners = selectWinnersBySpend(list as { spend?: number | null }[]);
      const winRate = list.length > 0 ? (winners.length / list.length) * 100 : 0;

      const tagCounts = { parsed: 0, csv_match: 0, manual: 0, untagged: 0 };
      list.forEach((c: any) => {
        const src = c.tag_source || "untagged";
        if (src in tagCounts) tagCounts[src as keyof typeof tagCounts]++;
      });

      const sorted = [...list].sort((a: any, b: any) => Number(b.spend || 0) - Number(a.spend || 0));
      const mapPerformer = (c: any) => ({
        ad_id: c.ad_id, ad_name: c.ad_name || c.ad_id, unique_code: c.unique_code,
        roas: Math.round(Number(c.roas || 0) * 1000) / 1000,
        cpa: Math.round(Number(c.cpa || 0) * 100) / 100,
        spend: Math.round(Number(c.spend || 0) * 100) / 100,
        ctr: Math.round(Number(c.ctr || 0) * 1000) / 1000,
      });

      const { counts: diagCounts, suggestions: diagSuggestions } = computeDiagnostics(list);

      const report = {
        report_name: report_name || `Report ${new Date().toLocaleDateString()}`,
        account_id: account_id || null,
        creative_count: list.length,
        total_spend: Math.round(totalSpend * 100) / 100,
        blended_roas: roundOrNull(blended.roas, 2),
        average_cpa: roundOrNull(blended.cpa, 2),
        average_ctr: roundOrNull(blended.ctr, 2),
        win_rate: Math.round(winRate * 100) / 100,
        tags_parsed_count: tagCounts.parsed,
        tags_csv_count: tagCounts.csv_match,
        tags_manual_count: tagCounts.manual,
        tags_untagged_count: tagCounts.untagged,
        top_performers: JSON.stringify(sorted.slice(0, 10).map(mapPerformer)),
        date_range_start: dateStart,
        date_range_end: dateEnd,
        date_range_days: days,
        iteration_suggestions: JSON.stringify(diagSuggestions),
        ...diagCounts,
      };

      const { data, error } = await supabase.from("reports").insert(report).select().single();
      if (error) throw error;

      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // POST /reports/portfolio — generate a portfolio report spanning multiple accounts
    if (req.method === "POST" && path === "portfolio") {
      if (!roles.includes("builder") && !roles.includes("employee")) {
        return new Response(JSON.stringify({ error: "Builder or employee role required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const body = await req.json();
      const { date_start, date_end, report_name } = body;
      const range = validateDateRange(date_start, date_end);
      if (!range.ok) return jsonError(range.error, 400);
      const { dateStart, dateEnd, days } = range;
      const ids = validateAccountIds(body.account_ids, { min: 1 });
      if (!ids.ok) return jsonError(ids.error, 400);
      const account_ids = ids.accountIds;
      // Portfolio reports are private unless the caller asks for a public one explicitly.
      const isPublic = body.is_public === true;

      // Get account details
      const { data: accts } = await supabase.from("ad_accounts").select("id, name, target_roas, target_cpa").in("id", account_ids);
      const acctMap: Record<string, any> = {};
      for (const a of accts || []) acctMap[a.id] = a;

      // Aggregate data per account
      const accountData: Record<string, any> = {};
      const allCreatives: any[] = [];

      for (const accountId of account_ids) {
        const list = await aggregateDailyMetrics(supabase, accountId, dateStart, dateEnd);
        const acct = computeBlendedMetrics(list);
        const totalSpend = acct.spend;
        const totalPurchases = acct.purchases;
        const winners = selectWinnersBySpend(list as { spend?: number | null }[]);
        const winRate = list.length > 0 ? (winners.length / list.length) * 100 : 0;
        const blendedRoas = acct.roas;
        const avgCpa = acct.cpa;

        // Get top creative for this account
        const sorted = [...list].sort((a: any, b: any) => Number(b.roas || 0) - Number(a.roas || 0));
        const topCreative = sorted.length > 0 ? sorted[0] : null;

        accountData[accountId] = {
          name: acctMap[accountId]?.name || accountId,
          spend: totalSpend,
          roas: blendedRoas,
          cpa: avgCpa,
          impressions: acct.impressions,
          clicks: acct.clicks,
          purchase_value: acct.purchase_value,
          purchases: totalPurchases,
          win_rate: winRate,
          creative_count: list.length,
          top_creative: topCreative ? {
            ad_id: topCreative.ad_id,
            ad_name: topCreative.ad_name || topCreative.ad_id,
            roas: Number(topCreative.roas || 0),
            spend: Number(topCreative.spend || 0),
            thumbnail_url: topCreative.thumbnail_url || null,
          } : null,
        };

        // Add all creatives with account info for cross-account winners
        for (const c of list) {
          allCreatives.push({ ...c, _account_name: acctMap[accountId]?.name || accountId });
        }
      }

      // Portfolio totals
      const portfolio = computeBlendedMetrics(allCreatives);
      const portfolioSpend = portfolio.spend;
      const portfolioRoas = portfolio.roas;
      const portfolioCpa = portfolio.cpa;
      const portfolioCtr = portfolio.ctr;
      const portfolioCreativeCount = allCreatives.length;

      // Top 3 winners across all accounts (minimum $100 spend)
      const portfolioWinners = allCreatives
        .filter((c: any) => Number(c.spend || 0) >= 100)
        .sort((a: any, b: any) => Number(b.roas || 0) - Number(a.roas || 0))
        .slice(0, 3)
        .map((c: any) => ({
          ad_id: c.ad_id,
          ad_name: c.ad_name || c.ad_id,
          account_name: c._account_name,
          roas: Math.round(Number(c.roas || 0) * 1000) / 1000,
          spend: Math.round(Number(c.spend || 0) * 100) / 100,
          thumbnail_url: c.thumbnail_url || null,
        }));

      // AI insights
      let aiInsights: string[] = [];
      if (ANTHROPIC_API_KEY && allCreatives.length > 0) {
        try {
          const accountSummaries = Object.entries(accountData).map(([_id, d]: [string, any]) =>
            `${d.name}: $${d.spend.toFixed(0)} spend, ${d.roas == null ? "n/a" : d.roas.toFixed(2)}x ROAS, ${d.win_rate.toFixed(0)}% win rate, ${d.creative_count} creatives`
          ).join("\n");

          const aiResp = await fetch(ANTHROPIC_URL, {
            method: "POST",
            headers: {
              "x-api-key": ANTHROPIC_API_KEY,
              "Content-Type": "application/json",
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: ANTHROPIC_MODEL,
              max_tokens: 1024,
              system: "You are a creative performance analyst reviewing a multi-account portfolio. Return exactly 3-5 bullet points. Each bullet is a plain-English cross-account insight or recommendation. Focus on patterns across accounts, format comparisons, and strategic recommendations. No markdown.",
              messages: [
                { role: "user", content: `Portfolio: ${account_ids.length} accounts. Period: ${dateStart} to ${dateEnd}. Total spend: $${portfolioSpend.toFixed(0)}. Blended ROAS: ${portfolioRoas == null ? "n/a" : portfolioRoas.toFixed(2)}x. Total creatives: ${portfolioCreativeCount}.\n\nAccount breakdown:\n${accountSummaries}\n\nTop winners: ${JSON.stringify(portfolioWinners)}` },
              ],
              tools: [{
                name: "return_insights",
                description: "Return 3-5 portfolio-level insight bullets",
                input_schema: {
                  type: "object",
                  properties: { insights: { type: "array", items: { type: "string" } } },
                  required: ["insights"],
                },
              }],
              tool_choice: { type: "tool", name: "return_insights" },
            }),
          });
          if (aiResp.ok) {
            const aiData = await aiResp.json();
            const toolUse = aiData.content?.find((b: any) => b.type === "tool_use" && b.name === "return_insights");
            if (toolUse?.input?.insights) aiInsights = toolUse.input.insights;
          }
        } catch (aiErr) {
          console.error("Portfolio AI insights error:", aiErr);
        }
      }

      // Build portfolio data blob stored in sections
      const portfolioData = {
        account_summaries: Object.entries(accountData).map(([id, d]: [string, any]) => ({
          account_id: id,
          ...d,
        })),
        portfolio_winners: portfolioWinners,
        ai_insights: aiInsights,
        date_start: dateStart,
        date_end: dateEnd,
      };

      const finalName = report_name || `Goodo Studios Portfolio Performance Report`;

      const report = {
        report_name: finalName,
        // No owning account: a portfolio report holds several clients' numbers, and an owner
        // would let that one client read them all (audit 1.3). A database check enforces this.
        account_id: null,
        is_public: isPublic,
        report_type: "portfolio",
        portfolio_account_ids: account_ids,
        creative_count: portfolioCreativeCount,
        total_spend: Math.round(portfolioSpend * 100) / 100,
        blended_roas: roundOrNull(portfolioRoas, 2),
        average_cpa: roundOrNull(portfolioCpa, 2),
        average_ctr: roundOrNull(portfolioCtr, 2),
        win_rate: 0,
        top_performers: JSON.stringify(portfolioWinners),
        date_range_start: dateStart,
        date_range_end: dateEnd,
        date_range_days: days,
        sections: [portfolioData], // Store portfolio data in sections
      };

      const { data: savedReport, error: insertErr } = await supabase.from("reports").insert(report).select().single();
      if (insertErr) throw insertErr;

      return new Response(JSON.stringify(savedReport), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // POST /reports/rollup — generate reports for multiple accounts
    if (req.method === "POST" && path === "rollup") {
      // Staff-only check (employee parity, 2026-07-21)
      if (!roles.includes("builder") && !roles.includes("employee")) {
        return new Response(JSON.stringify({ error: "Staff role required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const body = await req.json();
      const { date_start, date_end, auto_share } = body;

      const range = validateDateRange(date_start, date_end);
      if (!range.ok) return jsonError(range.error, 400);
      const { dateStart, dateEnd, days } = range;
      const ids = validateAccountIds(body.account_ids, { min: 1 });
      if (!ids.ok) return jsonError(ids.error, 400);
      const account_ids = ids.accountIds;

      // Get month name for report naming
      const monthDate = new Date(dateStart);
      const monthName = monthDate.toLocaleString("en-US", { month: "long" });
      const year = monthDate.getFullYear();

      // Get account details
      const { data: accts } = await supabase.from("ad_accounts").select("id, name").in("id", account_ids);
      const acctMap: Record<string, string> = {};
      for (const a of accts || []) acctMap[a.id] = a.name;

      const results: any[] = [];

      for (const accountId of account_ids) {
        const accountName = acctMap[accountId] || accountId;
        try {
          const list = await aggregateDailyMetrics(supabase, accountId, dateStart, dateEnd);

          const blended = computeBlendedMetrics(list);
          const totalSpend = blended.spend;
          const winners = selectWinnersBySpend(list as { spend?: number | null }[]);
          const winRate = list.length > 0 ? (winners.length / list.length) * 100 : 0;

          const tagCounts = { parsed: 0, csv_match: 0, manual: 0, untagged: 0 };
          list.forEach((c: any) => {
            const src = c.tag_source || "untagged";
            if (src in tagCounts) tagCounts[src as keyof typeof tagCounts]++;
          });

          const sorted = [...list].sort((a: any, b: any) => Number(b.spend || 0) - Number(a.spend || 0));
          const mapPerformer = (c: any) => ({
            ad_id: c.ad_id, ad_name: c.ad_name || c.ad_id, unique_code: c.unique_code,
            roas: Math.round(Number(c.roas || 0) * 1000) / 1000,
            cpa: Math.round(Number(c.cpa || 0) * 100) / 100,
            spend: Math.round(Number(c.spend || 0) * 100) / 100,
            ctr: Math.round(Number(c.ctr || 0) * 1000) / 1000,
          });

          const { counts: diagCounts, suggestions: diagSuggestions } = computeDiagnostics(list);

          // Generate AI performance highlights
          let aiHighlights: string[] = [];
          if (ANTHROPIC_API_KEY && list.length > 0) {
            try {
              const top10 = sorted.slice(0, 10).map(c => ({
                name: c.ad_name, roas: Number(c.roas || 0).toFixed(2), spend: Number(c.spend || 0).toFixed(0),
                cpa: Number(c.cpa || 0).toFixed(2), ctr: Number(c.ctr || 0).toFixed(2),
              }));
              const aiResp = await fetch(ANTHROPIC_URL, {
                method: "POST",
                headers: {
                  "x-api-key": ANTHROPIC_API_KEY,
                  "Content-Type": "application/json",
                  "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                  model: ANTHROPIC_MODEL,
                  max_tokens: 1024,
                  system: "You are a creative performance analyst. Return exactly 3-5 bullet points. Each bullet is a plain-English performance highlight. No markdown.",
                  messages: [
                    { role: "user", content: `Account: ${accountName}. Period: ${monthName} ${year}. Total spend: $${totalSpend.toFixed(0)}. Blended ROAS: ${blended.roas == null ? "n/a" : blended.roas.toFixed(2)}x. Win rate: ${winRate.toFixed(0)}%. Creatives: ${list.length}. Top performers: ${JSON.stringify(top10)}` },
                  ],
                  tools: [{
                    name: "return_highlights",
                    description: "Return 3-5 performance highlight bullets",
                    input_schema: {
                      type: "object",
                      properties: { highlights: { type: "array", items: { type: "string" } } },
                      required: ["highlights"],
                    },
                  }],
                  tool_choice: { type: "tool", name: "return_highlights" },
                }),
              });
              if (aiResp.ok) {
                const aiData = await aiResp.json();
                const toolUse = aiData.content?.find((b: any) => b.type === "tool_use" && b.name === "return_highlights");
                if (toolUse?.input?.highlights) aiHighlights = toolUse.input.highlights;
              }
            } catch (aiErr) {
              console.error("AI highlights error for", accountId, aiErr);
            }
          }

          // Build auto-layout sections
          const sections = [
            { id: crypto.randomUUID(), type: "text", config: { content: `## ${accountName} — ${monthName} ${year} Performance Report\n\n${aiHighlights.length > 0 ? aiHighlights.map(h => `- ${h}`).join("\n") : ""}` } },
            { id: crypto.randomUUID(), type: "metric_summary", config: {} },
            { id: crypto.randomUUID(), type: "top_creatives", config: { count: 6, sortBy: "spend" } },
            { id: crypto.randomUUID(), type: "chart", config: { metric: "spend" } },
            { id: crypto.randomUUID(), type: "chart", config: { metric: "roas" } },
            { id: crypto.randomUUID(), type: "tag_breakdown", config: { tagField: "hook" } },
          ];

          const reportName = `${accountName} — ${monthName} ${year} Performance Report`;

          const report = {
            report_name: reportName,
            account_id: accountId,
            is_public: !!auto_share,
            creative_count: list.length,
            total_spend: Math.round(totalSpend * 100) / 100,
            blended_roas: roundOrNull(blended.roas, 2),
            average_cpa: roundOrNull(blended.cpa, 2),
            average_ctr: roundOrNull(blended.ctr, 2),
            win_rate: Math.round(winRate * 100) / 100,
            tags_parsed_count: tagCounts.parsed,
            tags_csv_count: tagCounts.csv_match,
            tags_manual_count: tagCounts.manual,
            tags_untagged_count: tagCounts.untagged,
            top_performers: JSON.stringify(sorted.slice(0, 10).map(mapPerformer)),
            date_range_start: dateStart,
            date_range_end: dateEnd,
            date_range_days: days,
            iteration_suggestions: JSON.stringify(diagSuggestions),
            sections,
            ...diagCounts,
          };

          // Idempotency (no unique constraint exists, so this is a lookup, not a lock): a retry of the same
          // rollup for the same account and period reuses the report it already created.
          const { data: existingReports, error: existingErr } = await supabase
            .from("reports")
            .select("*")
            .eq("account_id", accountId)
            .eq("report_name", reportName)
            .eq("date_range_start", dateStart)
            .eq("date_range_end", dateEnd)
            .eq("report_type", "standard")
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(1);
          if (existingErr) throw existingErr;

          let savedReport: any = existingReports?.[0] ?? null;
          const reusedReport = !!savedReport;
          if (!savedReport) {
            const { data: inserted, error: insertErr } = await supabase.from("reports").insert(report).select().single();
            if (insertErr) throw insertErr;
            savedReport = inserted;
          } else if (auto_share && !savedReport.is_public) {
            const { error: shareErr } = await supabase.from("reports").update({ is_public: true }).eq("id", savedReport.id);
            if (shareErr) throw shareErr;
          }

          // Auto-share makes the report visible (is_public above). It used to also write
          // in-app "New Report" notification rows, which nothing in the app reads, so that
          // write was removed (audit 5.2). shared_count stays in the response for the modal.
          const sharedCount = 0;

          results.push({ account_id: accountId, account_name: accountName, report_id: savedReport.id, shared_count: sharedCount, reused: reusedReport, success: true });
        } catch (err) {
          console.error(`Rollup error for ${accountId}:`, err);
          results.push({ account_id: accountId, account_name: accountName, success: false, error: String(err) });
        }
      }

      return new Response(JSON.stringify({
        total: results.length,
        success_count: results.filter(r => r.success).length,
        shared_count: results.reduce((s, r) => s + (r.shared_count || 0), 0),
        results,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // POST /reports/slack/:id
    if (req.method === "POST" && path.startsWith("slack/")) {
      const reportId = path.replace("slack/", "");
      const { data: r, error } = await supabase.from("reports").select("*").eq("id", reportId).single();
      if (error || !r) {
        return new Response(JSON.stringify({ error: "Report not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Mark report as public since it's being shared via Slack
      if (!r.is_public) {
        await supabase.from("reports").update({ is_public: true }).eq("id", reportId);
      }
      await sendReportToSlack(r);
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // DELETE /reports/:id
    if (req.method === "DELETE" && path) {
      const { error } = await supabase.from("reports").delete().eq("id", path);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Reports error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
