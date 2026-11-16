// Reads behind the sadie-read summary, tags and media-stats endpoints.
//
// Audit 7.3: a plain select returns at most 1,000 rows (PostgREST max_rows), and
// `.limit(50000)` does not raise that cap, so every read pages through fetchAllRows,
// ordered by ad_id (unique) so no page skips or repeats a row.
// deno-lint-ignore-file no-explicit-any
import { fetchAllRows } from "../_shared/paging.ts";

type Db = { from: (table: string) => any };

export const SUMMARY_ALL_COLUMNS = "spend, roas, cpa, purchases, impressions";
export const SUMMARY_ONE_COLUMNS =
  "spend, roas, cpa, purchases, impressions, thumb_stop_rate, hold_rate, ad_status";
export const TAG_COLUMNS = "spend, roas, cpa, ctr, purchases, impressions, tag_source, ad_status";
export const MEDIA_COLUMNS = "ad_id, video_url, thumbnail_url, video_views, spend, impressions";

/** Every creative with impressions for one account (only tagged ones when `taggedOnly`). */
export function loadAccountCreatives(
  db: Db,
  accountId: string,
  columns: string,
  taggedOnly = false,
): Promise<any[]> {
  return fetchAllRows<any>((from, to) => {
    let query = db.from("creatives").select(columns).eq("account_id", accountId).gt("impressions", 0);
    if (taggedOnly) query = query.neq("tag_source", "untagged");
    return query.order("ad_id", { ascending: true }).range(from, to);
  });
}

/** Every creative with impressions, for one account or all of them, for media URL health. */
export function loadMediaRows(db: Db, accountId: string | null): Promise<any[]> {
  return fetchAllRows<any>((from, to) => {
    let query = db.from("creatives").select(MEDIA_COLUMNS).gt("impressions", 0);
    if (accountId) query = query.eq("account_id", accountId);
    return query.order("ad_id", { ascending: true }).range(from, to);
  });
}
