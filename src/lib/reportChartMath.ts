// Report page math (audit 6.1). Every ratio comes from summed counts through the shared
// metric-math module, never from an average of per-ad or per-ad-day ratios.
import { computeBlendedMetrics, type MetricRowLike } from "../../supabase/functions/_shared/metric-math.ts";

export type ChartMetric = "spend" | "roas" | "cpa" | "ctr";

export interface DailyRow extends MetricRowLike {
  date: string;
}

/**
 * One value per date for the report chart. Spend is summed; ROAS, CPA and CTR are that
 * day's totals divided out. A day with no denominator is NaN, which the chart shows as a gap.
 */
export function dailySeries(rows: DailyRow[], metric: ChartMetric | string): { dates: string[]; values: number[] } {
  const byDate = new Map<string, DailyRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  const dates = [...byDate.keys()].sort();
  const values = dates.map((d) => {
    const m = computeBlendedMetrics(byDate.get(d)!);
    const v = metric === "spend" ? m.spend
      : metric === "roas" ? m.roas
      : metric === "cpa" ? m.cpa
      : metric === "ctr" ? m.ctr
      : null;
    return v === null ? Number.NaN : v;
  });
  return { dates, values };
}

export interface TagRow extends MetricRowLike {
  hook?: string | null;
  style?: string | null;
  ad_type?: string | null;
}

/** Report page tag breakdown: group ROAS = revenue / spend (null with no spend), share of spend. */
export function tagBreakdown(rows: TagRow[], limit = 15) {
  const groups = new Map<string, TagRow[]>();
  for (const c of rows) {
    const key = c.hook || c.style || c.ad_type || "Untagged";
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  const total = computeBlendedMetrics(rows).spend;
  return [...groups.entries()]
    .map(([tag, items]) => {
      const m = computeBlendedMetrics(items);
      return { tag, roas: m.roas, count: items.length, spendPct: total > 0 ? (m.spend / total) * 100 : 0 };
    })
    .sort((a, b) => b.spendPct - a.spendPct)
    .slice(0, limit);
}
