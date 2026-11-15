// Logic for the public portfolio endpoint: paged reads with a stable order, account totals over ALL
// rows, and the spend floor for the featured creatives.

import { computeBlendedMetrics, type MetricRowLike } from "./metric-math.ts";

/** A creative must have spent at least this much to be featured on the public page. */
export const PORTFOLIO_MIN_TOP_SPEND = 100;
export const PORTFOLIO_TOP_COUNT = 6;
export const PORTFOLIO_PAGE_SIZE = 1000;

export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Read every row through offset pages. The caller's query MUST carry a unique ORDER BY, otherwise
 * pages can skip or repeat rows. Throws on a page error rather than returning a partial set.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PORTFOLIO_PAGE_SIZE,
  maxPages = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

/** Totals over all rows. ROAS is sum(purchase_value) / sum(spend); 0 when nothing was spent. */
export function summarizePortfolio(rows: MetricRowLike[]): {
  totalSpend: number;
  totalPurchases: number;
  blendedRoas: number;
} {
  const m = computeBlendedMetrics(rows);
  return { totalSpend: m.spend, totalPurchases: m.purchases, blendedRoas: m.roas ?? 0 };
}
