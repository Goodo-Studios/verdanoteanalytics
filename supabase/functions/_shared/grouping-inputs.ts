// Inputs for creative grouping (cluster-creatives), audit plan item 7.3.
//
// Matthew's first decision (2026-11-16) was to group each account's newest 1,000 running ads,
// because complete linkage over one account (up to about 5,800 running ads) needs an m by m
// matrix and is roughly cubic. His second decision (2026-11-18, "option B") groups every
// running ad: read the account in batches, group each batch on its own, then merge the batches
// (cluster-creatives/batched-grouping.ts).
//
// This file reads one batch. Ads come newest first, with ad_id breaking ties, so batches never
// overlap while nothing changes; the caller drops an ad it has already seen if new ads arrive
// mid-run. Embeddings are read for exactly the batch's ads, by ad id in groups of 200. The
// original code read the whole account's embeddings in one unpaged select, which stopped at
// 1,000 rows in no order.
// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Ads grouped together in one pass. Small enough that its distance matrix stays cheap. */
export const GROUPING_BATCH = 500;
/** Safety ceiling for one account. The largest has about 5,800 running ads. */
export const GROUPING_MAX_ADS = 10000;
const PAGE = 1000;
const ID_BATCH = 200;

export interface GroupingInputs {
  /** One batch of the account's running ads, newest first. */
  creatives: Record<string, unknown>[];
  /** Embedding rows keyed by ad_id, for the ads above that have one. */
  embeddings: Map<string, Record<string, unknown>>;
}

export async function loadGroupingInputs(
  db: any, accountId: string, creativeColumns: string, size: number = GROUPING_BATCH, offset = 0,
): Promise<GroupingInputs> {
  const creatives: Record<string, unknown>[] = [];
  for (let from = 0; from < size; from += PAGE) {
    const to = Math.min(from + PAGE, size) - 1;
    const { data, error } = await db
      .from("creatives")
      .select(creativeColumns)
      .eq("account_id", accountId)
      // Live diversity signal: currently running ads only.
      .eq("ad_status", "ACTIVE")
      // Newest first; ad_id breaks ties so pages never overlap.
      .order("created_time", { ascending: false, nullsFirst: false })
      .order("ad_id", { ascending: true })
      .range(offset + from, offset + to);
    if (error) throw new Error(`creatives read: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    creatives.push(...rows);
    if (rows.length < to - from + 1) break;
  }

  const embeddings = new Map<string, Record<string, unknown>>();
  const ids = creatives.map((c) => String(c.ad_id));
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const chunk = ids.slice(i, i + ID_BATCH);
    const { data, error } = await db
      .from("creative_embeddings")
      .select("ad_id, embedding, visual_embedding, script_embedding")
      .in("ad_id", chunk);
    if (error) throw new Error(`embeddings read: ${error.message}`);
    for (const row of (data ?? []) as Record<string, unknown>[]) embeddings.set(String(row.ad_id), row);
  }

  return { creatives, embeddings };
}
