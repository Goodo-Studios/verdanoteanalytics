import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";


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
  suggestions.sort((a, b) => b.spend - a.spend);
  return { counts, suggestions };
}

function cleanAdName(name: string): string {
  if (!name) return "Unknown";
  const m = name.match(/(?:^|>)iName:([^>]+)/i);
  if (m) return m[1];
  if (name.includes(">")) return name.split(">")[0] || name.substring(0, 40);
  return name.length > 45 ? name.substring(0, 42) + "…" : name;
}

// Returns "↑ +12%" / "↓ -8%" / "" when change is negligible
function wowArrow(curr: number, prev: number): string {
  if (!prev || prev === 0) return "";
  const pct = ((curr - prev) / prev) * 100;
  if (Math.abs(pct) < 2) return "";
  const sign = pct > 0 ? "↑ +" : "↓ ";
  return ` ${sign}${Math.abs(pct).toFixed(0)}%`;
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

  // Spend / CPA / CPM with WoW arrows
  const spendText = `*Spend*\n${fmtMoney(report.total_spend)}${wowArrow(report.total_spend, report.prev_spend)}`;
  const cpaText   = `*CPA*\n${fmtMoney(report.overall_cpa)}${wowArrow(report.overall_cpa, report.prev_cpa)}`;
  const cpmText   = `*CPM*\n${fmtMoney(report.overall_cpm)}${wowArrow(report.overall_cpm, report.prev_cpm)}`;
  blocks.push({ type: "section", fields: [
    { type: "mrkdwn", text: spendText },
    { type: "mrkdwn", text: cpaText },
    { type: "mrkdwn", text: cpmText },
  ]});

  // Top 5 performers
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
    blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "View Full Report →", emoji: true }, url: `${appUrl}/reports/${report.id}` }] });
  }

  try { await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blocks }) }); }
  catch (e) { console.error("Slack webhook error:", e); }
}

function resolveTemplate(template: string, accountName: string, cadence: string): string {
  const now = new Date();
  return template
    .replace(/\{account\}/gi, accountName)
    .replace(/\{cadence\}/gi, cadence.charAt(0).toUpperCase() + cadence.slice(1))
    .replace(/\{date\}/gi, now.toLocaleDateString("en-US"));
}

// Scan creative_daily_metrics ONCE over a contiguous date range, splitting rows
// in-memory into "current" (date >= splitDate) and "prior" (date < splitDate)
// per-ad accumulator maps. The report's prior period is constructed to end
// exactly one day before the current period starts (priorEnd = now - days - 1,
// currentStart = now - days), so the union range [priorStart, endDate] is
// always contiguous and a single paged scan covers both periods — half the
// daily-metrics round-trips of aggregating each period separately.
async function scanDailyMetricsSplit(
  supabase: any, accountId: string, dateStart: string, dateEnd: string, splitDate: string,
): Promise<{ current: Record<string, any>; prior: Record<string, any> }> {
  const current: Record<string, any> = {};
  const prior: Record<string, any> = {};
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("creative_daily_metrics")
      .select("ad_id, account_id, date, spend, impressions, clicks, purchases, purchase_value, adds_to_cart, video_views, thumb_stop_rate, hold_rate")
      .eq("account_id", accountId)
      .gte("date", dateStart)
      .lte("date", dateEnd)
      .range(offset, offset + batchSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const m of data) {
      // ISO date strings compare correctly lexicographically
      const byAd = m.date >= splitDate ? current : prior;
      if (!byAd[m.ad_id]) {
        byAd[m.ad_id] = {
          ad_id: m.ad_id, account_id: m.account_id,
          spend: 0, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0,
          adds_to_cart: 0, video_views: 0, _days: 0,
          _tsr_sum: 0, _hr_sum: 0,
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
      a._tsr_sum += Number(m.thumb_stop_rate || 0);
      a._hr_sum += Number(m.hold_rate || 0);
    }
    if (data.length < batchSize) break;
    offset += batchSize;
  }
  return { current, prior };
}

// Fetch creative metadata for any ad_ids missing from the shared cache.
// The cache is request-scoped, so the current and prior periods (and multiple
// schedules on the same account) hit the creatives table once per ad_id
// instead of once per period. Ad_ids with no creatives row are cached as {}
// so they aren't re-queried.
async function fetchCreativeMeta(supabase: any, adIds: string[], cache: Map<string, any>) {
  const missing = adIds.filter((id) => !cache.has(id));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const { data: crs } = await supabase
      .from("creatives")
      .select("ad_id, ad_name, unique_code, ad_type, tag_source")
      .in("ad_id", batch);
    for (const c of crs || []) cache.set(c.ad_id, c);
  }
  for (const id of missing) if (!cache.has(id)) cache.set(id, {});
}

// Merge per-ad daily accumulators with cached creative metadata into the same
// list shape the old aggregateDailyMetrics returned.
function finalizeDailyList(byAd: Record<string, any>, metaCache: Map<string, any>) {
  return Object.keys(byAd).map((adId) => {
    const a = byAd[adId];
    const meta = metaCache.get(adId) || {};
    const days = a._days || 1;
    return {
      ...meta, ad_id: adId, account_id: a.account_id,
      spend: a.spend, impressions: a.impressions, clicks: a.clicks,
      purchases: a.purchases, purchase_value: a.purchase_value,
      ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
      cpa: a.purchases > 0 ? a.spend / a.purchases : 0,
      roas: a.spend > 0 ? a.purchase_value / a.spend : 0,
      thumb_stop_rate: a._tsr_sum / days,
      hold_rate: a._hr_sum / days,
    };
  }).filter((c) => c.spend > 0);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth: Supabase gateway validates the JWT/apikey before reaching this function.
  // Cron calls use the project anon key which passes gateway validation.

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";
    if (force) {
      const cronSecret = Deno.env.get("CRON_SECRET");
      const providedSecret = req.headers.get("x-cron-secret");
      if (!cronSecret || providedSecret !== cronSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const dayOfMonth = now.getUTCDate();

    const { data: schedules, error: schedErr } = await supabase
      .from("report_schedules")
      .select("*, ad_accounts!inner(id, name, is_active)")
      .eq("enabled", true);

    if (schedErr) throw schedErr;

    const generated: string[] = [];
    // Request-scoped creative metadata cache shared across periods + schedules
    const metaCache = new Map<string, any>();

    for (const schedule of schedules || []) {
      const account = (schedule as any).ad_accounts;
      if (!account?.is_active) continue;

      let shouldGenerate = force; // ?force=true bypasses day-of-week check
      if (!force && schedule.cadence === "weekly" && dayOfWeek === 1) shouldGenerate = true;
      else if (!force && schedule.cadence === "monthly" && dayOfMonth === 1) shouldGenerate = true;

      if (!shouldGenerate) continue;

      const dateRangeDays = schedule.date_range_days || (schedule.cadence === "weekly" ? 7 : 30);
      const endDate = now.toISOString().split("T")[0];
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - dateRangeDays);
      const startDateStr = startDate.toISOString().split("T")[0];

      // Prior period for WoW comparison (same duration, shifted back).
      // The prior period ends exactly one day before the current period starts
      // (prior end = now - days - 1, current start = now - days), so one
      // contiguous scan over [priorStart, endDate] split at startDateStr
      // covers both periods.
      const priorStartDate = new Date(now);
      priorStartDate.setDate(priorStartDate.getDate() - dateRangeDays * 2 - 1);
      const priorStartStr = priorStartDate.toISOString().split("T")[0];

      // Single daily-metrics scan for current + prior; creative metadata
      // fetched once per ad_id via the shared request-scoped cache.
      const { current: currByAd, prior: priorByAd } = await scanDailyMetricsSplit(
        supabase, account.id, priorStartStr, endDate, startDateStr,
      );
      await fetchCreativeMeta(
        supabase,
        [...new Set([...Object.keys(currByAd), ...Object.keys(priorByAd)])],
        metaCache,
      );
      const list = finalizeDailyList(currByAd, metaCache);

      const totalSpend = list.reduce((s: number, c: any) => s + Number(c.spend || 0), 0);
      const avgField = (field: string) => {
        if (list.length === 0) return 0;
        return list.reduce((s: number, c: any) => s + Number(c[field] || 0), 0) / list.length;
      };

      const winners = list.filter((c: any) => Number(c.roas || 0) > 1);
      const winRate = list.length > 0 ? (winners.length / list.length) * 100 : 0;

      const tagCounts = { parsed: 0, csv_match: 0, manual: 0, untagged: 0 };
      list.forEach((c: any) => {
        const src = c.tag_source || "untagged";
        if (src in tagCounts) tagCounts[src as keyof typeof tagCounts]++;
      });

      // Overall CPA + CPM (actual totals, not averages of per-creative values)
      const totalImpressions = list.reduce((s: number, c: any) => s + Number(c.impressions || 0), 0);
      const totalPurchases = list.reduce((s: number, c: any) => s + Number(c.purchases || 0), 0);
      const overallCpa = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
      const overallCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;

      // Prior-period totals from the same scan (split in-memory above)
      const priorList = finalizeDailyList(priorByAd, metaCache);
      const priorSpend = priorList.reduce((s: number, c: any) => s + Number(c.spend || 0), 0);
      const priorImpressions = priorList.reduce((s: number, c: any) => s + Number(c.impressions || 0), 0);
      const priorPurchases = priorList.reduce((s: number, c: any) => s + Number(c.purchases || 0), 0);
      const priorCpa = priorPurchases > 0 ? priorSpend / priorPurchases : 0;
      const priorCpm = priorImpressions > 0 ? (priorSpend / priorImpressions) * 1000 : 0;

      const sorted = [...list].sort((a: any, b: any) => Number(b.spend || 0) - Number(a.spend || 0));
      const mapPerformer = (c: any) => ({
        ad_id: c.ad_id, ad_name: c.ad_name || c.ad_id, unique_code: c.unique_code,
        spend: Math.round(Number(c.spend || 0) * 100) / 100,
        roas: Math.round(Number(c.roas || 0) * 1000) / 1000,
        ctr: Math.round(Number(c.ctr || 0) * 1000) / 1000,
        thumb_stop_rate: Math.round(Number(c.thumb_stop_rate || 0) * 100) / 100,
        hold_rate: Math.round(Number(c.hold_rate || 0) * 100) / 100,
      });

      const reportName = resolveTemplate(
        schedule.report_name_template || `{cadence} Report - {account}`,
        account.name, schedule.cadence
      );

      const report = {
        report_name: reportName,
        account_id: account.id,
        creative_count: list.length,
        total_spend: Math.round(totalSpend * 100) / 100,
        blended_roas: Math.round(avgField("roas") * 100) / 100,
        average_cpa: Math.round(overallCpa * 100) / 100,
        average_ctr: Math.round(avgField("ctr") * 100) / 100,
        win_rate: Math.round(winRate * 100) / 100,
        tags_parsed_count: tagCounts.parsed,
        tags_csv_count: tagCounts.csv_match,
        tags_manual_count: tagCounts.manual,
        tags_untagged_count: tagCounts.untagged,
        top_performers: JSON.stringify(sorted.slice(0, 10).map(mapPerformer)),
        date_range_start: startDateStr,
        date_range_end: endDate,
        date_range_days: dateRangeDays,
        ...(() => { const { counts, suggestions } = computeDiagnostics(list); return { ...counts, iteration_suggestions: JSON.stringify(suggestions) }; })(),
        is_public: !!schedule.deliver_to_slack,
      };

      let savedReport: any = null;
      if (schedule.deliver_to_app) {
        const { data, error: insertErr } = await supabase.from("reports").insert(report).select().single();
        if (insertErr) { console.error("Insert error for", account.id, insertErr); continue; }
        savedReport = data;
      }

      if (schedule.deliver_to_slack) {
        // Merge WoW + overall CPM/CPA data (computed above, not stored in DB)
        await sendReportToSlack({
          ...(savedReport || report),
          overall_cpa: Math.round(overallCpa * 100) / 100,
          overall_cpm: Math.round(overallCpm * 100) / 100,
          prev_spend: Math.round(priorSpend * 100) / 100,
          prev_cpa: Math.round(priorCpa * 100) / 100,
          prev_cpm: Math.round(priorCpm * 100) / 100,
        });
      }

      generated.push(`${account.id}:${schedule.cadence}`);
    }

    return new Response(JSON.stringify({ generated, count: generated.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Scheduled reports error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
