// Paged creatives reads behind the public API's /metrics fallback, /summary and tag-status
// endpoints.
//
// Audit 7.4: these loops paged by offset with no order, so Postgres could return rows in a
// different arrangement on each page, skipping some and repeating others, and a failed page
// ended the loop and returned partial totals as if complete. Each read now goes through the
// shared fetchAllRows, ordered by ad_id (unique), and a failed page throws.
// deno-lint-ignore-file no-explicit-any
import { fetchAllRows } from "../_shared/paging.ts";

type Db = { from: (table: string) => any };

/** Creative rows for the /metrics totals (fallback when the RPC is missing). */
export function loadMetricRows(db: Db, accountId: string | null): Promise<any[]> {
  return fetchAllRows<any>((from, to) => {
    let q = db.from("creatives").select("spend, impressions, clicks, purchases, purchase_value");
    if (accountId) q = q.eq("account_id", accountId);
    return q.order("ad_id").range(from, to);
  });
}

/** Creative rows for one account's /summary totals. */
export function loadSummaryRows(db: Db, accountId: string): Promise<any[]> {
  return fetchAllRows<any>((from, to) =>
    db
      .from("creatives")
      .select("spend, roas, cpa, ctr, impressions, clicks, purchases, purchase_value, ad_status")
      .eq("account_id", accountId)
      .order("ad_id")
      .range(from, to)
  );
}

/** Every creative's tag_source for one account. */
export function loadTagSources(db: Db, accountId: string): Promise<{ tag_source: string | null }[]> {
  return fetchAllRows<{ tag_source: string | null }>((from, to) =>
    db
      .from("creatives")
      .select("tag_source")
      .eq("account_id", accountId)
      .order("ad_id")
      .range(from, to)
  );
}
