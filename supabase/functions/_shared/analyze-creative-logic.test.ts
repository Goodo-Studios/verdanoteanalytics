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
import {
  buildFrameworkColumns,
  buildTagSuggestions,
  metadataColumns,
} from "./analyze-creative-logic.ts";
import { parseLooseJson } from "./vault-analyze-logic.ts";

// A rich, chronological value delivery (arrow-chain, ~150-260 chars) — the LIVE
// Vault style the account prompt now targets, NOT the old terse one-liner.
const RICH_VALUE =
  "before (investment banker) → catalyst (legalization) → struggle (early losses) → " +
  "patience (held 5yr) → inflection (5x revenue) → current state (runs the fund)";

// A full FRAMEWORK_PROMPT (video branch) response object.
const VIDEO_FW = {
  copywriting_framework: "PAS",
  hook_type: "bold_claim",
  hook_verbal: "I quit my job after this one trick.",
  hook_text: "SHE MADE $10K IN 30 DAYS",
  hook_visual: "Creator holds a stack of cash to camera in a home office.",
  hook_formula: "[CLAIM] after [TOPIC] in [TIMEFRAME] for [RESULT]",
  value_structure: RICH_VALUE,
  cta_type: "comment",
  cta_formula: "Comment [KEYWORD] and I'll DM you the [RESOURCE]",
  fill_in_blank_script: "I [CLAIM] after [SPECIFIC_EXAMPLE]. Comment [CTA_ACTION].",
  style: "Talking Head",
  person: "Male founder, 30s",
};

// A full IMAGE_ANALYSIS_PROMPT (static image) response object — note there is NO
// hook_verbal, and it carries brand metadata + copy/visual analysis inline.
const IMAGE_FW = {
  copywriting_framework: "FAB",
  hook_type: "question",
  hook_text: "TIRED OF BLOATING?",
  hook_visual: "Oversized greens tub hero on a bold green gradient.",
  hook_formula: "Tired of [TOPIC]? [BENEFIT]",
  value_structure:
    "pain callout (bloating) → product hero (greens powder) → proof (3 clinical claims) → offer (20% off first order)",
  cta_type: "shop",
  cta_formula: "[ACTION] [BRAND] today",
  fill_in_blank_script: "[BRAND] fixes [CLAIM]. [OFFER]. [CTA_ACTION].",
  brand_name: "Acme Greens",
  industry: "Health",
  ad_format: "Product Hero",
  target_audience: "Health-conscious adults 25-45",
  style: "Product Hero",
  person: "No person (product only)",
  visual_analysis: "Clean white studio shot with product centered.",
  copy_analysis: "Headline poses a relatable pain; CTA is direct.",
};

Deno.test("video branch: all discrete fields persist verbatim (incl. hook_visual)", () => {
  const cols = buildFrameworkColumns(VIDEO_FW, { isImage: false });
  assertEquals(cols.copywriting_framework, "PAS");
  assertEquals(cols.hook_type, "bold_claim");
  assertEquals(cols.hook_verbal, "I quit my job after this one trick.");
  assertEquals(cols.hook_text, "SHE MADE $10K IN 30 DAYS");
  assertEquals(cols.hook_visual, "Creator holds a stack of cash to camera in a home office.");
  assertEquals(cols.hook_formula, "[CLAIM] after [TOPIC] in [TIMEFRAME] for [RESULT]");
  assertEquals(cols.cta_type, "comment");
  assertEquals(cols.cta_formula, "Comment [KEYWORD] and I'll DM you the [RESOURCE]");
  assertEquals(cols.fill_in_blank_script, "I [CLAIM] after [SPECIFIC_EXAMPLE]. Comment [CTA_ACTION].");
});

Deno.test("video branch: rich time-segmented value_structure persists verbatim (not flattened)", () => {
  const cols = buildFrameworkColumns(VIDEO_FW, { isImage: false });
  assertEquals(cols.value_structure, RICH_VALUE);
  // The rich value delivery must survive intact — it is the Vault-parity target.
  assert((cols.value_structure ?? "").length > 100);
  assert((cols.value_structure ?? "").includes("→"));
});

Deno.test("video branch: style + person ride in framework_json (not clobbering tag columns)", () => {
  const cols = buildFrameworkColumns(VIDEO_FW, { isImage: false });
  const fj = cols.framework_json as Record<string, unknown>;
  assert(fj !== null);
  assertEquals(fj.style, "Talking Head");
  assertEquals(fj.person, "Male founder, 30s");
  // buildFrameworkColumns does NOT expose style/person as discrete columns — the
  // auto-tag layer promotes them into the creatives.style/person tag columns.
  assert(!("style" in cols));
  assert(!("person" in cols));
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

Deno.test("image branch: hook_verbal forced null, discrete fields persist (incl. hook_visual)", () => {
  const cols = buildFrameworkColumns(IMAGE_FW, { isImage: true });
  assertEquals(cols.hook_verbal, null); // nothing spoken on a static image
  assertEquals(cols.copywriting_framework, "FAB");
  assertEquals(cols.hook_type, "question");
  assertEquals(cols.hook_text, "TIRED OF BLOATING?");
  assertEquals(cols.hook_visual, "Oversized greens tub hero on a bold green gradient.");
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
  assertEquals(cols.hook_visual, null);
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

// ── metadataColumns: Vault metadata promoted to first-class columns ────────────

Deno.test("metadataColumns: promotes brand_name / industry / ad_format / target_audience", () => {
  const m = metadataColumns(IMAGE_FW);
  assertEquals(m.brand_name, "Acme Greens");
  assertEquals(m.industry, "Health");
  assertEquals(m.ad_format, "Product Hero");
  assertEquals(m.target_audience, "Health-conscious adults 25-45");
});

Deno.test("metadataColumns: missing / blank / non-string values degrade to null", () => {
  const m = metadataColumns({ brand_name: "  ", industry: null, ad_format: 5, target_audience: "Gamers" });
  assertEquals(m.brand_name, null); // whitespace-only
  assertEquals(m.industry, null); // explicit null
  assertEquals(m.ad_format, null); // stray number is noise for free-text metadata
  assertEquals(m.target_audience, "Gamers"); // trimmed passthrough
});

// ── buildTagSuggestions: style + person are first-class dimensions now ─────────

Deno.test("buildTagSuggestions (video): style + person from framework, distinct from ad_type", () => {
  const sugg = buildTagSuggestions(VIDEO_FW, {
    ad_format: "Talking Head Ad",
    brand_name: "AcmeFund",
    industry: "Finance",
  }, false);
  assertEquals(sugg.style.value, "Talking Head"); // dedicated fw.style wins over ad_format
  assertEquals(sugg.person.value, "Male founder, 30s");
  assertEquals(sugg.ad_type.value, "Talking Head Ad"); // ad_type still from ad_format
  assertEquals(sugg.product.value, "AcmeFund");
  assertEquals(sugg.theme.value, "Finance");
  assertEquals(sugg.hook.value, "bold_claim");
  // angle carries the rich value delivery.
  assertEquals(sugg.angle.value, RICH_VALUE);
  // script-signalled dimensions keep the script signal; style/person follow fromVision.
  assertEquals(sugg.style.signal, "script");
});

Deno.test("buildTagSuggestions (vision): style falls back to ad_format when fw.style absent; visual signal", () => {
  const sugg = buildTagSuggestions(
    { hook_type: "question" }, // no style/person extracted
    { ad_format: "Product Hero" },
    true,
  );
  assertEquals(sugg.style.value, "Product Hero"); // fallback to ad_format
  assertEquals(sugg.style.signal, "visual");
  assert(!("person" in sugg)); // nothing to suggest → omitted
});
