// Small input guards for request parameters (audit plan item 2.4).

/** A whole number within [min, max]; anything missing or not a number gives the fallback. */
export function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** A number within [min, max]; anything missing or not a number gives the fallback. */
export function clampNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Sort columns sadie-read accepts for creatives (all selected, all numeric or dates). */
export const SADIE_CREATIVE_ORDER_COLUMNS = new Set([
  "spend", "roas", "cpa", "ctr", "cpm", "cpc", "impressions", "clicks", "purchases",
  "purchase_value", "video_views", "thumb_stop_rate", "hold_rate", "video_avg_play_time",
  "adds_to_cart", "cost_per_add_to_cart", "frequency", "created_at",
]);

export function sadieOrderColumn(raw: string | null): string | null {
  const col = raw ?? "spend";
  return SADIE_CREATIVE_ORDER_COLUMNS.has(col) ? col : null;
}

/** Apify run ids are 17 alphanumeric characters; allow a little room, nothing else. */
export function isApifyRunId(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9]{8,32}$/.test(raw);
}
