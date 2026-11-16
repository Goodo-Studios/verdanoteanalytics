// Reads behind the accounts name-mapping re-match: every untagged creative and every mapping
// for one account.
// deno-lint-ignore-file no-explicit-any

type Db = { from: (table: string) => any };

export type UntaggedCreative = { ad_id: string; unique_code: string | null };

/** Every untagged creative in the account. */
export async function loadUntaggedCreatives(db: Db, accountId: string): Promise<UntaggedCreative[]> {
  const untagged: UntaggedCreative[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("creatives")
      .select("ad_id, unique_code")
      .eq("account_id", accountId)
      .eq("tag_source", "untagged")
      .order("ad_id")
      .range(from, from + 999);
    if (error) throw error;
    untagged.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return untagged;
}

/** Every name mapping in the account, keyed by unique code. */
export async function loadMappingsByCode(db: Db, accountId: string): Promise<Map<string, Record<string, unknown>>> {
  const mappingByCode = new Map<string, Record<string, unknown>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("name_mappings")
      .select("*")
      .eq("account_id", accountId)
      .order("unique_code")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data || []) mappingByCode.set(row.unique_code, row);
    if (!data || data.length < 1000) break;
  }
  return mappingByCode;
}
