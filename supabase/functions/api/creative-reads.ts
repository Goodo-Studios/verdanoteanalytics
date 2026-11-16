// Paged creatives reads behind the public API's /metrics fallback, /summary and tag-status
// endpoints.
// deno-lint-ignore-file no-explicit-any

type Db = { from: (table: string) => any };

/** Creative rows for the /metrics totals (fallback when the RPC is missing). */
export async function loadMetricRows(db: Db, accountId: string | null): Promise<any[]> {
  let allRows: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let q = db
      .from("creatives")
      .select("spend, impressions, clicks, purchases, purchase_value")
      .range(from, from + pageSize - 1);
    if (accountId) q = q.eq("account_id", accountId);
    const { data: page, error: pageErr } = await q;
    if (pageErr || !page || page.length === 0) break;
    allRows = allRows.concat(page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

/** Creative rows for one account's /summary totals. */
export async function loadSummaryRows(db: Db, accountId: string): Promise<any[]> {
  let allRows: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data: page, error: pageErr } = await db
      .from("creatives")
      .select("spend, roas, cpa, ctr, impressions, clicks, purchases, purchase_value, ad_status")
      .eq("account_id", accountId)
      .range(from, from + pageSize - 1);
    if (pageErr || !page || page.length === 0) break;
    allRows = allRows.concat(page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

/** Every creative's tag_source for one account. */
export async function loadTagSources(db: Db, accountId: string): Promise<{ tag_source: string | null }[]> {
  const rows: { tag_source: string | null }[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data: page, error: pageErr } = await db
      .from("creatives")
      .select("tag_source")
      .eq("account_id", accountId)
      .range(from, from + pageSize - 1);
    if (pageErr) throw pageErr;
    if (!page || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}
