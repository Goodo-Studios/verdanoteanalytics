// Audit plan item 5.5: short Meta failures permanently marked ads "no thumbnail".
//
// discoverImageUrlWithReason returned no reason for errors, timeouts and expired
// tokens, so drain-media-queue wrote the permanent "no-thumbnail" marker for them;
// cache-creative-image used the reason-less version and wrote the marker even while
// Meta was rate-limiting. Every failure now carries a reason, and only a lookup that
// completed and found no image ("no-image") may write the marker.
//
//   deno test -A supabase/functions/_shared/media-discovery-reasons.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as md from "./media-discovery.ts";

type FakeResp = { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> };
const resp = (status: number, body: unknown): FakeResp => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
});

async function withFetch<T>(impl: (url: string) => Promise<FakeResp>, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((url: string) => impl(url)) as any;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const discover = () => md.discoverImageUrlWithReason("ad1", "act_1", "token", 1000);

Deno.test("an expired token is a lookup failure, not 'no image'", async () => {
  const out = await withFetch(
    () => Promise.resolve(resp(400, { error: { code: 190, message: "Error validating access token" } })),
    discover,
  );
  assertEquals(out.result, null);
  assertEquals(out.reason, "lookup-failed");
});

Deno.test("a Meta server error is a lookup failure", async () => {
  const out = await withFetch(() => Promise.resolve(resp(500, { error: { code: 1, message: "unknown" } })), discover);
  assertEquals(out.reason, "lookup-failed");
});

Deno.test("a timeout or network error is a lookup failure", async () => {
  const out = await withFetch(() => Promise.reject(new Error("timed out")), discover);
  assertEquals(out.reason, "lookup-failed");
});

Deno.test("a server error on a later strategy is a lookup failure, not 'no image'", async () => {
  const out = await withFetch((url) => {
    if (url.includes("?fields=creative")) return Promise.resolve(resp(200, { creative: { image_hash: "h1" } }));
    return Promise.resolve(resp(503, { error: { message: "service unavailable" } }));
  }, discover);
  assertEquals(out.result, null);
  assertEquals(out.reason, "lookup-failed");
});

Deno.test("a rate limit is still reported as throttled", async () => {
  const out = await withFetch(
    () => Promise.resolve(resp(400, { error: { code: 4, message: "Application request limit reached" } })),
    discover,
  );
  assertEquals(out.reason, "throttled");
});

Deno.test("a completed lookup with no image source reports 'no image'", async () => {
  const out = await withFetch((url) => {
    if (url.includes("?fields=creative")) return Promise.resolve(resp(200, { creative: { id: "c1" } }));
    return Promise.resolve(resp(404, { error: { message: "not found" } }));
  }, discover);
  assertEquals(out.result, null);
  assertEquals(out.reason, "no-image");
});

Deno.test("only 'no image' may write the permanent no-thumbnail marker", () => {
  assertEquals(md.shouldMarkNoThumbnail("no-image"), true);
  assertEquals(md.shouldMarkNoThumbnail("lookup-failed"), false);
  assertEquals(md.shouldMarkNoThumbnail("throttled"), false);
  assertEquals(md.shouldMarkNoThumbnail(undefined), false);
});

Deno.test("drain-media-queue and cache-creative-image gate the marker on the reason", async () => {
  const drain = await Deno.readTextFile(new URL("../drain-media-queue/index.ts", import.meta.url));
  const cache = await Deno.readTextFile(new URL("../cache-creative-image/index.ts", import.meta.url));
  assert(drain.includes("shouldMarkNoThumbnail("), "drain-media-queue checks the reason before writing the marker");
  assert(cache.includes("discoverImageUrlWithReason("), "cache-creative-image uses the reason-returning lookup");
  assert(cache.includes("shouldMarkNoThumbnail("), "cache-creative-image checks the reason before writing the marker");
});
