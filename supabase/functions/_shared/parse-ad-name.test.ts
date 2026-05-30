// US-002: Unit tests for the single data-driven ad-name parser.
//
//   deno test supabase/functions/_shared/parse-ad-name.test.ts
//
// Builds a small in-memory NamingConvention fixture mirroring the US-001 seed
// (separator "_", 7 segments unique_code/ad_type/person/style/product/hook/theme,
// style canonical "UGCNative" alias "UGC", ad_type "Video", etc.) and exercises
// every acceptance criterion: clean parse, UGC alias, missing trailing segments,
// extra (>7) segments, mid-name unknown vocab, and empty/garbage input.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseAdName } from "./parse-ad-name.ts";
import type { NamingConvention } from "./naming-convention.ts";

const convention: NamingConvention = {
  id: "test-global",
  account_id: null,
  scope: "global",
  separator: "_",
  segments: [
    { position: 0, dimension: "unique_code", required: true },
    { position: 1, dimension: "ad_type", required: false },
    { position: 2, dimension: "person", required: false },
    { position: 3, dimension: "style", required: false },
    { position: 4, dimension: "product", required: false },
    { position: 5, dimension: "hook", required: false },
    { position: 6, dimension: "theme", required: false },
  ],
  vocab: [
    { dimension: "ad_type", canonical: "Video", aliases: ["Vid"] },
    { dimension: "ad_type", canonical: "Static", aliases: [] },
    { dimension: "person", canonical: "Creator", aliases: [] },
    { dimension: "style", canonical: "UGCNative", aliases: ["UGC"] },
    { dimension: "style", canonical: "Studio", aliases: [] },
    { dimension: "product", canonical: "Velora", aliases: [] },
    { dimension: "hook", canonical: "Confession", aliases: [] },
    { dimension: "theme", canonical: "POVTikTokFormat", aliases: [] },
  ],
};

Deno.test("clean 7-segment name -> all tags populated", () => {
  const result = parseAdName(
    "GS147105_Video_Creator_Studio_Velora_Confession_POVTikTokFormat",
    convention,
  );
  assertEquals(result.unique_code, "GS147105");
  assertEquals(result.tags, {
    ad_type: "Video",
    person: "Creator",
    style: "Studio",
    product: "Velora",
    hook: "Confession",
    theme: "POVTikTokFormat",
  });
  assertEquals(result.matchedSegments.length, 6);
  assertEquals(result.unknownSegments.length, 0);
});

Deno.test("UGC alias -> style=UGCNative (previously-failing example)", () => {
  const result = parseAdName(
    "GS147105_Video_Creator_UGC_Velora_Confession_POVTikTokFormat",
    convention,
  );
  assertEquals(result.unique_code, "GS147105");
  assertEquals(result.tags.style, "UGCNative");
  // Sanity: the rest still resolves and nothing is unknown.
  assertEquals(result.tags.ad_type, "Video");
  assertEquals(result.tags.theme, "POVTikTokFormat");
  assertEquals(result.unknownSegments.length, 0);
  // The matched style segment carries the raw alias + canonical.
  const styleMatch = result.matchedSegments.find((m) => m.dimension === "style");
  assertEquals(styleMatch?.raw, "UGC");
  assertEquals(styleMatch?.canonical, "UGCNative");
});

Deno.test("case-insensitive alias resolution", () => {
  const result = parseAdName("GS1_video_Creator_ugc", convention);
  assertEquals(result.tags.ad_type, "Video");
  assertEquals(result.tags.style, "UGCNative");
});

Deno.test("missing trailing segments -> those tags null, no throw", () => {
  const result = parseAdName("GS200_Video_Creator", convention);
  assertEquals(result.unique_code, "GS200");
  assertEquals(result.tags.ad_type, "Video");
  assertEquals(result.tags.person, "Creator");
  assertEquals(result.tags.style, null);
  assertEquals(result.tags.product, null);
  assertEquals(result.tags.hook, null);
  assertEquals(result.tags.theme, null);
  assertEquals(result.unknownSegments.length, 0);
});

Deno.test("extra segments (>7) -> extras land in unknownSegments, no throw", () => {
  const result = parseAdName(
    "GS300_Video_Creator_Studio_Velora_Confession_POVTikTokFormat_EXTRA1_EXTRA2",
    convention,
  );
  assertEquals(result.unique_code, "GS300");
  // All 6 tag positions still resolve.
  assertEquals(result.tags.theme, "POVTikTokFormat");
  // The two trailing tokens (positions 7,8) have no defined dimension.
  assertEquals(result.unknownSegments.length, 2);
  assertEquals(result.unknownSegments[0], {
    position: 7,
    raw: "EXTRA1",
    dimension: null,
  });
  assertEquals(result.unknownSegments[1], {
    position: 8,
    raw: "EXTRA2",
    dimension: null,
  });
});

Deno.test("unknown vocab value mid-name -> that one dimension null (partial)", () => {
  const result = parseAdName(
    "GS400_Video_Creator_NotAStyle_Velora_Confession_POVTikTokFormat",
    convention,
  );
  assertEquals(result.unique_code, "GS400");
  assertEquals(result.tags.ad_type, "Video");
  assertEquals(result.tags.person, "Creator");
  // The unresolved style stays null...
  assertEquals(result.tags.style, null);
  // ...but everything after it still populates.
  assertEquals(result.tags.product, "Velora");
  assertEquals(result.tags.hook, "Confession");
  assertEquals(result.tags.theme, "POVTikTokFormat");
  // The unresolved token is recorded as unknown against the style dimension.
  assertEquals(result.unknownSegments.length, 1);
  assertEquals(result.unknownSegments[0], {
    position: 3,
    raw: "NotAStyle",
    dimension: "style",
  });
});

Deno.test("empty string -> unique_code='' , tags all null, no throw", () => {
  const result = parseAdName("", convention);
  assertEquals(result.unique_code, "");
  assertEquals(result.tags, {
    ad_type: null,
    person: null,
    style: null,
    product: null,
    hook: null,
    theme: null,
  });
  assertEquals(result.matchedSegments.length, 0);
  // "".split("_") === [""], a single empty token at the unique_code position,
  // which is skipped (not pushed) -> no unknowns either.
  assertEquals(result.unknownSegments.length, 0);
});

Deno.test("garbage input -> unique_code = first token, no throw", () => {
  const result = parseAdName("!!!nonsense!!!", convention);
  assertEquals(result.unique_code, "!!!nonsense!!!");
  assertEquals(result.tags, {
    ad_type: null,
    person: null,
    style: null,
    product: null,
    hook: null,
    theme: null,
  });
});
