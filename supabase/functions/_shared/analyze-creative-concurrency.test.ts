// analyze-creative — concurrency + backoff helper tests.
//
// Deno edge tests are manual (not in CI vitest) per
// verdanote-deno-edge-tests-are-manual-not-in-ci-vitest. Run with:
//   deno test -A supabase/functions/_shared/analyze-creative-concurrency.test.ts
//
// Covers the bounded worker-pool scheduler (concurrency bound, no double-dispatch,
// stop-signal release accounting, in-flight completion) and the jittered backoff.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  backoffDelayMs,
  isRetriableResponse,
  retryWaitMs,
  runPool,
  TimeoutError,
  withTimeout,
} from "./analyze-creative-concurrency.ts";

const tick = () => new Promise((r) => setTimeout(r, 1));
const after = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

Deno.test("runPool: processes every item exactly once, in-order accounting", async () => {
  const seen: number[] = [];
  const { processed, skipped, maxInFlight } = await runPool(
    [10, 20, 30, 40, 50],
    2,
    async (item) => {
      await tick();
      seen.push(item);
    },
  );
  assertEquals(processed, [0, 1, 2, 3, 4]);
  assertEquals(skipped, []);
  assertEquals(seen.sort((a, b) => a - b), [10, 20, 30, 40, 50]);
  assert(maxInFlight <= 2, `maxInFlight ${maxInFlight} must not exceed concurrency 2`);
});

Deno.test("runPool: never exceeds the concurrency bound", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  const { maxInFlight } = await runPool(items, 4, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await tick();
    inFlight--;
  });
  assert(peak <= 4, `observed peak ${peak} exceeded 4`);
  assertEquals(maxInFlight, peak);
});

Deno.test("runPool: no item is dispatched twice (shared cursor safety)", async () => {
  const counts = new Map<number, number>();
  const items = Array.from({ length: 50 }, (_, i) => i);
  await runPool(items, 8, async (item) => {
    counts.set(item, (counts.get(item) ?? 0) + 1);
    await tick();
  });
  assertEquals(counts.size, 50);
  for (const [, c] of counts) assertEquals(c, 1);
});

Deno.test("runPool: shouldStop halts NEW dispatch; skipped are released", async () => {
  const processedItems: number[] = [];
  let calls = 0;
  // Stop after the first 3 items have been pulled (before the rest start).
  const { processed, skipped } = await runPool(
    Array.from({ length: 10 }, (_, i) => i),
    1, // serial so the stop point is deterministic
    async (item) => {
      calls++;
      processedItems.push(item);
      await tick();
    },
    () => calls >= 3,
  );
  assertEquals(processed, [0, 1, 2]);
  assertEquals(skipped, [3, 4, 5, 6, 7, 8, 9]);
  assertEquals(processedItems, [0, 1, 2]);
});

Deno.test("runPool: in-flight workers finish even after stop fires", async () => {
  let done = 0;
  let stop = false;
  const { processed, skipped } = await runPool(
    Array.from({ length: 6 }, (_, i) => i),
    3,
    async () => {
      await tick();
      done++;
      if (done >= 3) stop = true; // trip stop once the first wave completes
    },
    () => stop,
  );
  // The first wave of 3 always completes; nothing is left half-done.
  assert(processed.length >= 3, `expected >=3 processed, got ${processed.length}`);
  assertEquals(processed.length + skipped.length, 6);
  // Every index is accounted for exactly once across processed+skipped.
  assertEquals([...processed, ...skipped].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
});

Deno.test("runPool: empty batch is a no-op", async () => {
  const { processed, skipped, maxInFlight } = await runPool([], 5, async () => {});
  assertEquals(processed, []);
  assertEquals(skipped, []);
  assertEquals(maxInFlight, 0);
});

Deno.test("runPool: concurrency larger than batch clamps to batch size", async () => {
  let peak = 0;
  let inFlight = 0;
  const { processed } = await runPool([1, 2, 3], 10, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await tick();
    inFlight--;
  });
  assertEquals(processed.length, 3);
  assert(peak <= 3, `peak ${peak} should clamp to batch size 3`);
});

Deno.test("withTimeout: resolves with the value when it settles in time", async () => {
  const v = await withTimeout(after(1, "ok"), 50, "fast");
  assertEquals(v, "ok");
});

Deno.test("withTimeout: rejects with TimeoutError when the deadline passes first", async () => {
  let err: unknown;
  try {
    await withTimeout(after(50, "late"), 5, "slow-item");
  } catch (e) {
    err = e;
  }
  assert(err instanceof TimeoutError, "expected a TimeoutError");
  assert((err as Error).message.includes("slow-item"), "message carries the label");
});

Deno.test("withTimeout: propagates the underlying rejection (not a timeout)", async () => {
  let err: unknown;
  try {
    await withTimeout(Promise.reject(new Error("boom")), 50, "x");
  } catch (e) {
    err = e;
  }
  assert(err instanceof Error);
  assert(!(err instanceof TimeoutError), "a real error must not be masked as a timeout");
  assertEquals((err as Error).message, "boom");
});

Deno.test("backoffDelayMs: grows exponentially and caps", () => {
  // rng=1 → top of the jitter band (100% of the exponential ceiling).
  const rng = () => 1;
  assertEquals(backoffDelayMs(1, { baseMs: 500, capMs: 8000, rng }), 500);
  assertEquals(backoffDelayMs(2, { baseMs: 500, capMs: 8000, rng }), 1000);
  assertEquals(backoffDelayMs(3, { baseMs: 500, capMs: 8000, rng }), 2000);
  assertEquals(backoffDelayMs(4, { baseMs: 500, capMs: 8000, rng }), 4000);
  assertEquals(backoffDelayMs(5, { baseMs: 500, capMs: 8000, rng }), 8000);
  assertEquals(backoffDelayMs(6, { baseMs: 500, capMs: 8000, rng }), 8000); // capped
});

Deno.test("backoffDelayMs: jitter floor is 50% of the ceiling", () => {
  const lo = backoffDelayMs(3, { baseMs: 500, capMs: 8000, rng: () => 0 });
  const hi = backoffDelayMs(3, { baseMs: 500, capMs: 8000, rng: () => 1 });
  assertEquals(hi, 2000);
  assertEquals(lo, 1000); // 50% floor
  assert(lo < hi);
});

Deno.test("backoffDelayMs: attempt<=1 never negative-shifts the exponent", () => {
  const v = backoffDelayMs(0, { baseMs: 500, capMs: 8000, rng: () => 1 });
  assertEquals(v, 500); // 2^max(0,-1)=2^0
});

Deno.test("isRetriableResponse: 429 and 5xx are retriable, others are not", () => {
  assert(isRetriableResponse(429, null));
  assert(isRetriableResponse(500, null));
  assert(isRetriableResponse(503, null));
  assert(!isRetriableResponse(400, null));
  assert(!isRetriableResponse(413, null)); // too-large → not retriable
  assert(!isRetriableResponse(404, null));
});

Deno.test("isRetriableResponse: x-should-retry:false wins even on a 429", () => {
  // Groq's hard daily-quota 429 carries this header — must NOT retry.
  assert(!isRetriableResponse(429, "false"));
  assert(!isRetriableResponse(429, "False"));
  assert(!isRetriableResponse(429, " FALSE "));
  assert(!isRetriableResponse(503, "false"));
  // Any other value (or absent) leaves the status-based decision intact.
  assert(isRetriableResponse(429, "true"));
  assert(isRetriableResponse(429, ""));
});

Deno.test("retryWaitMs: honors Retry-After (seconds) but HARD-CAPS it", () => {
  // 2s header, well under the cap → honored verbatim.
  assertEquals(retryWaitMs(2, 1, { capMs: 10_000 }), 2000);
  // Groq's 144s daily-quota Retry-After → capped, NOT slept literally.
  assertEquals(retryWaitMs(144, 1, { capMs: 10_000 }), 10_000);
  // Exactly at the cap.
  assertEquals(retryWaitMs(10, 1, { capMs: 10_000 }), 10_000);
});

Deno.test("retryWaitMs: no/invalid header falls back to capped exponential backoff", () => {
  const rng = () => 1; // top of jitter band
  assertEquals(retryWaitMs(null, 1, { baseMs: 500, capMs: 10_000, rng }), 500);
  assertEquals(retryWaitMs(0, 2, { baseMs: 500, capMs: 10_000, rng }), 1000);
  assertEquals(retryWaitMs(NaN, 3, { baseMs: 500, capMs: 10_000, rng }), 2000);
  // Backoff ceiling also respects the cap.
  assertEquals(retryWaitMs(null, 10, { baseMs: 500, capMs: 4000, rng }), 4000);
});
