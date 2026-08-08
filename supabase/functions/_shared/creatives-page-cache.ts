// The `creatives` edge function's date-filtered branch re-scans and
// re-aggregates every creative_daily_metrics row for the account+range on
// every request — including every page turn, since pagination only slices
// the fully-computed result at the very end (see index.ts). Flipping from
// page 1 to page 2 re-pays that full aggregation cost even though nothing
// about the underlying data changed between clicks a few seconds apart.
//
// This module caches the pre-slice computed result (the full sorted array +
// total + aggregates) for a short TTL, keyed by every parameter that affects
// its contents — including tenant scope, so two tenants can never share a
// cached result. A cache hit skips straight to slicing the cached array for
// the requested page; a miss falls through to the existing computation.
//
// Scope: process-local (a plain Map). Supabase edge functions reuse warm
// instances, so this still cuts real repeat-request cost, but a cold start or
// a different warm instance won't see another instance's cache — acceptable
// given the TTL is already short enough that staleness is bounded either way.
// Callers MUST clear() the cache after any mutation that changes creative
// tags/data (see index.ts's PUT / bulk-untag / auto-tag handlers) so a retag
// can't be served back stale within the TTL window.

export interface CreativesCacheKeyParams {
  accountId: string | null;
  adType: string | null;
  person: string | null;
  style: string | null;
  hook: string | null;
  product: string | null;
  theme: string | null;
  tagSource: string | null;
  adStatus: string | null;
  delivery: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  search: string;
  /** null (unrestricted/staff) or the caller's linked-account ids — part of
   * the key so one tenant's cached page can never be served to another. */
  allowedIds: string[] | null;
}

/** Deterministic cache key — the same logical request always serializes the
 * same way regardless of `allowedIds` array order. */
export function makeCreativesCacheKey(params: CreativesCacheKeyParams): string {
  const sortedAllowedIds = params.allowedIds ? [...params.allowedIds].sort() : null;
  return JSON.stringify({
    accountId: params.accountId,
    adType: params.adType,
    person: params.person,
    style: params.style,
    hook: params.hook,
    product: params.product,
    theme: params.theme,
    tagSource: params.tagSource,
    adStatus: params.adStatus,
    delivery: params.delivery,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    search: params.search,
    allowedIds: sortedAllowedIds,
  });
}

export interface TtlCacheOptions {
  ttlMs: number;
  maxEntries: number;
}

/** Small TTL + size-bounded cache. `now` is an injectable parameter (rather
 * than reading `Date.now()` internally) so tests can control expiry and
 * eviction deterministically. */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();
  private opts: TtlCacheOptions;

  constructor(opts: TtlCacheOptions) {
    this.opts = opts;
  }

  get(key: string, now: number = Date.now()): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, now: number = Date.now()): void {
    // Evict the oldest entry first when at capacity — Map iterates in
    // insertion order, so the first key yielded is the oldest.
    if (this.store.size >= this.opts.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: now + this.opts.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
