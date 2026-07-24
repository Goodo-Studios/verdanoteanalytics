// deno test supabase/functions/_shared/image-media-type.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveImageMediaType, sniffImageMediaType } from "./image-media-type.ts";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

Deno.test("sniff: recognizes each supported format", () => {
  assertEquals(sniffImageMediaType(png), "image/png");
  assertEquals(sniffImageMediaType(jpeg), "image/jpeg");
  assertEquals(sniffImageMediaType(gif), "image/gif");
  assertEquals(sniffImageMediaType(webp), "image/webp");
});

Deno.test("sniff: returns null for unrecognized or too-short bytes", () => {
  assertEquals(sniffImageMediaType(new Uint8Array([0x00, 0x01, 0x02, 0x03])), null);
  assertEquals(sniffImageMediaType(new Uint8Array([0xff])), null);
});

// The actual bug: a PNG served with Content-Type image/jpeg. Bytes must win.
Deno.test("resolve: sniffed bytes override a wrong header (the reported bug)", () => {
  assertEquals(resolveImageMediaType(png, "image/jpeg"), "image/png");
  assertEquals(resolveImageMediaType(jpeg, "image/png"), "image/jpeg");
});

Deno.test("resolve: falls back to header when bytes are unrecognized", () => {
  const unknown = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
  assertEquals(resolveImageMediaType(unknown, "image/webp"), "image/webp");
  assertEquals(resolveImageMediaType(unknown, "image/jpg"), "image/jpeg");
});

Deno.test("resolve: defaults to image/jpeg when neither bytes nor header are usable", () => {
  const unknown = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
  assertEquals(resolveImageMediaType(unknown, null), "image/jpeg");
  assertEquals(resolveImageMediaType(unknown, "application/octet-stream"), "image/jpeg");
});
