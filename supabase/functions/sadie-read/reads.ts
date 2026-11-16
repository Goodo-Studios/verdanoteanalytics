// Reads behind the sadie-read summary, tags and media-stats endpoints.
// deno-lint-ignore-file no-explicit-any

type Db = { from: (table: string) => any };

export const SUMMARY_ALL_COLUMNS = "spend, roas, cpa, purchases, impressions";
export const SUMMARY_ONE_COLUMNS =
  "spend, roas, cpa, purchases, impressions, thumb_stop_rate, hold_rate, ad_status";
export const TAG_COLUMNS = "spend, roas, cpa, ctr, purchases, impressions, tag_source, ad_status";
export const MEDIA_COLUMNS = "ad_id, video_url, thumbnail_url, video_views, spend, impressions";

/** Every creative with impressions for one account (only tagged ones when `taggedOnly`). */
export async function loadAccountCreatives(
  db: Db,
  accountId: string,
  columns: string,
  taggedOnly = false,
): Promise<any[]> {
  let query = db.from("creatives").select(columns).eq("account_id", accountId).gt("impressions", 0);
  if (taggedOnly) query = query.neq("tag_source", "untagged");
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** Every creative with impressions, for one account or all of them, for media URL health. */
export async function loadMediaRows(db: Db, accountId: string | null): Promise<any[]> {
  let query = db.from("creatives").select(MEDIA_COLUMNS).gt("impressions", 0);
  if (accountId) query = query.eq("account_id", accountId);
  const { data, error } = await query.limit(50000);
  if (error) throw error;
  return data ?? [];
}
