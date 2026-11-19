// Saving cluster-creatives groups (creative_clusters rows) in chunks.
//
// The function used to upsert each group with its own database call, one after another. An
// account with about 1,000 groups (Bearaby) took 130 seconds, and Cattasaurus (5,208 running ads)
// was stopped by the server at 135 seconds (HTTP 546, resource limit). Rows now go out 50 at a
// time, in order. Each row carries a 1,536-number centre, so a chunk of 50 stays near 1 MB.
// deno-lint-ignore-file no-explicit-any

export const ENTITY_UPSERT_CHUNK = 50;

export async function saveEntities(db: any, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += ENTITY_UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + ENTITY_UPSERT_CHUNK);
    const { error } = await db.from("creative_clusters").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`entity upsert: ${error.message ?? String(error)}`);
  }
}
