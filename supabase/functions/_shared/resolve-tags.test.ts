// US-003: Unit tests for the single precedence resolver.
//
//   deno test supabase/functions/_shared/resolve-tags.test.ts
//
// Precedence under test: manual > csv (name_mappings) > parsed > untagged.
// tag_source reflects the HIGHEST-precedence source contributing ANY dimension.
// Legacy 'csv'/'inferred' must never be emitted.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveTags } from "./resolve-tags.ts";
import type { AdNameTags } from "./parse-ad-name.ts";

const allNull: AdNameTags = {
  ad_type: null,
  person: null,
  style: null,
  product: null,
  hook: null,
  theme: null,
};

Deno.test("manual wins over csv + parser on the same dimension", () => {
  const parsed: AdNameTags = { ...allNull, ad_type: "Video" };
  const csv = { ad_type: "Static" };
  const manual = { ad_type: "Carousel" };
  const { tags, tag_source } = resolveTags(parsed, csv, manual);
  assertEquals(tags.ad_type, "Carousel");
  assertEquals(tag_source, "manual");
});

Deno.test("csv (name_mappings) wins over parser", () => {
  const parsed: AdNameTags = { ...allNull, person: "Creator", ad_type: "Video" };
  const csv = { person: "Customer" };
  const { tags, tag_source } = resolveTags(parsed, csv, null);
  assertEquals(tags.person, "Customer"); // csv beats parser on person
  assertEquals(tags.ad_type, "Video"); // parser fills where csv silent
  assertEquals(tag_source, "csv_match"); // highest contributor is csv
});

Deno.test("parser-only -> tag_source parsed", () => {
  const parsed: AdNameTags = { ...allNull, ad_type: "Video", style: "UGCNative" };
  const { tags, tag_source } = resolveTags(parsed, null, null);
  assertEquals(tags.ad_type, "Video");
  assertEquals(tags.style, "UGCNative");
  assertEquals(tag_source, "parsed");
});

Deno.test("all-null from every source -> untagged", () => {
  const { tags, tag_source } = resolveTags(allNull, null, null);
  assertEquals(tags, allNull);
  assertEquals(tag_source, "untagged");
});

Deno.test("nothing at all (null inputs) -> untagged", () => {
  const { tags, tag_source } = resolveTags(null, null, null);
  assertEquals(tags, allNull);
  assertEquals(tag_source, "untagged");
});

Deno.test("mixed: manual on one dim, csv on another -> tag_source reflects highest (manual)", () => {
  const parsed: AdNameTags = { ...allNull, hook: "ProblemCallout" };
  const csv = { person: "Customer" };
  const manual = { ad_type: "Video" };
  const { tags, tag_source } = resolveTags(parsed, csv, manual);
  assertEquals(tags.ad_type, "Video"); // from manual
  assertEquals(tags.person, "Customer"); // from csv
  assertEquals(tags.hook, "ProblemCallout"); // from parser
  assertEquals(tag_source, "manual"); // manual is the highest contributor
});

Deno.test("mixed: csv + parser only (no manual) -> csv_match", () => {
  const parsed: AdNameTags = { ...allNull, hook: "Confession", theme: "Spring" };
  const csv = { style: "StudioClean" };
  const { tags, tag_source } = resolveTags(parsed, csv, null);
  assertEquals(tags.style, "StudioClean"); // csv
  assertEquals(tags.hook, "Confession"); // parser
  assertEquals(tags.theme, "Spring"); // parser
  assertEquals(tag_source, "csv_match");
});

Deno.test("empty-string values are ignored (do not win a dim or flip tag_source)", () => {
  const parsed: AdNameTags = { ...allNull, ad_type: "Video" };
  const csv = { ad_type: "  " }; // whitespace -> not a real value
  const manual = { person: "" }; // empty -> not a real value
  const { tags, tag_source } = resolveTags(parsed, csv, manual);
  assertEquals(tags.ad_type, "Video"); // parser, since csv was blank
  assertEquals(tags.person, null); // manual blank ignored
  assertEquals(tag_source, "parsed"); // neither manual nor csv contributed
});

Deno.test("resolver never emits legacy csv/inferred", () => {
  // Exhaustively: every combination must yield one of the four allowed values.
  const allowed = new Set(["manual", "csv_match", "parsed", "untagged"]);
  const cases = [
    resolveTags(allNull, null, null),
    resolveTags({ ...allNull, ad_type: "Video" }, null, null),
    resolveTags(allNull, { person: "Creator" }, null),
    resolveTags(allNull, null, { style: "UGCNative" }),
  ];
  for (const c of cases) {
    assertEquals(allowed.has(c.tag_source), true);
  }
});

// ── US-009: the 'ai' layer (below parsed) + sources + needs_review ────────────

Deno.test("ai layer sits BELOW parsed: parser wins the shared dimension", () => {
  const parsed: AdNameTags = { ...allNull, hook: "Problem Callout" };
  const ai = { hook: "Statement Bold", ad_type: "Video" };
  const { tags, tag_source, sources } = resolveTags(parsed, null, null, ai);
  assertEquals(tags.hook, "Problem Callout"); // parser beats ai
  assertEquals(sources.hook, "parsed");
  assertEquals(tags.ad_type, "Video"); // ai fills where parser was silent
  assertEquals(sources.ad_type, "ai");
  assertEquals(tag_source, "parsed"); // highest contributor
});

Deno.test("ai-only row -> tag_source 'ai' + per-dim provenance", () => {
  const ai = { hook: "Question", product: "Velora" };
  const { tags, tag_source, sources } = resolveTags(allNull, null, null, ai);
  assertEquals(tag_source, "ai");
  assertEquals(tags.hook, "Question");
  assertEquals(sources.hook, "ai");
  assertEquals(sources.product, "ai");
  assertEquals(sources.style, null); // nothing supplied style
});

Deno.test("manual/csv still beat the ai layer", () => {
  const ai = { ad_type: "Video", person: "Creator" };
  const { tags, tag_source, sources } = resolveTags(
    null,
    { person: "Customer" }, // csv
    { ad_type: "Carousel" }, // manual
    ai,
  );
  assertEquals(tags.ad_type, "Carousel");
  assertEquals(sources.ad_type, "manual");
  assertEquals(tags.person, "Customer");
  assertEquals(sources.person, "csv_match");
  assertEquals(tag_source, "manual");
});

Deno.test("needs_review raised only when a FUZZY ai dim actually wins", () => {
  // theme is fuzzy and ai supplies it (nothing higher does) -> review.
  const r1 = resolveTags(allNull, null, null, { theme: "Before-After", hook: "Question" }, ["theme"]);
  assertEquals(r1.needs_review, true);
  assertEquals(r1.sources.theme, "ai");

  // Same fuzzy dim, but parser already supplies theme -> ai suppressed -> no flag.
  const r2 = resolveTags({ ...allNull, theme: "Lifestyle" }, null, null, { theme: "Before-After" }, ["theme"]);
  assertEquals(r2.needs_review, false);
  assertEquals(r2.sources.theme, "parsed");

  // No fuzzy dims declared -> never flags.
  const r3 = resolveTags(allNull, null, null, { hook: "Question" });
  assertEquals(r3.needs_review, false);
});

Deno.test("3-arg calls still work unchanged (ai omitted)", () => {
  const { tags, tag_source, needs_review } = resolveTags({ ...allNull, ad_type: "Video" }, null, null);
  assertEquals(tags.ad_type, "Video");
  assertEquals(tag_source, "parsed");
  assertEquals(needs_review, false);
});
