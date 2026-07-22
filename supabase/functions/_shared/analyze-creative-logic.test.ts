// analyze-creative — parse + persist parity tests.
//
// Deno edge tests are manual (not in CI vitest) per
// verdanote-deno-edge-tests-are-manual-not-in-ci-vitest. Run with:
//   deno test -A supabase/functions/_shared/analyze-creative-logic.test.ts
//
// Covers the framework→columns mapping that brings analyze-creative to
// Creative-Vault parity: the discrete hook/cta fields, value_structure,
// fill_in_blank_script, and the framework_json blob shape. Fixtures mirror the
// vault-analyze output shapes (FRAMEWORK_PROMPT for video, IMAGE_ANALYSIS_PROMPT
// for statics) so the account-side write matches inspiration_frameworks 1:1.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFrameworkColumns } from "./analyze-creative-logic.ts";
import { parseLooseJson } from "./vault-analyze-logic.ts";

// A full FRAMEWORK_PROMPT (video branch) response object.
const VIDEO_FW = {
  copywriting_framework: "PAS",
  hook_type: "bold_claim",
  hook_verbal: "I quit my job after this one trick.",
  hook_text: "SHE MADE $10K IN 30 DAYS",
  hook_formula: "[CLAIM] after [TOPIC] in [TIMEFRAME] for [RESULT]",
  value_structure: "single insight with example",
  cta_type: "comment",
  cta_formula: "Comment [KEYWORD] and I'll DM you the [RESOURCE]",
  fill_in_blank_script: "I [CLAIM] after [SPECIFIC_EXAMPLE]. Comment [CTA_ACTION].",
};

// A full IMAGE_ANALYSIS_PROMPT (static image) response object — note there is NO
// hook_verbal, and it carries brand metadata + copy/visual analysis inline.
const IMAGE_FW = {
  copywriting_framework: "FAB",
  hook_type: "question",
  hook_text: "TIRED OF BLOATING?",
  hook_formula: "Tired of [TOPIC]? [BENEFIT]",
  value_structure: "product hero",
  cta_type: "shop",
  cta_formula: "[ACTION] [BRAND] today",
  fill_in_blank_script: "[BRAND] fixes [CLAIM]. [OFFER]. [CTA_ACTION].",
  brand_name: "Acme Greens",
  industry: "Health",
  ad_format: "Product Hero",
  target_audience: "Health-conscious adults 25-45",
  visual_analysis: "Clean white studio shot with product centered.",
  copy_analysis: "Headline poses a relatable pain; CTA is direct.",
};

Deno.test("video branch: all 9 discrete fields persist verbatim", () => {
  const cols = buildFrameworkColumns(VIDEO_FW, { isImage: false });
  assertEquals(cols.copywriting_framework, "PAS");
  assertEquals(cols.hook_type, "bold_claim");
  assertEquals(cols.hook_verbal, "I quit my job after this one trick.");
  assertEquals(cols.hook_text, "SHE MADE $10K IN 30 DAYS");
  assertEquals(cols.hook_formula, "[CLAIM] after [TOPIC] in [TIMEFRAME] for [RESULT]");
  assertEquals(cols.value_structure, "single insight with example");
  assertEquals(cols.cta_type, "comment");
  assertEquals(cols.cta_formula, "Comment [KEYWORD] and I'll DM you the [RESOURCE]");
  assertEquals(cols.fill_in_blank_script, "I [CLAIM] after [SPECIFIC_EXAMPLE]. Comment [CTA_ACTION].");
});

Deno.test("video branch: framework_json holds the complete parsed object", () => {
  const cols = buildFrameworkColumns(VIDEO_FW, { isImage: false });
  assertEquals(cols.framework_json, VIDEO_FW);
  // fill_in_blank_script must survive inside framework_json too (it was dropped before).
  assert(cols.framework_json !== null);
  assertEquals(
    (cols.framework_json as Record<string, unknown>).fill_in_blank_script,
    "I [CLAIM] after [SPECIFIC_EXAMPLE]. Comment [CTA_ACTION].",
  );
});

Deno.test("image branch: hook_verbal forced null, discrete fields persist", () => {
  const cols = buildFrameworkColumns(IMAGE_FW, { isImage: true });
  assertEquals(cols.hook_verbal, null); // nothing spoken on a static image
  assertEquals(cols.copywriting_framework, "FAB");
  assertEquals(cols.hook_type, "question");
  assertEquals(cols.hook_text, "TIRED OF BLOATING?");
  assertEquals(cols.cta_type, "shop");
  assertEquals(cols.fill_in_blank_script, "[BRAND] fixes [CLAIM]. [OFFER]. [CTA_ACTION].");
});

Deno.test("image branch: framework_json preserves inline brand + analysis fields", () => {
  const cols = buildFrameworkColumns(IMAGE_FW, { isImage: true });
  const fj = cols.framework_json as Record<string, unknown>;
  assert(fj !== null);
  assertEquals(fj.brand_name, "Acme Greens");
  assertEquals(fj.industry, "Health");
  assertEquals(fj.visual_analysis, "Clean white studio shot with product centered.");
  assertEquals(fj.copy_analysis, "Headline poses a relatable pain; CTA is direct.");
});

Deno.test("empty object: every field null and framework_json null (no empty blob)", () => {
  const cols = buildFrameworkColumns({}, { isImage: false });
  assertEquals(cols.copywriting_framework, null);
  assertEquals(cols.hook_type, null);
  assertEquals(cols.hook_verbal, null);
  assertEquals(cols.hook_text, null);
  assertEquals(cols.hook_formula, null);
  assertEquals(cols.value_structure, null);
  assertEquals(cols.cta_type, null);
  assertEquals(cols.cta_formula, null);
  assertEquals(cols.fill_in_blank_script, null);
  assertEquals(cols.framework_json, null);
});

Deno.test("explicit null hook_text is preserved as null (no on-screen text)", () => {
  const cols = buildFrameworkColumns({ ...VIDEO_FW, hook_text: null }, { isImage: false });
  assertEquals(cols.hook_text, null);
  assertEquals(cols.hook_verbal, "I quit my job after this one trick."); // others intact
});

Deno.test("loose values: blank strings → null, stray non-strings stringified", () => {
  const cols = buildFrameworkColumns(
    { copywriting_framework: "   ", hook_type: 3, cta_type: true, hook_text: "  keep  " },
    { isImage: false },
  );
  assertEquals(cols.copywriting_framework, null); // whitespace-only → null
  assertEquals(cols.hook_type, "3"); // number coerced (text column)
  assertEquals(cols.cta_type, "true"); // boolean coerced
  assertEquals(cols.hook_text, "keep"); // trimmed
});

Deno.test("parse + persist path: fenced JSON string parses then maps to columns", () => {
  const raw = "```json\n" + JSON.stringify(VIDEO_FW) + "\n```";
  const cols = buildFrameworkColumns(parseLooseJson(raw), { isImage: false });
  assertEquals(cols.copywriting_framework, "PAS");
  assertEquals(cols.fill_in_blank_script, VIDEO_FW.fill_in_blank_script);
  assertEquals(cols.framework_json, VIDEO_FW);
});

Deno.test("parse + persist path: unparseable text → all-null columns (graceful)", () => {
  const cols = buildFrameworkColumns(parseLooseJson("not json at all"), { isImage: true });
  assertEquals(cols.framework_json, null);
  assertEquals(cols.copywriting_framework, null);
});
