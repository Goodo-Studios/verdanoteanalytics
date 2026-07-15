// Deno tests for the F4 destination normalizer. Run: deno test normalize-destination.test.ts
// (Deno edge tests are manual, not in CI vitest — per verdanote-deno-edge-tests-are-manual-not-in-ci-vitest.)
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractDestinationLink, normalizeDestinationUrl } from "./normalize-destination.ts";

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

// ─── extractDestinationLink (shared by backfill + sync forward-fill) ───────────

Deno.test("extractDestinationLink: link_data.link wins first", () => {
  assertEquals(
    extractDestinationLink({
      object_story_spec: { link_data: { link: "https://shop.com/a" } },
    }),
    "https://shop.com/a",
  );
});

Deno.test("extractDestinationLink: video CTA link", () => {
  assertEquals(
    extractDestinationLink({
      object_story_spec: {
        video_data: { call_to_action: { value: { link: "https://shop.com/vid" } } },
      },
    }),
    "https://shop.com/vid",
  );
});

Deno.test("extractDestinationLink: template_data.link", () => {
  assertEquals(
    extractDestinationLink({
      object_story_spec: { template_data: { link: "https://shop.com/tmpl" } },
    }),
    "https://shop.com/tmpl",
  );
});

Deno.test("extractDestinationLink: first carousel child link", () => {
  assertEquals(
    extractDestinationLink({
      object_story_spec: {
        link_data: {
          child_attachments: [{ name: "no link" }, { link: "https://shop.com/child" }],
        },
      },
    }),
    "https://shop.com/child",
  );
});

Deno.test("extractDestinationLink: asset_feed_spec link_urls", () => {
  assertEquals(
    extractDestinationLink({
      asset_feed_spec: { link_urls: [{ website_url: "https://shop.com/feed" }] },
    }),
    "https://shop.com/feed",
  );
});

Deno.test("extractDestinationLink: null / unknown shapes are total (never throw)", () => {
  assertEquals(extractDestinationLink(null), null);
  assertEquals(extractDestinationLink(undefined), null);
  assertEquals(extractDestinationLink({}), null);
  assertEquals(extractDestinationLink({ object_story_spec: {} }), null);
  assertEquals(extractDestinationLink({ object_story_spec: { link_data: {} } }), null);
  assertEquals(extractDestinationLink({ asset_feed_spec: { link_urls: [] } }), null);
});
