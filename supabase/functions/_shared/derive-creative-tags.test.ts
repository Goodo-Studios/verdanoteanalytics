// US-009: Unit tests for the deterministic AI → app-vocab tag derivation and its
// integration with the precedence resolver.
//
//   deno test supabase/functions/_shared/derive-creative-tags.test.ts
//
// Covers: hook_type enum → app hook vocab (incl. "other"/unknown → null),
// video/static → ad_type, brand_name → product (incl. junk drop), value_structure
// → theme (keyword-normalized, fuzzy-flagged, unmatched → null), person/style
// never AI-derived, and computeAutoTags precedence (never clobber manual/csv/
// parsed; ai only fills gaps; needs_review only from fuzzy AI dims).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveAiTags,
  aiTagsToPartial,
  fuzzyDimsOf,
  computeAutoTags,
  HOOK_TYPE_TO_APP,
} from "./derive-creative-tags.ts";
import type { AdNameTags } from "./parse-ad-name.ts";

const allNull: AdNameTags = {
  ad_type: null, person: null, style: null, product: null, hook: null, theme: null,
};

// ── hook_type → app hook ──────────────────────────────────────────────────────

Deno.test("hook: each AI enum maps to the exact app hook vocab", () => {
  assertEquals(deriveAiTags({ hook_type: "bold_claim" }).hook, { value: "Statement Bold", fuzzy: false });
  assertEquals(deriveAiTags({ hook_type: "pattern_interrupt" }).hook, { value: "Pattern Interrupt", fuzzy: false });
  assertEquals(deriveAiTags({ hook_type: "honest_admission" }).hook, { value: "Confession", fuzzy: false });
  assertEquals(deriveAiTags({ hook_type: "question" }).hook, { value: "Question", fuzzy: false });
});

Deno.test("hook: mapped values are real app HOOK_OPTIONS (no raw enum leak)", () => {
  const HOOK_OPTIONS = ["Problem Callout", "Confession", "Question", "Statement Bold", "Authority Intro", "Before & After", "Pattern Interrupt"];
  for (const v of Object.values(HOOK_TYPE_TO_APP)) {
    assertEquals(HOOK_OPTIONS.includes(v), true, `${v} must be a valid app hook`);
  }
});

Deno.test("hook: case-insensitive + trimmed enum resolution", () => {
  assertEquals(deriveAiTags({ hook_type: "  Bold_Claim " }).hook.value, "Statement Bold");
});

Deno.test("hook: 'other' / unknown / null → null (never guess)", () => {
  assertEquals(deriveAiTags({ hook_type: "other" }).hook.value, null);
  assertEquals(deriveAiTags({ hook_type: "some_new_enum" }).hook.value, null);
  assertEquals(deriveAiTags({ hook_type: null }).hook.value, null);
  assertEquals(deriveAiTags({}).hook.value, null);
});

// ── media kind → ad_type ──────────────────────────────────────────────────────

Deno.test("ad_type: video → Video, static → Static, unknown → null", () => {
  assertEquals(deriveAiTags({ isVideo: true }).ad_type, { value: "Video", fuzzy: false });
  assertEquals(deriveAiTags({ isVideo: false }).ad_type, { value: "Static", fuzzy: false });
  assertEquals(deriveAiTags({}).ad_type, { value: null, fuzzy: false });
});

// ── brand_name → product ──────────────────────────────────────────────────────

Deno.test("product: brand_name (free text) flows through", () => {
  assertEquals(deriveAiTags({ framework_json: { brand_name: "Velora" } }).product, { value: "Velora", fuzzy: false });
});

Deno.test("product: junk brand values are dropped, not tagged", () => {
  for (const junk of ["null", "N/A", "unclear", "unknown", "", "  ", "none"]) {
    assertEquals(deriveAiTags({ framework_json: { brand_name: junk } }).product.value, null, `${junk} must drop`);
  }
});

Deno.test("product: missing framework_json → null", () => {
  assertEquals(deriveAiTags({ framework_json: null }).product.value, null);
  assertEquals(deriveAiTags({}).product.value, null);
});

// ── value_structure → theme (angle), keyword-normalized + fuzzy ───────────────

Deno.test("theme: value_structure keyword-normalizes to a clean canonical + fuzzy flag", () => {
  assertEquals(deriveAiTags({ value_structure: "A before-after transformation reveal" }).theme, { value: "Before-After", fuzzy: true });
  assertEquals(deriveAiTags({ value_structure: "Personal story that builds to the product" }).theme, { value: "Story", fuzzy: true });
  assertEquals(deriveAiTags({ value_structure: "Side-by-side comparison of two options" }).theme.value, "Comparison");
  assertEquals(deriveAiTags({ value_structure: "A numbered list of tips" }).theme.value, "Listicle");
  assertEquals(deriveAiTags({ value_structure: "Product demonstration walkthrough" }).theme.value, "Demonstration");
  assertEquals(deriveAiTags({ value_structure: "Customer testimonial montage" }).theme.value, "Testimonial");
  assertEquals(deriveAiTags({ value_structure: "single insight with a supporting example" }).theme.value, "Single Insight");
});

Deno.test("theme: unmatched structure → null (never dump a raw sentence)", () => {
  assertEquals(deriveAiTags({ value_structure: "some freeform description with no known angle" }).theme.value, null);
  assertEquals(deriveAiTags({ value_structure: null }).theme.value, null);
});

// ── person + style are never AI-derived (they come from the ad name) ──────────

Deno.test("person + style are always null from the AI layer", () => {
  const d = deriveAiTags({ hook_type: "bold_claim", isVideo: true, value_structure: "story", framework_json: { brand_name: "X" } });
  assertEquals(d.person, { value: null, fuzzy: false });
  assertEquals(d.style, { value: null, fuzzy: false });
});

// ── helpers ───────────────────────────────────────────────────────────────────

Deno.test("aiTagsToPartial + fuzzyDimsOf: only fuzzy, non-null dims flagged", () => {
  const d = deriveAiTags({ hook_type: "question", isVideo: true, value_structure: "before-after", framework_json: { brand_name: "Acme" } });
  assertEquals(aiTagsToPartial(d), { ad_type: "Video", person: null, style: null, product: "Acme", hook: "Question", theme: "Before-After" });
  // Only theme is fuzzy (and non-null); hook/ad_type/product are high-confidence.
  assertEquals(fuzzyDimsOf(d), ["theme"]);
});

// ── computeAutoTags: precedence + provenance + needs_review ───────────────────

Deno.test("computeAutoTags: AI fills only the gaps the parser left (parsed wins)", () => {
  // Ad name gives style; AI gives hook/ad_type/product/theme.
  const parsed: AdNameTags = { ...allNull, style: "UGC Native" };
  const r = computeAutoTags({
    parsed,
    ai: { hook_type: "bold_claim", isVideo: true, value_structure: "story", framework_json: { brand_name: "Velora" } },
  });
  assertEquals(r.tags.style, "UGC Native");
  assertEquals(r.sources.style, "parsed");
  assertEquals(r.tags.hook, "Statement Bold");
  assertEquals(r.sources.hook, "ai");
  assertEquals(r.tags.ad_type, "Video");
  assertEquals(r.tags.product, "Velora");
  assertEquals(r.tags.theme, "Story");
  // Parser contributed → tag_source is 'parsed' (highest contributor), not 'ai'.
  assertEquals(r.tag_source, "parsed");
  // theme came from a fuzzy AI dim → review flagged.
  assertEquals(r.needs_review, true);
});

Deno.test("computeAutoTags: NEVER overwrites a manual tag", () => {
  const manual = { hook: "Problem Callout" };
  const r = computeAutoTags({
    parsed: null,
    ai: { hook_type: "bold_claim" }, // would be "Statement Bold" if it won
    manual,
  });
  assertEquals(r.tags.hook, "Problem Callout");
  assertEquals(r.sources.hook, "manual");
  assertEquals(r.tag_source, "manual");
});

Deno.test("computeAutoTags: NEVER overwrites a csv_match tag", () => {
  const r = computeAutoTags({
    parsed: null,
    ai: { isVideo: false }, // would be "Static"
    nameMapping: { ad_type: "Carousel" },
  });
  assertEquals(r.tags.ad_type, "Carousel");
  assertEquals(r.sources.ad_type, "csv_match");
});

Deno.test("computeAutoTags: pure-AI row → tag_source 'ai'", () => {
  const r = computeAutoTags({
    parsed: null,
    ai: { hook_type: "question", isVideo: true, framework_json: { brand_name: "Acme" } },
  });
  assertEquals(r.tag_source, "ai");
  assertEquals(r.needs_review, false); // no fuzzy dim resolved
  assertEquals(r.tags.hook, "Question");
  assertEquals(r.tags.ad_type, "Video");
  assertEquals(r.tags.product, "Acme");
});

Deno.test("computeAutoTags: nothing derivable → untagged, no review", () => {
  const r = computeAutoTags({ parsed: null, ai: { hook_type: "other" } });
  assertEquals(r.tag_source, "untagged");
  assertEquals(r.needs_review, false);
  assertEquals(r.tags, allNull);
});

Deno.test("computeAutoTags: needs_review only when the fuzzy AI dim actually WINS", () => {
  // Ad name already supplies theme → AI theme is suppressed → no review flag.
  const parsed: AdNameTags = { ...allNull, theme: "Lifestyle" };
  const r = computeAutoTags({
    parsed,
    ai: { value_structure: "before-after", hook_type: "question" },
  });
  assertEquals(r.tags.theme, "Lifestyle");
  assertEquals(r.sources.theme, "parsed");
  assertEquals(r.needs_review, false);
});
