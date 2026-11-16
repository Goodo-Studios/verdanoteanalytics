// Reads behind the accounts name-mapping re-match: every untagged creative and every mapping
// for one account.
//
// Audit 7.3: both reads page through the shared fetchAllRows, which stops only on an empty
// page, so a server cap below the page size cannot end the read early. Both order by a key
// that is unique within the account (ad_id; unique_code, the upsert conflict key).
// deno-lint-ignore-file no-explicit-any
import { fetchAllRows } from "../_shared/paging.ts";

type Db = { from: (table: string) => any };

export type UntaggedCreative = { ad_id: string; unique_code: string | null };

/** Every untagged creative in the account. */
export function loadUntaggedCreatives(db: Db, accountId: string): Promise<UntaggedCreative[]> {
  return fetchAllRows<UntaggedCreative>((from, to) =>
    db
      .from("creatives")
      .select("ad_id, unique_code")
      .eq("account_id", accountId)
      .eq("tag_source", "untagged")
      .order("ad_id")
      .range(from, to)
  );
}

/** Every name mapping in the account, keyed by unique code. */
export async function loadMappingsByCode(db: Db, accountId: string): Promise<Map<string, Record<string, unknown>>> {
  const rows = await fetchAllRows<Record<string, any>>((from, to) =>
    db
      .from("name_mappings")
      .select("*")
      .eq("account_id", accountId)
      .order("unique_code")
      .range(from, to)
  );
  return new Map(rows.map((row) => [row.unique_code as string, row]));
}
