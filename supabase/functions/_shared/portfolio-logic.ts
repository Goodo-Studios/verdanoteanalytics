// Logic for the public portfolio endpoint: paged reads with a stable order, account totals over ALL
// rows, and the spend floor for the featured creatives.

import { computeBlendedMetrics, type MetricRowLike } from "./metric-math.ts";

/** A creative must have spent at least this much to be featured on the public page. */
export const PORTFOLIO_MIN_TOP_SPEND = 100;
export const PORTFOLIO_TOP_COUNT = 6;
export const PORTFOLIO_PAGE_SIZE = 1000;

// Paging lives in one shared helper (audit 7.3); re-exported here for existing callers.
export { fetchAllRows, type PageResult } from "./paging.ts";

/** Totals over all rows. ROAS is sum(purchase_value) / sum(spend); 0 when nothing was spent. */
export function summarizePortfolio(rows: MetricRowLike[]): {
  totalSpend: number;
  totalPurchases: number;
  blendedRoas: number;
} {
  const m = computeBlendedMetrics(rows);
  return { totalSpend: m.spend, totalPurchases: m.purchases, blendedRoas: m.roas ?? 0 };
}
