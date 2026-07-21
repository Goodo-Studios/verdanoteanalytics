// Tests for the short-TTL Meta-lookup cache (media-map-cache.ts) that breaks the
// drain's #4 rate-limit spiral. Proves, WITHOUT any live network / DB:
//   * get-or-build: a miss builds + caches; a fresh hit reuses (builder NOT re-run);
//     an expired row rebuilds; an EMPTY build is never cached (throttle protection).
//   * read/write round-trip + graceful degradation (absent table / error → miss).
//
// Run: deno test -A supabase/functions/_shared/media-map-cache.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getOrBuildCachedMap,
  readCachedMap,
  videoMapKey,
  writeCachedMap,
} from "./media-map-cache.ts";

// ── In-memory media_meta_cache stand-in ──────────────────────────────────────
// Mirrors exactly the calls the accessors make: select("…").eq("cache_key",k)
// .maybeSingle() and upsert({…}, {onConflict}).
function makeCacheDb(opts?: { failOn?: "read" | "write" }) {
  const rows: Record<string, { payload: unknown; expires_at: string }> = {};
  const supabase = {
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (table !== "media_meta_cache") throw new Error(`unexpected table ${table}`);
      const filters: Record<string, string> = {};
      // deno-lint-ignore no-explicit-any
      const b: any = {};
      b.select = () => b;
      b.eq = (col: string, val: string) => { filters[col] = val; return b; };
      b.maybeSingle = () => {
        if (opts?.failOn === "read") return Promise.resolve({ data: null, error: { message: "boom" } });
        return Promise.resolve({ data: rows[filters.cache_key] ?? null, error: null });
      };
      // deno-lint-ignore no-explicit-any
      b.upsert = (payload: any) => {
        if (opts?.failOn === "write") return Promise.reject(new Error("write boom"));
        rows[payload.cache_key] = { payload: payload.payload, expires_at: payload.expires_at };
        return Promise.resolve({ data: null, error: null });
      };
      return b;
    },
    _rows: rows,
  };
  return supabase;
}

Deno.test("getOrBuildCachedMap: a MISS builds, caches, and returns the built map", async () => {
  const db = makeCacheDb();
  let builds = 0;
  const build = () => { builds++; return Promise.resolve(new Map([["a", "1"], ["b", "2"]])); };

  const map = await getOrBuildCachedMap(db, "k", 60_000, build);
  assertEquals(map.get("a"), "1");
  assertEquals(builds, 1);
  assert(db._rows["k"], "a non-empty build must be written to the cache");
});

Deno.test("getOrBuildCachedMap: a fresh HIT reuses the cache — the builder is NOT re-run", async () => {
  const db = makeCacheDb();
  let builds = 0;
  const build = () => { builds++; return Promise.resolve(new Map([["v", "src"]])); };

  await getOrBuildCachedMap(db, "k", 60_000, build); // build #1 (miss)
  const second = await getOrBuildCachedMap(db, "k", 60_000, build); // should hit cache
  assertEquals(builds, 1, "second call must be served from cache, not rebuilt");
  assertEquals(second.get("v"), "src");
});

Deno.test("getOrBuildCachedMap: an EXPIRED row is a miss and rebuilds", async () => {
  const db = makeCacheDb();
  // Pre-seed an already-expired row.
  await writeCachedMap(db, "k", new Map([["old", "1"]]), -1_000);
  let builds = 0;
  const build = () => { builds++; return Promise.resolve(new Map([["new", "2"]])); };

  const map = await getOrBuildCachedMap(db, "k", 60_000, build);
  assertEquals(builds, 1, "expired cache must trigger a rebuild");
  assertEquals(map.get("new"), "2");
});

Deno.test("getOrBuildCachedMap: an EMPTY build is NOT cached (throttle protection)", async () => {
  const db = makeCacheDb();
  let builds = 0;
  const build = () => { builds++; return Promise.resolve(new Map<string, string>()); };

  await getOrBuildCachedMap(db, "k", 60_000, build); // empty → must not cache
  assert(!db._rows["k"], "an empty build (likely a throttle) must never be cached");
  await getOrBuildCachedMap(db, "k", 60_000, build); // still a miss → rebuild
  assertEquals(builds, 2, "an empty build is re-attempted next time, never suppressed");
});

Deno.test("readCachedMap: absent row → null; round-trips a written map", async () => {
  const db = makeCacheDb();
  assertEquals(await readCachedMap(db, videoMapKey("act_x")), null);

  await writeCachedMap(db, videoMapKey("act_x"), new Map([["vid1", "https://cdn/1.mp4"]]), 60_000);
  const got = await readCachedMap(db, videoMapKey("act_x"));
  assertEquals(got?.get("vid1"), "https://cdn/1.mp4");
});

Deno.test("cache is a pure optimization: a read error degrades to a plain build (never throws)", async () => {
  const db = makeCacheDb({ failOn: "read" });
  let builds = 0;
  const build = () => { builds++; return Promise.resolve(new Map([["a", "1"]])); };
  const map = await getOrBuildCachedMap(db, "k", 60_000, build);
  assertEquals(map.get("a"), "1", "a cache read failure must fall back to building");
  assertEquals(builds, 1);
});

Deno.test("cache is a pure optimization: a write error is swallowed (build still returned)", async () => {
  const db = makeCacheDb({ failOn: "write" });
  let builds = 0;
  const build = () => { builds++; return Promise.resolve(new Map([["a", "1"]])); };
  const map = await getOrBuildCachedMap(db, "k", 60_000, build);
  assertEquals(map.get("a"), "1", "a cache write failure must not break the caller");
  assertEquals(builds, 1);
});
