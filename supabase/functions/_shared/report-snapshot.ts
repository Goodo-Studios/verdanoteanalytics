// Report snapshot (audit plan item 6.2).
//
// When a report is generated it saves its own top creatives, tag mix and chart series, so
// exporting it later shows what the report showed, not today's numbers. No web imports: the
// frontend imports this file too (tagMix is the report page's tag breakdown).

import { computeBlendedMetrics, ratioOrNull } from "./metric-math.ts";

export const REPORT_SNAPSHOT_VERSION = 1;

type Num = number | string | null | undefined;
const num = (v: Num): number => Number(v) || 0;

export interface SnapshotCreativeInput {
  ad_id: string;
  ad_name?: string | null;
  thumbnail_url?: string | null;
  hook?: string | null;
  style?: string | null;
  ad_type?: string | null;
  spend?: Num;
  purchase_value?: Num;
  purchases?: Num;
  clicks?: Num;
  impressions?: Num;
}

export interface SnapshotCreative {
  ad_id: string;
  ad_name: string;
  thumbnail_url: string | null;
  hook: string | null;
  style: string | null;
  ad_type: string | null;
  spend: number;
  roas: number | null;
  cpa: number | null;
}

export interface TagMixRow {
  tag: string;
  roas: number | null;
  count: number;
  spendPct: number;
}

export interface SnapshotDailyTotal {
  date: string;
  spend: number;
  purchase_value: number;
  purchases: number;
  clicks: number;
  impressions: number;
}

export interface ReportSnapshot {
  version: number;
  top_creatives: SnapshotCreative[];
  tag_mix: TagMixRow[];
  chart_series: SnapshotDailyTotal[];
}

/** Group by hook, then style, then ad type; group ROAS = revenue / spend. */
export function tagMix(rows: SnapshotCreativeInput[], limit = 15): TagMixRow[] {
  const groups = new Map<string, SnapshotCreativeInput[]>();
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

/** Add one daily-metrics row to the per-date totals used for the chart. */
export function addDailyTotal(
  totals: Map<string, SnapshotDailyTotal>,
  row: { date: string; spend?: Num; purchase_value?: Num; purchases?: Num; clicks?: Num; impressions?: Num },
): void {
  if (!row?.date) return;
  const t = totals.get(row.date) ??
    { date: row.date, spend: 0, purchase_value: 0, purchases: 0, clicks: 0, impressions: 0 };
  t.spend += num(row.spend);
  t.purchase_value += num(row.purchase_value);
  t.purchases += num(row.purchases);
  t.clicks += num(row.clicks);
  t.impressions += num(row.impressions);
  totals.set(row.date, t);
}

export function buildReportSnapshot(
  list: SnapshotCreativeInput[],
  dailyTotals: Map<string, SnapshotDailyTotal> | SnapshotDailyTotal[],
): ReportSnapshot {
  const top = [...list]
    .sort((a, b) => num(b.spend) - num(a.spend))
    .slice(0, 6)
    .map((c) => ({
      ad_id: c.ad_id,
      ad_name: c.ad_name || c.ad_id,
      thumbnail_url: c.thumbnail_url ?? null,
      hook: c.hook ?? null,
      style: c.style ?? null,
      ad_type: c.ad_type ?? null,
      spend: Math.round(num(c.spend) * 100) / 100,
      roas: ratioOrNull(num(c.purchase_value), num(c.spend)),
      cpa: ratioOrNull(num(c.spend), num(c.purchases)),
    }));
  const series = (Array.isArray(dailyTotals) ? dailyTotals : [...dailyTotals.values()])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  return { version: REPORT_SNAPSHOT_VERSION, top_creatives: top, tag_mix: tagMix(list), chart_series: series };
}

/** A saved snapshot this code can read, or null for older reports. */
export function readReportSnapshot(value: unknown): ReportSnapshot | null {
  const s = value as ReportSnapshot | null;
  if (!s || typeof s !== "object" || s.version !== REPORT_SNAPSHOT_VERSION) return null;
  if (!Array.isArray(s.top_creatives) || !Array.isArray(s.tag_mix) || !Array.isArray(s.chart_series)) return null;
  return s;
}
