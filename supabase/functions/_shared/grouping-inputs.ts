// Inputs for creative grouping (cluster-creatives), audit plan item 7.3.
//
// Matthew's decision (2026-11-16): group each account's newest 1,000 running ads, nightly.
// Grouping every running ad needs a batched rebuild (accounts run up to about 5,000 active ads,
// and most pairs score as similar), so the cap keeps one run inside the edge function limits.
// Embeddings are read for exactly the chosen ads, by ad id in batches of 200. The old code read
// the whole account's embeddings in one unpaged select, which stopped at 1,000 rows in no order.
// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */

export const GROUPING_CAP = 1000;
const PAGE = 1000;
const ID_BATCH = 200;

export interface GroupingInputs {
  /** The account's newest running ads, at most `cap`, newest first. */
  creatives: Record<string, unknown>[];
  /** Embedding rows keyed by ad_id, for the ads above that have one. */
  embeddings: Map<string, Record<string, unknown>>;
}

export async function loadGroupingInputs(
  db: any, accountId: string, creativeColumns: string, cap: number = GROUPING_CAP,
): Promise<GroupingInputs> {
  const creatives: Record<string, unknown>[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const to = Math.min(from + PAGE, cap) - 1;
    const { data, error } = await db
      .from("creatives")
      .select(creativeColumns)
      .eq("account_id", accountId)
      // Live diversity signal: currently running ads only.
      .eq("ad_status", "ACTIVE")
      // Newest first; ad_id breaks ties so pages never overlap.
      .order("created_time", { ascending: false, nullsFirst: false })
      .order("ad_id", { ascending: true })
      .range(from, to);
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
