// Weekly digest numbers (audit 6.1). Pure functions, no network.
import { computeBlendedMetrics, ratioOrNull } from "../_shared/metric-math.ts";

/** An ad must spend at least this much in the week to be the digest's top creative. */
export const DIGEST_TOP_MIN_SPEND = 50;

export interface DateWindow {
  start: string;
  end: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysBefore = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n));

/** This week = the last 7 full days (today excluded); last week = the 7 days before that. */
export function digestWindows(now: Date): { thisWeek: DateWindow; lastWeek: DateWindow } {
  return {
    thisWeek: { start: isoDay(daysBefore(now, 7)), end: isoDay(daysBefore(now, 1)) },
    lastWeek: { start: isoDay(daysBefore(now, 14)), end: isoDay(daysBefore(now, 8)) },
  };
}

export interface DigestRow {
  ad_id?: string;
  spend?: number | string | null;
  purchase_value?: number | string | null;
}

/** Spend and ROAS for a week of daily rows. ROAS = sum(purchase_value) / sum(spend), null with no spend. */
export function summarizeWeek(rows: DigestRow[]): { spend: number; roas: number | null } {
  const m = computeBlendedMetrics(rows);
  return { spend: m.spend, roas: m.roas };
}

/** Best ROAS this week among ads that spent at least `minSpend`, or null. */
export function topCreativeOfWeek(
  rows: DigestRow[],
  minSpend = DIGEST_TOP_MIN_SPEND,
): { ad_id: string; spend: number; roas: number } | null {
  const byAd = new Map<string, { spend: number; value: number }>();
  for (const r of rows) {
    if (!r.ad_id) continue;
    const a = byAd.get(r.ad_id) ?? { spend: 0, value: 0 };
    a.spend += Number(r.spend) || 0;
    a.value += Number(r.purchase_value) || 0;
    byAd.set(r.ad_id, a);
  }
  let best: { ad_id: string; spend: number; roas: number } | null = null;
  for (const [ad_id, a] of byAd) {
    if (a.spend < minSpend) continue;
    const roas = a.value / a.spend;
    if (!best || roas > best.roas || (roas === best.roas && a.spend > best.spend)) {
      best = { ad_id, spend: a.spend, roas };
    }
  }
  return best;
}

/** Percent change from `prev` to `curr`, null when either is missing or prev is 0. */
export function percentChange(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null) return null;
  const r = ratioOrNull(curr - prev, prev, 100);
  return r;
}
