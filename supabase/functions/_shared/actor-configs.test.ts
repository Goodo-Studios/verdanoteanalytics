// Regression tests for ACTOR_CONFIGS.facebook_ad.buildInput URL enrichment.
//
//   deno test supabase/functions/_shared/actor-configs.test.ts
//
// Bug history: bare ?id= URLs from Meta's Ad Library "View ad details" page
// omit active_status / ad_type / country. Without enrichment, the actor returns
// no_items + "Empty or private data for provided input". A prior default of
// country=US silently dropped non-US ads even when the ID was valid. country=ALL
// matches Meta's own UI behaviour for global single-ad lookup.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ACTOR_CONFIGS } from "./actor-configs.ts";

const fb = ACTOR_CONFIGS.facebook_ad;

function enrichedUrl(input: string): string {
  const out = fb.buildInput(input) as { startUrls: Array<{ url: string }> };
  return out.startUrls[0].url;
}

Deno.test("facebook_ad.buildInput: bare ?id= URL is enriched with active_status=all, ad_type=all, country=ALL", () => {
  const u = new URL(enrichedUrl("https://www.facebook.com/ads/library/?id=1498351558582364"));
  assertEquals(u.searchParams.get("id"), "1498351558582364");
  assertEquals(u.searchParams.get("active_status"), "all");
  assertEquals(u.searchParams.get("ad_type"), "all");
  assertEquals(u.searchParams.get("country"), "ALL");
});

Deno.test("facebook_ad.buildInput: country defaults to ALL (not US) so non-US ads are not silently dropped", () => {
  const u = new URL(enrichedUrl("https://www.facebook.com/ads/library/?id=999"));
  assertEquals(u.searchParams.get("country"), "ALL", "country=US would have filtered out any ad outside the US Ad Library");
});

Deno.test("facebook_ad.buildInput: already-enriched URL (active_status present) passes through unchanged", () => {
  const original =
    "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=GB&id=123&search_type=keyword_unordered";
  assertEquals(enrichedUrl(original), original);
});

Deno.test("facebook_ad.buildInput: URL without an id param is passed through unchanged (e.g. keyword search URLs)", () => {
  const original =
    "https://www.facebook.com/ads/library/?search_type=keyword_unordered&q=hello";
  assertEquals(enrichedUrl(original), original);
});

Deno.test("facebook_ad.buildInput: malformed URL returns the original string verbatim", () => {
  assertEquals(enrichedUrl("not a url"), "not a url");
});

Deno.test("facebook_ad.buildInput: shape is { startUrls: [{ url }] } (actor requires objects, not strings)", () => {
  const out = fb.buildInput("https://www.facebook.com/ads/library/?id=1") as {
    startUrls: Array<{ url: string }>;
  };
  assertEquals(Array.isArray(out.startUrls), true);
  assertEquals(out.startUrls.length, 1);
  assertEquals(typeof out.startUrls[0].url, "string");
});
