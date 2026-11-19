// Asset id to asset key lookup for cluster-creatives. The asset key is the primary exact anchor.
//
// Ids go out 100 at a time: each is 36 characters, and 500 of them made a request URL of about
// 19 KB, which the API gateway refuses. A failed lookup throws; ignoring it silently dropped
// asset anchors from groups.
// deno-lint-ignore-file no-explicit-any

export const ASSET_ID_CHUNK = 100;

export async function loadAssetKeys(db: any, assetIds: string[]): Promise<Map<string, string>> {
  const keys = new Map<string, string>();
  const unique = [...new Set(assetIds)];
  for (let i = 0; i < unique.length; i += ASSET_ID_CHUNK) {
    const chunk = unique.slice(i, i + ASSET_ID_CHUNK);
    const { data, error } = await db.from("media_assets").select("id, asset_key").in("id", chunk);
    if (error) throw new Error(`media_assets read: ${error.message ?? String(error)}`);
    for (const a of (data ?? []) as Array<{ id: string; asset_key: string }>) keys.set(a.id, a.asset_key);
  }
  return keys;
}
