// Short-TTL DB cache for the drain's expensive per-invocation Meta lookups.
//
// WHY: drain-media-queue self-chains a FRESH invocation per BATCH_SIZE ads, and each
// invocation rebuilds two Meta-heavy maps from scratch — the assigned-Page token map
// (GET /me/accounts) and the per-account video-library map (paginates
// GET /{account}/advideos, up to 50 pages). Draining a large backlog rebuilds those
// maps HUNDREDS of times, which is the dominant Meta app-level rate-limit ("#4")
// source that stalls the pipeline. These accessors let the whole self-chain reuse ONE
// build per key within a short TTL (backed by public.media_meta_cache, migration
// 20260718000001) instead of rebuilding every batch.
//
// The cache is a PURE OPTIMIZATION: every accessor swallows errors and treats a
// miss / absent table / malformed row as "no cache" → build fresh (byte-identical to
// the pre-cache behavior). Only a NON-EMPTY build is written, so a throttle-during-
// build (which returns an empty map) is never cached as if it were complete data.

// deno-lint-ignore no-explicit-any
type Supa = any;

// TTLs. Video-library CDN sources stay valid for hours, so a ~20m reuse window is
// safe (a stale source just fails the download → the ad NULLs + re-discovers, bounded
// by the queue). The assigned-Page set changes rarely, so its token map gets ~30m.
export const VIDEO_MAP_TTL_MS = 20 * 60_000;
export const PAGE_TOKEN_MAP_TTL_MS = 30 * 60_000;

// Cache keys (see migration 20260718000001).
export const PAGE_TOKEN_MAP_KEY = "pagetokenmap";
export const videoMapKey = (accountId: string): string => `videomap:${accountId}`;

/**
 * Read a cached string→string map if present AND unexpired. Returns null on a miss,
 * an expired row, an absent table, a malformed payload, or ANY error — the caller
 * then builds fresh. Never throws.
 */
export async function readCachedMap(
  supabase: Supa,
  key: string,
): Promise<Map<string, string> | null> {
  try {
    const { data, error } = await supabase
      .from("media_meta_cache")
      .select("payload, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (error || !data) return null;
    const exp = data.expires_at ? new Date(data.expires_at).getTime() : 0;
    if (!exp || exp <= Date.now()) return null; // expired / missing TTL → miss
    const payload = data.payload;
    if (!payload || typeof payload !== "object") return null;
    const map = new Map<string, string>();
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof v === "string") map.set(k, v);
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort write of a string→string map with a TTL. Swallows every error — the
 * cache must never break a drain. Never throws.
 */
export async function writeCachedMap(
  supabase: Supa,
  key: string,
  map: Map<string, string>,
  ttlMs: number,
): Promise<void> {
  try {
    await supabase.from("media_meta_cache").upsert(
      {
        cache_key: key,
        payload: Object.fromEntries(map),
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" },
    );
  } catch {
    // ignore — a failed cache write just means the next invocation rebuilds
  }
}

/**
 * get-or-build: return the cached map if fresh, else build it via `builder`, cache
 * the result (only when non-empty — an empty build usually signals a throttle and
 * must not be cached as complete data), and return it. Any cache-layer error falls
 * back to a plain build, so behavior is never worse than not caching at all.
 */
export async function getOrBuildCachedMap(
  supabase: Supa,
  key: string,
  ttlMs: number,
  builder: () => Promise<Map<string, string>>,
): Promise<Map<string, string>> {
  const cached = await readCachedMap(supabase, key);
  if (cached) return cached;
  const built = await builder();
  if (built.size > 0) await writeCachedMap(supabase, key, built, ttlMs);
  return built;
}
