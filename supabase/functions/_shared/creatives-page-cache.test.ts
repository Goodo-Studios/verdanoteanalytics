// Regression tests for the `creatives` edge function's page-turn cache.
//
//   deno test -A supabase/functions/_shared/creatives-page-cache.test.ts
//
// Covers the bug this module fixes (every page turn re-aggregates the whole
// account from scratch) and the two ways a cache could go wrong here:
//   • cross-tenant leakage — two callers with different `allowedIds` must
//     never share a cached result, even with identical filters.
//   • serving back stale tags after a mutation — callers must clear() the
//     cache after any tag-changing write.

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { makeCreativesCacheKey, TtlCache, type CreativesCacheKeyParams } from "./creatives-page-cache.ts";

function baseParams(overrides: Partial<CreativesCacheKeyParams> = {}): CreativesCacheKeyParams {
  return {
    accountId: "acct_1",
    adType: null,
    person: null,
    style: null,
    hook: null,
    product: null,
    theme: null,
    tagSource: null,
    adStatus: null,
    delivery: null,
    dateFrom: "2026-07-01",
    dateTo: "2026-07-14",
    search: "",
    allowedIds: null,
    ...overrides,
  };
}

Deno.test("makeCreativesCacheKey: identical params produce identical keys", () => {
  assertEquals(makeCreativesCacheKey(baseParams()), makeCreativesCacheKey(baseParams()));
});

Deno.test("makeCreativesCacheKey: allowedIds order doesn't change the key", () => {
  const a = makeCreativesCacheKey(baseParams({ allowedIds: ["acct_2", "acct_1"] }));
  const b = makeCreativesCacheKey(baseParams({ allowedIds: ["acct_1", "acct_2"] }));
  assertEquals(a, b);
});

Deno.test("makeCreativesCacheKey: different allowedIds (tenant scope) never collide", () => {
  const a = makeCreativesCacheKey(baseParams({ allowedIds: ["acct_1"] }));
  const b = makeCreativesCacheKey(baseParams({ allowedIds: ["acct_2"] }));
  assertNotEquals(a, b);
});

Deno.test("makeCreativesCacheKey: unrestricted (null) vs restricted (empty array) are distinct", () => {
  const unrestricted = makeCreativesCacheKey(baseParams({ allowedIds: null }));
  const restrictedNone = makeCreativesCacheKey(baseParams({ allowedIds: [] }));
  assertNotEquals(unrestricted, restrictedNone);
});

Deno.test("makeCreativesCacheKey: a changed filter changes the key", () => {
  const a = makeCreativesCacheKey(baseParams({ adType: "Video" }));
  const b = makeCreativesCacheKey(baseParams({ adType: "Static" }));
  assertNotEquals(a, b);
});

Deno.test("TtlCache: a fresh entry is returned before it expires", () => {
  const cache = new TtlCache<number>({ ttlMs: 1000, maxEntries: 10 });
  cache.set("k", 42, /* now */ 0);
  assertEquals(cache.get("k", /* now */ 500), 42);
});

Deno.test("TtlCache: an entry is gone once its TTL has elapsed", () => {
  const cache = new TtlCache<number>({ ttlMs: 1000, maxEntries: 10 });
  cache.set("k", 42, /* now */ 0);
  assertEquals(cache.get("k", /* now */ 1000), undefined);
  // and it should have been evicted, not just hidden
  assertEquals(cache.size, 0);
});

Deno.test("TtlCache: distinct keys (e.g. page-1 vs page-2 request) don't collide", () => {
  const cache = new TtlCache<string>({ ttlMs: 1000, maxEntries: 10 });
  cache.set("account-A|2026-07-01..14", "resultA", 0);
  cache.set("account-B|2026-07-01..14", "resultB", 0);
  assertEquals(cache.get("account-A|2026-07-01..14", 0), "resultA");
  assertEquals(cache.get("account-B|2026-07-01..14", 0), "resultB");
});

Deno.test("TtlCache: evicts the oldest entry once at capacity", () => {
  const cache = new TtlCache<number>({ ttlMs: 60_000, maxEntries: 2 });
  cache.set("a", 1, 0);
  cache.set("b", 2, 1);
  cache.set("c", 3, 2); // over capacity — "a" (oldest) should be evicted
  assertEquals(cache.get("a", 3), undefined);
  assertEquals(cache.get("b", 3), 2);
  assertEquals(cache.get("c", 3), 3);
  assertEquals(cache.size, 2);
});

Deno.test("TtlCache: re-setting an existing key refreshes it without evicting anything", () => {
  const cache = new TtlCache<number>({ ttlMs: 60_000, maxEntries: 2 });
  cache.set("a", 1, 0);
  cache.set("b", 2, 1);
  cache.set("a", 99, 2); // update, not a new entry — must not trigger eviction
  assertEquals(cache.size, 2);
  assertEquals(cache.get("a", 2), 99);
  assertEquals(cache.get("b", 2), 2);
});

Deno.test("TtlCache: clear() empties the cache (used after any tag-changing mutation)", () => {
  const cache = new TtlCache<number>({ ttlMs: 60_000, maxEntries: 10 });
  cache.set("a", 1, 0);
  cache.set("b", 2, 0);
  cache.clear();
  assertEquals(cache.size, 0);
  assertEquals(cache.get("a", 0), undefined);
});
