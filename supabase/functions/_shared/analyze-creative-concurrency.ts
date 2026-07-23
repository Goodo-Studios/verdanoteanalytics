// analyze-creative — PURE, dependency-free concurrency + backoff helpers.
//
// The analyze-creative drain used to process a claimed batch strictly
// one-creative-at-a-time (a sequential `for await` loop) and only self-chained a
// fresh invocation AFTER the whole batch finished — so the effective throughput
// of the entire pipeline was ONE creative at a time. These helpers let the drain
// process a bounded number of creatives CONCURRENTLY within a single invocation
// (the biggest win for the static-heavy backlog) while staying safe:
//
//   • runPool — a bounded worker-pool scheduler. Runs at most `concurrency`
//     workers at once over `items`, stops dispatching NEW work the moment
//     `shouldStop()` returns true (wall-clock budget or spend cap hit), and
//     reports exactly which item indexes were processed vs never-started so the
//     caller can release the un-started (still-'analyzing') rows back to
//     'pending'. In-flight workers always finish their current item.
//
//   • backoffDelayMs — exponential backoff with full jitter for retrying an
//     OpenRouter / Groq 429 (or 5xx) so the higher concurrency can never turn a
//     transient rate-limit into a failure storm.
//
// Both are pure (no Deno / fetch / Supabase / timers) so they unit-test under
// `deno test` exactly like analyze-creative-logic.ts. The scheduler is generic
// over an async worker, so the tests drive it with deterministic fake workers.

/**
 * Error thrown by {@link withTimeout} when the wrapped promise does not settle
 * within its deadline. Distinct type so callers can tell a per-ITEM deadline
 * (recycle the row to 'pending' and retry it) apart from a genuine failure
 * (mark the row 'failed').
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`timeout after ${ms}ms: ${label}`);
    this.name = "TimeoutError";
  }
}

/**
 * Race a promise against a hard wall-clock deadline.
 *
 * Resolves/rejects with the underlying promise if it settles first; otherwise
 * rejects with a {@link TimeoutError} at `ms`. The timer is always cleared so a
 * settled promise never leaves a dangling handle. This is the per-ITEM backstop
 * in the analyze-creative drain: a single creative whose provider chain runs
 * long can no longer pin a worker (and push the whole invocation past the edge
 * runtime's wall limit, which would orphan every in-flight 'analyzing' row) —
 * it is abandoned at the deadline and its row recycled to 'pending'. Note this
 * does NOT abort the underlying work; it only stops the caller WAITING on it
 * (per-call AbortController timeouts bound the underlying fetches separately).
 *
 * Pure (only setTimeout/clearTimeout) so it unit-tests deterministically.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ── Invocation wall-clock safety ─────────────────────────────────────────────
// The Supabase edge runtime kills an invocation that exceeds its resource/wall
// limit (HTTP 546). A killed invocation orphans EVERY in-flight 'analyzing' row
// (they never reach 'done'/'failed'), which the 4-min reclaim then re-claims —
// so a run that overruns turns into an endless claim→kill→reclaim loop with zero
// throughput (exactly the post-#88 stall: the richer prompt made each item
// heavier, so a full CONCURRENCY×BATCH pass of the video-heavy backlog tipped the
// isolate over its limit). The drain must therefore GUARANTEE a run returns with
// margin: it stops DISPATCHING new items at `timeBudgetMs`, but an item pulled
// just before that can still run up to the per-ITEM `itemTimeoutMs`, after which a
// fixed closing tail runs (per-item embeds + the closing count queries + the
// durable self-chain enqueue). The worst-case wall is their sum; keep it a safe
// fraction under the edge wall. Pure so it unit-tests + can gate the config.
export const EDGE_WALL_MS = 150_000;
/** Empirical upper bound on the per-invocation closing tail that runs AFTER the
 * concurrent pass: the last item's 2 embeds + spend RPC, the ~7 closing count
 * queries, and the pg_net self-chain enqueue. */
export const CLOSING_OVERHEAD_MS = 20_000;

/**
 * Worst-case wall-clock (ms) for one drain invocation: an item dispatched right
 * at the dispatch budget can still run up to the per-item deadline, then the fixed
 * closing tail runs. Pure.
 */
export function worstCaseInvocationMs(
  timeBudgetMs: number,
  itemTimeoutMs: number,
  closingMs: number = CLOSING_OVERHEAD_MS,
): number {
  return timeBudgetMs + itemTimeoutMs + closingMs;
}

/**
 * Is the drain's wall-clock config safe against the edge runtime limit?
 *
 * True when the worst-case invocation wall stays under `safetyFraction` of the
 * edge wall (default 90%), leaving headroom for scheduling jitter. This is the
 * regression guard for the post-#88 stall: bumping the dispatch budget or the
 * per-item deadline back up without accounting for the closing tail would reopen
 * the 546-kill orphan loop. Pure.
 */
export function isWallConfigSafe(
  timeBudgetMs: number,
  itemTimeoutMs: number,
  opts: { wallMs?: number; closingMs?: number; safetyFraction?: number } = {},
): boolean {
  const wall = opts.wallMs ?? EDGE_WALL_MS;
  const frac = opts.safetyFraction ?? 0.9;
  return worstCaseInvocationMs(timeBudgetMs, itemTimeoutMs, opts.closingMs) <= wall * frac;
}

export interface PoolResult {
  /** Item indexes whose worker ran to completion (analyzed OR handled-as-failed). */
  processed: number[];
  /** Item indexes never started because `shouldStop()` fired first. */
  skipped: number[];
  /** Peak number of workers observed in flight (for tests / diagnostics). */
  maxInFlight: number;
}

/**
 * Bounded worker-pool over `items`.
 *
 * Spawns `min(concurrency, items.length)` workers that pull from a shared cursor
 * (safe: cursor increments run synchronously between awaits on the single JS
 * event loop, so two workers never claim the same index). Before pulling the next
 * item a worker checks `shouldStop()`; once it returns true no further items are
 * dispatched, though workers already mid-item run to completion. The `worker`
 * callback is expected to handle its OWN errors (the drain marks a failed
 * creative 'failed' in-band); a throw from `worker` rejects the pool.
 *
 * Deterministic and I/O-free — all timing/effects live in the injected `worker`.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<PoolResult> {
  const processed: number[] = [];
  const n = items.length;
  let cursor = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  const runner = async (): Promise<void> => {
    while (true) {
      if (shouldStop()) return;
      const i = cursor++;
      if (i >= n) return;
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      try {
        await worker(items[i], i);
        processed.push(i);
      } finally {
        inFlight--;
      }
    }
  };

  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, n));
  await Promise.all(Array.from({ length: workerCount }, () => runner()));

  processed.sort((a, b) => a - b);
  const done = new Set(processed);
  const skipped: number[] = [];
  for (let i = 0; i < n; i++) if (!done.has(i)) skipped.push(i);
  return { processed, skipped, maxInFlight };
}

/**
 * Exponential backoff (full jitter) for a rate-limited (429) or transient (5xx)
 * OpenRouter / Groq response.
 *
 * `attempt` is 1-based (the delay BEFORE the Nth retry). Delay grows
 * `base * 2^(attempt-1)`, capped at `capMs`, then jittered to a random point in
 * `[50%, 100%]` of that ceiling to de-correlate concurrent retriers (thundering
 * herd). `rng` is injectable so the value is deterministic under test.
 */
export function backoffDelayMs(
  attempt: number,
  opts: { baseMs?: number; capMs?: number; rng?: () => number } = {},
): number {
  const base = opts.baseMs ?? 500;
  const cap = opts.capMs ?? 8000;
  const rng = opts.rng ?? Math.random;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.5 + rng() * 0.5));
}

/**
 * Is a non-OK provider response worth retrying?
 *
 * Retriable = a 429 (rate limit) or a 5xx (transient), UNLESS the provider
 * explicitly says not to via `x-should-retry: false`. Groq returns exactly that
 * header on a hard DAILY-quota 429 (audio-seconds-per-day exhausted, resets in
 * hours) — retrying is pointless and, worse, the old code slept the multi-minute
 * `retry-after` it carried, which blew the ~150s edge-function wall limit and
 * killed the whole invocation (and its self-chain). Honoring the header lets such
 * a response fail FAST so the caller can fall back to another provider.
 */
export function isRetriableResponse(
  status: number,
  shouldRetryHeader: string | null,
): boolean {
  if (shouldRetryHeader !== null && shouldRetryHeader.trim().toLowerCase() === "false") {
    return false;
  }
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Resolve the wait (ms) before the next retry.
 *
 * Honors a provider `Retry-After` (SECONDS) when present and positive, but
 * HARD-CAPS it at `capMs` (default 10s). This cap is the load-bearing safety
 * fix: Groq's daily-quota 429 carries `retry-after: 144`, and sleeping the raw
 * 144_000ms exceeded the edge runtime's ~150s idle limit — the invocation was
 * killed before it could return or fire its self-chain, so the drain stalled.
 * When there is no usable header, falls back to jittered exponential backoff
 * (also capped). `attempt` is 1-based.
 */
export function retryWaitMs(
  retryAfterSec: number | null,
  attempt: number,
  opts: { capMs?: number; baseMs?: number; rng?: () => number } = {},
): number {
  const cap = opts.capMs ?? 10_000;
  if (retryAfterSec !== null && Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(Math.round(retryAfterSec * 1000), cap);
  }
  return Math.min(backoffDelayMs(attempt, { baseMs: opts.baseMs, capMs: cap, rng: opts.rng }), cap);
}
