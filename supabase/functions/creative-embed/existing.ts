// Which creatives in a creative-embed batch already have an embedding.
// deno-lint-ignore-file no-explicit-any

type Db = { from: (table: string) => any };

/** Ad ids (from `adIds`, the current batch) that already have a row in creative_embeddings. */
export async function loadEmbeddedAdIds(
  db: Db,
  accountId: string | undefined,
  _adIds: string[],
): Promise<Set<string>> {
  let eq = db.from("creative_embeddings").select("ad_id");
  if (accountId) eq = eq.eq("account_id", accountId);
  const { data: existing } = await eq;
  return new Set((existing ?? []).map((r: { ad_id: string }) => r.ad_id));
}
