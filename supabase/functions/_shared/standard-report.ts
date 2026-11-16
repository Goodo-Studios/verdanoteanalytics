// The standard (single-account) report, shared by POST /reports and the correction of old
// reports (audit 6.3). Moved out of reports/index.ts unchanged, plus buildStandardReportFields
// (the report row a new report gets, minus its name and account) and correctReport.
// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */

import { addDailyTotal, buildReportSnapshot, type SnapshotDailyTotal } from "./report-snapshot.ts";
import { selectWinnersBySpend } from "./creative-classification.ts";
import { addVideoRow, computeBlendedMetrics, emptyVideoAccumulator, roundOrNull, videoMetricsFromAccumulator } from "./metric-math.ts";

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

export function computeDiagnostics(creatives: any[]) {
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

export async function aggregateDailyMetrics(
  supabase: any, accountId: string | null, dateStart: string, dateEnd: string,
  dailyTotals?: Map<string, SnapshotDailyTotal>,
) {
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
    if (dailyTotals) addDailyTotal(dailyTotals, m);
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
      .select("ad_id, ad_name, unique_code, ad_type, tag_source, person, style, hook, product, theme, campaign_name, adset_name, thumbnail_url")
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

/**
 * Every computed column of a standard report for one account (or all accounts when null) and
 * date range. Leaves out report_name, account_id, sharing and ids, which the caller owns.
 */
export async function buildStandardReportFields(
  supabase: any, accountId: string | null, dateStart: string, dateEnd: string, days: number,
): Promise<Record<string, any>> {
  const dailyTotals = new Map<string, SnapshotDailyTotal>();
  const list = await aggregateDailyMetrics(supabase, accountId, dateStart, dateEnd, dailyTotals);

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

  return {
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
    // Frozen top creatives, tag mix and chart series for exports (audit 6.2).
    snapshot: buildReportSnapshot(list, dailyTotals),
  };
}

export type CorrectionResult =
  | { status: "corrected"; report_id: string; before: Record<string, unknown>; after: Record<string, unknown> }
  | { status: "no_data"; report_id: string }
  | { status: "error"; report_id: string; error: string };

const HEADLINE = ["total_spend", "blended_roas", "average_cpa", "average_ctr", "creative_count"];
const pick = (row: Record<string, unknown>) => Object.fromEntries(HEADLINE.map((k) => [k, row[k] ?? null]));

/**
 * Rebuild one existing standard report for its own account and dates (audit 6.3). The original
 * row goes to report_corrections first; if that fails, the report is left as it was. A report
 * with no daily data left for its range is not touched.
 */
export async function correctReport(supabase: any, row: Record<string, any>): Promise<CorrectionResult> {
  const id = String(row.id);
  const fields = await buildStandardReportFields(
    supabase, row.account_id ?? null, row.date_range_start, row.date_range_end, row.date_range_days,
  );
  if (!fields.creative_count) return { status: "no_data", report_id: id };

  const { error: backupErr } = await supabase.from("report_corrections").insert({
    report_id: id, original: row, corrected: fields, reason: "audit 6.3: report math fixed in #314",
  });
  if (backupErr) return { status: "error", report_id: id, error: `backup: ${backupErr.message}` };

  const { error: updErr } = await supabase.from("reports").update(fields).eq("id", id);
  if (updErr) return { status: "error", report_id: id, error: `update: ${updErr.message}` };
  return { status: "corrected", report_id: id, before: pick(row), after: pick(fields) };
}
