// Group metrics for screens that combine several creatives (audit 6.1).
//
// Every ratio comes from summed counts through the shared metric-math module, never from
// an average of per-creative ratios. Null means "no data" (no spend, no purchases, no
// impressions, no video views); screens show it as "–".
import {
  computeBlendedMetrics,
  computeVideoMetrics,
  type MetricRowLike,
  type VideoRowLike,
} from "../../supabase/functions/_shared/metric-math.ts";

export type GroupRow = MetricRowLike & VideoRowLike;

export interface GroupMetrics {
  spend: number;
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
  cpm: number | null;
  hook_rate: number | null;
  hold_rate: number | null;
  avg_play_time: number | null;
}

export function groupMetrics(rows: GroupRow[]): GroupMetrics {
  const b = computeBlendedMetrics(rows);
  const v = computeVideoMetrics(rows);
  return {
    spend: b.spend,
    roas: b.roas,
    cpa: b.cpa,
    ctr: b.ctr,
    cpm: b.cpm,
    hook_rate: v.hook_rate,
    hold_rate: v.hold_rate,
    avg_play_time: v.avg_play_time,
  };
}

/** One group metric by the key screens use for creative columns (thumb_stop_rate = hook rate). */
export function groupMetricValue(rows: GroupRow[], key: string): number | null {
  const g = groupMetrics(rows);
  switch (key) {
    case "roas": return g.roas;
    case "cpa": return g.cpa;
    case "ctr": return g.ctr;
    case "cpm": return g.cpm;
    case "thumb_stop_rate":
    case "hook_rate": return g.hook_rate;
    case "hold_rate": return g.hold_rate;
    case "video_avg_play_time": return g.avg_play_time;
    default: return null;
  }
}

/** "–" for no data, else the formatted value. */
export function fmtOrDash(v: number | null, format: (n: number) => string): string {
  return v === null ? "–" : format(v);
}
