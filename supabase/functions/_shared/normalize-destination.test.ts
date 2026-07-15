// Deno tests for the F4 destination normalizer. Run: deno test normalize-destination.test.ts
// (Deno edge tests are manual, not in CI vitest — per verdanote-deno-edge-tests-are-manual-not-in-ci-vitest.)
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeDestinationUrl } from "./normalize-destination.ts";

Deno.test("utm-only differences collapse to one key", () => {
  const a = normalizeDestinationUrl(
    "https://hexclad.com/products/pan?utm_source=fb&utm_medium=paid&utm_campaign=x",
  );
  const b = normalizeDestinationUrl(
    "https://hexclad.com/products/pan?utm_source=ig&utm_campaign=y",
  );
  assertEquals(a, "https://hexclad.com/products/pan");
  assertEquals(a, b);
});

Deno.test("click-id params are stripped", () => {
  assertEquals(
    normalizeDestinationUrl("https://hexclad.com/sale?fbclid=abc123&gclid=z"),
    "https://hexclad.com/sale",
  );
});

Deno.test("host lowercased, scheme forced to https, default port dropped", () => {
  assertEquals(
    normalizeDestinationUrl("HTTP://WWW.HexClad.com/Sale"),
    "https://www.hexclad.com/Sale",
  );
});

Deno.test("trailing slash normalized but root preserved", () => {
  assertEquals(
    normalizeDestinationUrl("https://hexclad.com/products/pan/"),
    "https://hexclad.com/products/pan",
  );
  assertEquals(normalizeDestinationUrl("https://hexclad.com/"), "https://hexclad.com/");
});

Deno.test("meaningful query params preserved and sorted; fragment dropped", () => {
  assertEquals(
    normalizeDestinationUrl("https://hexclad.com/shop?variant=12&color=black#reviews&utm_source=fb"),
    "https://hexclad.com/shop?color=black&variant=12",
  );
});

Deno.test("bare host gets https scheme", () => {
  assertEquals(normalizeDestinationUrl("hexclad.com/pan"), "https://hexclad.com/pan");
});

Deno.test("empty / null / invalid / non-http returns null", () => {
  assertEquals(normalizeDestinationUrl(""), null);
  assertEquals(normalizeDestinationUrl("   "), null);
  assertEquals(normalizeDestinationUrl(null), null);
  assertEquals(normalizeDestinationUrl(undefined), null);
  assertEquals(normalizeDestinationUrl("mailto:hi@hexclad.com"), null);
  assertEquals(normalizeDestinationUrl("javascript:alert(1)"), null);
});
