/**
 * What a report export prints (audit plan item 6.2).
 *
 * Reports generated after this change carry a snapshot of their top creatives, tag mix and
 * chart series. Older reports have none: their top creatives come from the saved
 * top_performers (top 10 by spend at generation time), and the tag mix is null so the print
 * layout labels it as not saved instead of filling it with today's numbers.
 */
import {
  readReportSnapshot,
  type SnapshotDailyTotal,
  type TagMixRow,
} from "../../supabase/functions/_shared/report-snapshot.ts";

export interface PrintCreative {
  ad_id: string;
  ad_name: string;
  thumbnail_url?: string | null;
  roas: number | null;
  spend: number;
  cpa?: number | null;
}

export interface ReportPrintData {
  topCreatives: PrintCreative[];
  tagRows: TagMixRow[] | null;
  chartRows: SnapshotDailyTotal[] | null;
}

interface ReportLike {
  snapshot?: unknown;
  top_performers?: string | null;
}

export function reportPrintData(report: ReportLike): ReportPrintData {
  const snap = readReportSnapshot(report.snapshot);
  if (snap) {
    return { topCreatives: snap.top_creatives, tagRows: snap.tag_mix, chartRows: snap.chart_series };
  }
  let saved: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(report.top_performers || "[]");
    if (Array.isArray(parsed)) saved = parsed;
  } catch {
    saved = [];
  }
  const topCreatives = saved.slice(0, 6).map((p) => ({
    ad_id: String(p.ad_id ?? p.ad_name ?? ""),
    ad_name: String(p.ad_name ?? p.ad_id ?? ""),
    thumbnail_url: (p.thumbnail_url as string | undefined) ?? null,
    roas: p.roas === null || p.roas === undefined ? null : Number(p.roas),
    spend: Number(p.spend) || 0,
    cpa: p.cpa === null || p.cpa === undefined ? null : Number(p.cpa),
  }));
  return { topCreatives, tagRows: null, chartRows: null };
}
