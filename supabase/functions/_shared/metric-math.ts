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

// ─── Video and frequency metrics from daily rows (audit 6.1) ───────────────────────────
// Per-day averages of these ratios count a tiny day as much as a big one. Build them from
// counts instead (all percentages as percent values, 2 means 2%):
//   hook rate  = sum(video_views) / sum(impressions) x 100, over rows with video_views > 0,
//                so image days do not drag it down
//   hold rate  = sum(hold_rate / 100 x video_views) / sum(video_views) x 100
//                (hold_rate / 100 x video_views rebuilds the thruplays, which are not stored)
//   play time  = sum(play_time x video_views) / sum(video_views)
//   frequency  = impression-weighted average of daily frequency. Approximate: reach is not
//                stored, and daily reach cannot be added up.
// Null when there is no denominator.

export interface VideoRowLike {
  impressions?: number | string | null;
  video_views?: number | string | null;
  hold_rate?: number | string | null;
  video_avg_play_time?: number | string | null;
  frequency?: number | string | null;
}

export interface VideoAccumulator {
  videoViews: number;
  videoImpressions: number;
  thruplays: number;
  playSeconds: number;
  impressions: number;
  frequencyWeighted: number;
}

export interface VideoMetrics {
  hook_rate: number | null;
  hold_rate: number | null;
  avg_play_time: number | null;
  frequency_approx: number | null;
}

export function emptyVideoAccumulator(): VideoAccumulator {
  return { videoViews: 0, videoImpressions: 0, thruplays: 0, playSeconds: 0, impressions: 0, frequencyWeighted: 0 };
}

export function addVideoRow(acc: VideoAccumulator, row: VideoRowLike): VideoAccumulator {
  const impressions = num(row.impressions);
  const views = num(row.video_views);
  acc.impressions += impressions;
  acc.frequencyWeighted += num(row.frequency) * impressions;
  if (views > 0) {
    acc.videoViews += views;
    acc.videoImpressions += impressions;
    acc.thruplays += (num(row.hold_rate) / 100) * views;
    acc.playSeconds += num(row.video_avg_play_time) * views;
  }
  return acc;
}

export function videoMetricsFromAccumulator(acc: VideoAccumulator): VideoMetrics {
  return {
    hook_rate: ratioOrNull(acc.videoViews, acc.videoImpressions, 100),
    hold_rate: ratioOrNull(acc.thruplays, acc.videoViews, 100),
    avg_play_time: ratioOrNull(acc.playSeconds, acc.videoViews),
    frequency_approx: ratioOrNull(acc.frequencyWeighted, acc.impressions),
  };
}

export function computeVideoMetrics(rows: VideoRowLike[]): VideoMetrics {
  const acc = emptyVideoAccumulator();
  for (const r of rows) addVideoRow(acc, r);
  return videoMetricsFromAccumulator(acc);
}
