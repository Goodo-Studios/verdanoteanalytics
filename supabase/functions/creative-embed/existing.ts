// Which creatives in a creative-embed batch already have an embedding.
//
// Audit 7.3: this used to read the whole account's creative_embeddings in one select, which
// PostgREST caps at 1,000 rows. On an account with more embeddings every ad past the first
// 1,000 looked new and was paid for again on each run. It now asks only about the ids in the
// current batch (at most 2,000), in chunks small enough for the request URL, and fails loudly
// on a read error instead of treating every ad as new.
// deno-lint-ignore-file no-explicit-any

type Db = { from: (table: string) => any };

export const LOOKUP_CHUNK = 200;

/** Ad ids (from `adIds`, the current batch) that already have a row in creative_embeddings. */
export async function loadEmbeddedAdIds(
  db: Db,
  accountId: string | undefined,
  adIds: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < adIds.length; i += LOOKUP_CHUNK) {
    const chunk = adIds.slice(i, i + LOOKUP_CHUNK);
    let q = db.from("creative_embeddings").select("ad_id").in("ad_id", chunk);
    if (accountId) q = q.eq("account_id", accountId);
    const { data, error } = await q;
    if (error) throw new Error(`creative_embeddings lookup failed: ${error.message}`);
    for (const r of (data ?? []) as { ad_id: string }[]) found.add(r.ad_id);
  }
  return found;
}
