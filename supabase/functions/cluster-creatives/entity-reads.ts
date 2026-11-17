// Existing-group reads and retirement for cluster-creatives (audit plan item 7.3 follow-up).
//
// The existing-group read was a plain select capped at 1,000 rows by PostgREST, so groups
// past that were never matched again or retired. It now pages through fetchAllRows in id
// order. Retirement used to skip a failed delete and only lower its count; it now throws.

import { fetchAllRows, type PageResult } from "../_shared/paging.ts";

export type ExistingEntityRow = {
  id: string;
  centroid: unknown;
  asset_keys: unknown;
  meta_video_ids: unknown;
  meta_image_hashes: unknown;
};

const RETIRE_CHUNK = 200;

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any };

export function loadExistingEntityRows(db: Db, accountId: string): Promise<ExistingEntityRow[]> {
  return fetchAllRows<ExistingEntityRow>((from, to) =>
    db
      .from("creative_clusters")
      .select("id, centroid, asset_keys, meta_video_ids, meta_image_hashes")
      .eq("account_id", accountId)
      .order("id")
      .range(from, to) as PromiseLike<PageResult<ExistingEntityRow>>
  );
}

/** Deletes the given groups in chunks. Returns how many were deleted; throws on the first failure. */
export async function retireEntities(db: Db, ids: string[]): Promise<number> {
  let retired = 0;
  for (let i = 0; i < ids.length; i += RETIRE_CHUNK) {
    const chunk = ids.slice(i, i + RETIRE_CHUNK);
    const { error } = await db.from("creative_clusters").delete().in("id", chunk);
    if (error) throw new Error(`retire stale entities: ${error.message}`);
    retired += chunk.length;
  }
  return retired;
}
