// US-009: within-account media dedupe helpers.
//
// Deno edge tests are manual (not in CI vitest) per
// verdanote-deno-edge-tests-are-manual-not-in-ci-vitest. Run with:
//   deno test -A supabase/functions/_shared/media-discovery.test.ts
//
// These cover the two pure helpers that make creative-level dedupe work:
//   - computeContentHash: identical bytes → identical key (dedupe hit);
//     different bytes → different key (no false dedupe).
//   - assetStoragePath: account-scoped, asset-keyed path so the same creative in
//     two accounts never collides (tenant boundary) while the same creative in one
//     account maps to one shared path (within-account dedupe).

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assetStoragePath, computeContentHash } from "./media-discovery.ts";

const bytesOf = (s: string) => new TextEncoder().encode(s);

Deno.test("computeContentHash is a 64-char SHA-256 hex string", async () => {
  const hash = await computeContentHash(bytesOf("hello world"));
  assertEquals(hash.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(hash), true);
});

Deno.test("computeContentHash matches the known SHA-256 of 'abc'", async () => {
  // Well-known SHA-256("abc") vector — proves the digest is real SHA-256.
  const hash = await computeContentHash(bytesOf("abc"));
  assertEquals(
    hash,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

Deno.test("identical bytes hash identically (the dedupe key is stable)", async () => {
  // Two ads reusing the same creative download the identical bytes → same key →
  // the second is a dedupe hit (no second stored copy).
  const a = await computeContentHash(bytesOf("same-creative-bytes"));
  const b = await computeContentHash(bytesOf("same-creative-bytes"));
  assertEquals(a, b);
});

Deno.test("different bytes hash differently (no false dedupe)", async () => {
  const a = await computeContentHash(bytesOf("creative-one"));
  const b = await computeContentHash(bytesOf("creative-two"));
  assertNotEquals(a, b);
});

Deno.test("computeContentHash accepts an ArrayBuffer as well as Uint8Array", async () => {
  const u8 = bytesOf("buffer-vs-view");
  const fromView = await computeContentHash(u8);
  const fromBuffer = await computeContentHash(u8.buffer.slice(0));
  assertEquals(fromView, fromBuffer);
});

Deno.test("assetStoragePath is account-scoped and asset-keyed", () => {
  const path = assetStoragePath("act_123", "deadbeef", "jpg");
  assertEquals(path, "act_123/assets/deadbeef.jpg");
});

Deno.test("same asset in two accounts → distinct paths (tenant boundary preserved)", () => {
  const key = "deadbeefcafebabe";
  const inA = assetStoragePath("act_A", key, "mp4");
  const inB = assetStoragePath("act_B", key, "mp4");
  assertNotEquals(inA, inB);
  assertEquals(inA.startsWith("act_A/"), true);
  assertEquals(inB.startsWith("act_B/"), true);
});

Deno.test("same asset key in one account → one shared path (within-account dedupe)", () => {
  // Two ads reusing the same creative resolve to the identical stored path.
  const key = "abc123";
  assertEquals(
    assetStoragePath("act_1", key, "jpg"),
    assetStoragePath("act_1", key, "jpg"),
  );
});

Deno.test("assetStoragePath tolerates a leading dot in the extension", () => {
  assertEquals(assetStoragePath("act_1", "hash", ".png"), "act_1/assets/hash.png");
});
