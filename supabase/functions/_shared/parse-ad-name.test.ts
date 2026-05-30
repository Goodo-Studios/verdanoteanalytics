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

Deno.test("duplicate dimension in convention -> first position wins, later token unknown", () => {
  // Misconfigured convention: ad_type declared at BOTH position 1 and 2.
  // The lower position (1) claims the dimension; position 2 is left unmapped so
  // its token surfaces in unknownSegments (dimension:null) instead of silently
  // overwriting tags.ad_type (last-write-wins).
  const dupConvention: NamingConvention = {
    ...convention,
    segments: [
      { position: 0, dimension: "unique_code", required: true },
      { position: 1, dimension: "ad_type", required: false },
      { position: 2, dimension: "ad_type", required: false },
    ],
  };
  const result = parseAdName("GS500_Video_Static", dupConvention);
  assertEquals(result.unique_code, "GS500");
  // First position (1, "Video") wins — NOT overwritten by position 2 ("Static").
  assertEquals(result.tags.ad_type, "Video");
  assertEquals(result.matchedSegments.length, 1);
  assertEquals(result.matchedSegments[0].position, 1);
  // The duplicate-dimension token at position 2 is unmapped -> unknown, dim null.
  assertEquals(result.unknownSegments.length, 1);
  assertEquals(result.unknownSegments[0], {
    position: 2,
    raw: "Static",
    dimension: null,
  });
});

// REGRESSION (act_1233881692132906): a per-account override with a pipe
// separator (" | ") and ONLY two declared segments (pos 0 -> unique_code,
// pos 5 -> ad_type) must still tag ad_type from position 5 of a 12-segment
// real ad name, leaving every other (undeclared) position as an unknown
// segment with dimension:null. This is the convention that restores the
// account's historical ad_type coverage after the US-005 backfill wiped it.
const pipeOverride: NamingConvention = {
  id: "test-act-override",
  account_id: "act_1233881692132906",
  scope: "override",
  separator: " | ",
  segments: [
    { position: 0, dimension: "unique_code", required: true },
    { position: 5, dimension: "ad_type", required: false },
  ],
  vocab: [
    { dimension: "ad_type", canonical: "Video", aliases: ["video", "VID"] },
    {
      dimension: "ad_type",
      canonical: "Image",
      aliases: ["image", "IMG", "Static", "Photo"],
    },
    { dimension: "ad_type", canonical: "Carousel", aliases: ["carousel"] },
  ],
};

Deno.test("pipe-separator override -> pos5 ad_type tags from 12-segment name", () => {
  const result = parseAdName(
    "GS900 | A | B | C | D | Video | F | G | H | I | J | K",
    pipeOverride,
  );
  // unique_code is always tokens[0] under the pipe separator.
  assertEquals(result.unique_code, "GS900");
  // Position 5 ("Video") resolves to the ad_type canonical.
  assertEquals(result.tags.ad_type, "Video");
  // No other dimension is declared, so they stay null.
  assertEquals(result.tags.person, null);
  assertEquals(result.tags.style, null);
  assertEquals(result.tags.product, null);
  assertEquals(result.tags.hook, null);
  assertEquals(result.tags.theme, null);
  // Exactly the ad_type position matched.
  assertEquals(result.matchedSegments.length, 1);
  assertEquals(result.matchedSegments[0].position, 5);
  assertEquals(result.matchedSegments[0].canonical, "Video");
  // The other 10 tokens (positions 1-4, 6-11) are undeclared -> unknown null.
  assertEquals(result.unknownSegments.length, 10);
  assertEquals(
    result.unknownSegments.every((s) => s.dimension === null),
    true,
  );
});

Deno.test("pipe-separator override -> Static alias maps to Image at pos5", () => {
  const result = parseAdName(
    "GS901 | A | B | C | D | Static | F | G | H | I | J | K",
    pipeOverride,
  );
  assertEquals(result.unique_code, "GS901");
  assertEquals(result.tags.ad_type, "Image");
});

Deno.test("pipe-separator override -> single-token name stays untagged", () => {
  const result = parseAdName("GS902", pipeOverride);
  assertEquals(result.unique_code, "GS902");
  assertEquals(result.tags.ad_type, null);
  assertEquals(result.matchedSegments.length, 0);
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
