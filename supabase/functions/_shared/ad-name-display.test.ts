//   deno test supabase/functions/_shared/ad-name-display.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parsedDisplayTags, splitCamelCase, toDimensionDisplay, toDisplayName } from "./ad-name-display.ts";
import { parseAdName } from "./parse-ad-name.ts";
import { goodoConvention } from "./goodo-convention.fixture.ts";

Deno.test("splitCamelCase: contract examples", () => {
  assertEquals(splitCamelCase("TiredBy3pm"), "Tired By 3pm");
  assertEquals(splitCamelCase("WeightedBlanket"), "Weighted Blanket");
  assertEquals(splitCamelCase("UGCNative"), "UGC Native");
  assertEquals(splitCamelCase("NoTalent"), "No Talent");
  assertEquals(splitCamelCase("StudioClean"), "Studio Clean");
  assertEquals(splitCamelCase("TextForward"), "Text Forward");
});

Deno.test("splitCamelCase: acronyms, digits and single words", () => {
  assertEquals(splitCamelCase("GIF"), "GIF");
  assertEquals(splitCamelCase("Static"), "Static");
  assertEquals(splitCamelCase("Top10Tips"), "Top 10 Tips");
  assertEquals(splitCamelCase("MP4"), "MP4");
  assertEquals(splitCamelCase("3PM"), "3PM");
});

Deno.test("splitCamelCase: non-ASCII letters are not word breaks (Crème-safe)", () => {
  assertEquals(splitCamelCase("Crème-safe"), "Crème-safe");
  assertEquals(splitCamelCase("CrèmeBrûlée"), "Crème Brûlée");
  assertEquals(splitCamelCase("ÉcoFriendly"), "Éco Friendly");
});

Deno.test("splitCamelCase is idempotent on display forms", () => {
  for (const v of ["Tired By 3pm", "UGC Native", "No Talent", "Before & After"]) {
    assertEquals(splitCamelCase(v), v);
  }
});

Deno.test("toDisplayName keeps the legacy exception and splits the rest", () => {
  assertEquals(toDisplayName("BeforeAndAfter"), "Before & After");
  assertEquals(toDisplayName("ProblemCallout"), "Problem Callout");
  assertEquals(toDisplayName("PatternInterrupt"), "Pattern Interrupt");
});

Deno.test("ad_type display: Image/Photo -> Static, gif -> GIF", () => {
  assertEquals(toDimensionDisplay("ad_type", "Image"), "Static");
  assertEquals(toDimensionDisplay("ad_type", "Photo"), "Static");
  assertEquals(toDimensionDisplay("ad_type", "gif"), "GIF");
  assertEquals(toDimensionDisplay("ad_type", "Video"), "Video");
  // Only ad_type is renamed: a product literally called Image stays Image.
  assertEquals(toDimensionDisplay("product", "Image"), "Image");
});

Deno.test("parsedDisplayTags: full Goodo name -> stored display forms", () => {
  const parsed = parseAdName(
    "GS200001_Video_NoTalent_UGCNative_WeightedBlanket_TiredBy3pm_SocialProof",
    goodoConvention,
  );
  assertEquals(parsedDisplayTags(parsed), {
    ad_type: "Video",
    person: "No Talent",
    style: "UGC Native",
    product: "Weighted Blanket",
    hook: "Tired By 3pm",
    theme: "Social Proof",
  });
});

Deno.test("parsedDisplayTags(null) -> null", () => {
  assertEquals(parsedDisplayTags(null), null);
});
