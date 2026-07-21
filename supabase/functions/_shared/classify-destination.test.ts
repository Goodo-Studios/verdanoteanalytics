// Deno tests for the WS2 destination classifier. Run: deno test classify-destination.test.ts
// (Deno edge tests are manual, not in CI vitest — per verdanote-deno-edge-tests-are-manual-not-in-ci-vitest.)
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyDestination, productNameFromTitle } from "./classify-destination.ts";

Deno.test("Shopify product page → product + humanized name, shared slug", () => {
  const c = classifyDestination("https://bearaby.com/products/the-cotton-napper");
  assertEquals(c.type, "product");
  assertEquals(c.productSlug, "the-cotton-napper");
  assertEquals(c.product, "The Cotton Napper");
});

Deno.test("nested collection/product path resolves to the product handle", () => {
  const c = classifyDestination("https://brand.com/collections/blankets/products/weighted-25lb");
  assertEquals(c.type, "product");
  assertEquals(c.productSlug, "weighted-25lb");
  assertEquals(c.product, "Weighted 25lb");
});

Deno.test("collection page → collection, product null", () => {
  const c = classifyDestination("https://bearaby.com/collections/weighted-blankets");
  assertEquals(c.type, "collection");
  assertEquals(c.productSlug, "weighted-blankets");
  assertEquals(c.product, null);
});

Deno.test("homepage (root path) → homepage, product null", () => {
  assertEquals(classifyDestination("https://bearaby.com").type, "homepage");
  assertEquals(classifyDestination("https://bearaby.com/").type, "homepage");
  assertEquals(classifyDestination("https://bearaby.com/").product, null);
});

Deno.test("lead-form host and lead-form path segment both classify as lead-form", () => {
  assertEquals(classifyDestination("https://form.typeform.com/to/abc123").type, "lead-form");
  assertEquals(classifyDestination("https://brand.com/pages/quiz").type, "lead-form");
  assertEquals(classifyDestination("https://brand.com/get-started").type, "lead-form");
});

Deno.test("blog / content page → other", () => {
  assertEquals(classifyDestination("https://brand.com/blogs/news/why-weighted").type, "other");
  assertEquals(classifyDestination("https://brand.com/about").type, "other");
});

Deno.test("amazon /dp/ and generic /product/ resolve to product", () => {
  assertEquals(classifyDestination("https://www.amazon.com/dp/B08XYZ").type, "product");
  assertEquals(classifyDestination("https://shop.com/product/cozy-throw").product, "Cozy Throw");
});

Deno.test("invalid / empty key → other, no throw", () => {
  assertEquals(classifyDestination("").type, "other");
  assertEquals(classifyDestination(null).type, "other");
  assertEquals(classifyDestination("not a url").type, "other");
});

Deno.test("productNameFromTitle strips brand suffix", () => {
  assertEquals(productNameFromTitle("The Cotton Napper | Bearaby"), "The Cotton Napper");
  assertEquals(productNameFromTitle("Weighted Blanket – Bearaby"), "Weighted Blanket");
  assertEquals(productNameFromTitle(""), null);
  assertEquals(productNameFromTitle(null), null);
});
