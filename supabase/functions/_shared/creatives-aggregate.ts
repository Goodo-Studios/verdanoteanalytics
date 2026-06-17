// Pure aggregation helpers for the `creatives` edge function's date-filtered
// path. Extracted so the per-ad daily rollup and the portfolio averages can be
// unit-tested (deno test creatives-aggregate.test.ts) independently of the HTTP
// handler.
//
// The average ROAS/CPA method here is deliberately SPEND-WEIGHTED so it stays
// identical to the get_period_metrics RPC (ΣpurchaseValue / Σspend). The old
// inline code averaged each ad's ratio unweighted, which over-weighted
// tiny-spend ads and made the CreativesPage aggregate diverge from the Overview
// scorecard for the same date range.

const num = (v: unknown): number => Number(v) || 0;

export interface DailyMetricRow {
  ad_id: string;
  spend?: number | string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
  purchases?: number | string | null;
  purchase_value?: number | string | null;
  adds_to_cart?: number | string | null;
  video_views?: number | string | null;
  frequency?: number | string | null;
  thumb_stop_rate?: number | string | null;
  hold_rate?: number | string | null;
  video_avg_play_time?: number | string | null;
}

export interface AdAggregate {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  adds_to_cart: number;
  video_views: number;
  _freq_weighted: number;
  _freq_imp: number;
  _tsr_weighted: number;
  _tsr_imp: number;
  _hr_weighted: number;
  _hr_vv: number;
  _vpt_weighted: number;
  _vpt_vv: number;
  _days: number;
}

function emptyAggregate(): AdAggregate {
  return {
    spend: 0, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0,
    adds_to_cart: 0, video_views: 0,
    _freq_weighted: 0, _freq_imp: 0, _tsr_weighted: 0, _tsr_imp: 0,
    _hr_weighted: 0, _hr_vv: 0, _vpt_weighted: 0, _vpt_vv: 0, _days: 0,
  };
}

/**
 * Roll daily-metric rows up to one aggregate per ad_id over whatever date range
 * the caller already filtered to. Additive metrics (spend, impressions, …) are
 * summed; rate metrics (frequency, thumb-stop, hold, avg-play-time) use the same
 * impressions- / video-views-weighted averages as the original handler. This is
 * the function that attributes spend to each ad for the picked days.
 */
export function aggregateDailyByAd(rows: DailyMetricRow[]): Record<string, AdAggregate> {
  const aggMap: Record<string, AdAggregate> = {};
  for (const row of rows) {
    if (!aggMap[row.ad_id]) aggMap[row.ad_id] = emptyAggregate();
    const a = aggMap[row.ad_id];
    const imp = num(row.impressions);
    const vv = num(row.video_views);
    const freq = num(row.frequency);
    const tsr = num(row.thumb_stop_rate);
    const hr = num(row.hold_rate);
    const vpt = num(row.video_avg_play_time);
    a.spend += num(row.spend);
    a.impressions += imp;
    a.clicks += num(row.clicks);
    a.purchases += num(row.purchases);
    a.purchase_value += num(row.purchase_value);
    a.adds_to_cart += num(row.adds_to_cart);
    a.video_views += vv;
    // Impressions-weighted average for frequency & thumb stop rate
    if (freq > 0 && imp > 0) { a._freq_weighted += freq * imp; a._freq_imp += imp; }
    if (tsr > 0 && imp > 0) { a._tsr_weighted += tsr * imp; a._tsr_imp += imp; }
    // Video-views-weighted average for hold rate & avg play time
    if (hr > 0 && vv > 0) { a._hr_weighted += hr * vv; a._hr_vv += vv; }
    if (vpt > 0 && vv > 0) { a._vpt_weighted += vpt * vv; a._vpt_vv += vv; }
    a._days += 1;
  }
  return aggMap;
}

/**
 * Spend-weighted portfolio aggregates, identical in method to the
 * get_period_metrics RPC:
 *   avg_roas = Σ purchase_value / Σ spend
 *   avg_cpa  = Σ spend          / Σ purchases
 * Returns zeros for an empty set (no division by zero). Works for any row shape
 * that exposes spend / purchases / purchase_value.
 */
export function computeWeightedAggregates(
  items: Array<{
    spend?: number | string | null;
    purchases?: number | string | null;
    purchase_value?: number | string | null;
  }>,
): { total_spend: number; avg_cpa: number; avg_roas: number } {
  let totalSpend = 0;
  let totalPurchases = 0;
  let totalPurchaseValue = 0;
  for (const it of items) {
    totalSpend += num(it.spend);
    totalPurchases += num(it.purchases);
    totalPurchaseValue += num(it.purchase_value);
  }
  return {
    total_spend: totalSpend,
    avg_cpa: totalPurchases > 0 ? totalSpend / totalPurchases : 0,
    avg_roas: totalSpend > 0 ? totalPurchaseValue / totalSpend : 0,
  };
}
