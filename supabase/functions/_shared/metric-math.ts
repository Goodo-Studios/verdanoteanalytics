// Shared metric math for report-style edge functions (reports, scheduled-reports, spend-diagnostic).
//
// Blended ratios are computed from SUMMED numerators and denominators, never as an unweighted mean
// of per-creative ratios (which over-weights tiny ads and counts zero-purchase ads as CPA 0):
//   roas = sum(purchase_value) / sum(spend)
//   cpa  = sum(spend) / sum(purchases)
//   ctr  = sum(clicks) / sum(impressions) * 100   (percent, matching the stored ctr columns)
//   cpm  = sum(spend) / sum(impressions) * 1000
// A ratio is null (not 0) when its denominator is 0, so "no data" is distinguishable from "zero".

export interface MetricRowLike {
  spend?: number | string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
  purchases?: number | string | null;
  purchase_value?: number | string | null;
}

export interface MetricTotals {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
}

export interface BlendedMetrics extends MetricTotals {
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
  cpm: number | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** numerator / denominator, or null when the denominator is not positive. */
export function ratioOrNull(numerator: number, denominator: number, scale = 1): number | null {
  return denominator > 0 ? (numerator / denominator) * scale : null;
}

export function sumMetricTotals(rows: MetricRowLike[]): MetricTotals {
  const t: MetricTotals = { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0 };
  for (const r of rows) {
    t.spend += num(r.spend);
    t.impressions += num(r.impressions);
    t.clicks += num(r.clicks);
    t.purchases += num(r.purchases);
    t.purchase_value += num(r.purchase_value);
  }
  return t;
}

export function blendedMetricsFromTotals(t: MetricTotals): BlendedMetrics {
  return {
    ...t,
    roas: ratioOrNull(t.purchase_value, t.spend),
    cpa: ratioOrNull(t.spend, t.purchases),
    ctr: ratioOrNull(t.clicks, t.impressions, 100),
    cpm: ratioOrNull(t.spend, t.impressions, 1000),
  };
}

export function computeBlendedMetrics(rows: MetricRowLike[]): BlendedMetrics {
  return blendedMetricsFromTotals(sumMetricTotals(rows));
}

/** Round to `dp` decimal places, keeping null as null. */
export function roundOrNull(v: number | null, dp: number): number | null {
  if (v === null) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
