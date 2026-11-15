import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FetchTooLargeError, fetchWithTimeout } from "./fetch-with-timeout.ts";

const noSleep = () => Promise.resolve();

function sequence(responses: Array<Response | Error>) {
  const calls: Array<RequestInit | undefined> = [];
  const impl = ((_url: string | URL, init?: RequestInit) => {
    calls.push(init);
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as typeof fetch;
  return { impl, calls };
}

Deno.test("returns a good response at once", async () => {
  const { impl, calls } = sequence([new Response("ok")]);
  const res = await fetchWithTimeout("http://x", {}, { fetchImpl: impl, sleep: noSleep });
  assertEquals(await res.text(), "ok");
  assertEquals(calls.length, 1);
});

Deno.test("passes an abort signal so a stalled call is bounded", async () => {
  const { impl, calls } = sequence([new Response("ok")]);
  await fetchWithTimeout("http://x", {}, { fetchImpl: impl, sleep: noSleep });
  assertEquals(calls[0]?.signal instanceof AbortSignal, true);
});

Deno.test("retries 429 and 5xx, then succeeds", async () => {
  const { impl, calls } = sequence([new Response("", { status: 429 }), new Response("", { status: 503 }), new Response("done")]);
  const res = await fetchWithTimeout("http://x", {}, { fetchImpl: impl, sleep: noSleep });
  assertEquals(await res.text(), "done");
  assertEquals(calls.length, 3);
});

Deno.test("does not retry a 4xx other than 429", async () => {
  const { impl, calls } = sequence([new Response("nope", { status: 404 })]);
  const res = await fetchWithTimeout("http://x", {}, { fetchImpl: impl, sleep: noSleep });
  assertEquals(res.status, 404);
  assertEquals(calls.length, 1);
});

Deno.test("returns the last retryable response when retries run out", async () => {
  const { impl, calls } = sequence([new Response("", { status: 500 }), new Response("", { status: 500 }), new Response("", { status: 502 })]);
  const res = await fetchWithTimeout("http://x", {}, { fetchImpl: impl, sleep: noSleep, retries: 2 });
  assertEquals(res.status, 502);
  assertEquals(calls.length, 3);
});

Deno.test("retries a network error and throws the last one when out of attempts", async () => {
  const { impl, calls } = sequence([new TypeError("net"), new TypeError("net"), new TypeError("net again")]);
  await assertRejects(() => fetchWithTimeout("http://x", {}, { fetchImpl: impl, sleep: noSleep, retries: 2 }), TypeError, "net again");
  assertEquals(calls.length, 3);
});

Deno.test("honors Retry-After, capped", async () => {
  const waits: number[] = [];
  const { impl } = sequence([
    new Response("", { status: 429, headers: { "retry-after": "2" } }),
    new Response("", { status: 429, headers: { "retry-after": "999" } }),
    new Response("ok"),
  ]);
  await fetchWithTimeout("http://x", {}, { fetchImpl: impl, sleep: (ms) => (waits.push(ms), Promise.resolve()), maxBackoffMs: 5000 });
  assertEquals(waits, [2000, 5000]);
});

Deno.test("a slow upstream times out", async () => {
  const impl = ((_u: string | URL, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)))) as typeof fetch;
  await assertRejects(() => fetchWithTimeout("http://x", {}, { fetchImpl: impl, sleep: noSleep, timeoutMs: 20, retries: 0 }));
});

Deno.test("maxBytes rejects a declared oversize body and an undeclared oversize stream", async () => {
  const declared = new Response("x".repeat(10), { headers: { "content-length": "999999" } });
  await assertRejects(
    () => fetchWithTimeout("http://x", {}, { fetchImpl: sequence([declared]).impl, maxBytes: 100 }),
    FetchTooLargeError,
  );
  const big = new Response("y".repeat(500));
  big.headers.delete("content-length");
  await assertRejects(
    () => fetchWithTimeout("http://x", {}, { fetchImpl: sequence([big]).impl, maxBytes: 100 }),
    FetchTooLargeError,
  );
});

Deno.test("maxBytes passes a small body through intact", async () => {
  const res = await fetchWithTimeout("http://x", {}, { fetchImpl: sequence([new Response("hello", { status: 201 })]).impl, maxBytes: 100 });
  assertEquals(res.status, 201);
  assertEquals(await res.text(), "hello");
});
