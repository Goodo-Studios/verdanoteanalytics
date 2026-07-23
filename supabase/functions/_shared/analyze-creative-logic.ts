// analyze-creative — pure framework→columns mapping for Creative-Vault parity.
//
// The Creative Vault (vault-analyze) persists the FULL structured framework for
// every saved item: the discrete fields (copywriting_framework, hook_type,
// hook_verbal, hook_text, hook_visual, hook_formula, value_structure, cta_type,
// cta_formula, fill_in_blank_script) PLUS the raw parsed object in framework_json
// (inspiration_frameworks). The account-side analyze-creative used to FLATTEN that
// into join-strings (ai_hook_analysis / ai_cta_notes) and drop framework_json +
// fill_in_blank_script + value_structure entirely — so a Save-to-Vault copy was
// lossy.
//
// This module maps a parsed framework object (from FRAMEWORK_PROMPT on the video
// branch, or IMAGE_ANALYSIS_PROMPT on the static-image branch) into the vault-parity
// creatives.* columns added in migration 20260722000007. The column names match
// inspiration_frameworks 1:1 so the copy is lossless.
//
// Extracted here — pure and dependency-free (no Deno / esm.sh / Supabase client) —
// so it unit-tests under `deno test` exactly like vault-analyze-logic.ts.

export interface FrameworkColumns {
  copywriting_framework: string | null;
  hook_type: string | null;
  hook_verbal: string | null;
  hook_text: string | null;
  hook_visual: string | null;
  hook_formula: string | null;
  value_structure: string | null;
  cta_type: string | null;
  cta_formula: string | null;
  fill_in_blank_script: string | null;
  framework_json: Record<string, unknown> | null;
}

/**
 * Coerce a loose-JSON value into a text-column value (trimmed string, or null).
 * Empty / whitespace-only strings and null/undefined become null. A stray number
 * or boolean (models occasionally emit one for an enum field) is stringified
 * rather than dropped, since every target column is `text`. Pure.
 */
function textField(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : null;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/**
 * Map a parsed framework object to the vault-parity creatives columns.
 *
 * @param fw   parsed framework JSON. May be `{}` when the model returned nothing
 *             parseable or no thumbnail was available — every field then degrades
 *             to null and framework_json to null (never an empty `{}` blob).
 * @param opts.isImage  static-image branch: force hook_verbal=null (nothing is
 *             spoken, mirroring vault-analyze's analyzeStaticImage which inserts
 *             hook_verbal: null). The IMAGE_ANALYSIS_PROMPT does not emit
 *             hook_verbal, so this is belt-and-suspenders.
 *
 * framework_json stores the WHOLE parsed object (matching vault-analyze, which
 * persists `framework_json: a`). On the image branch that object also carries
 * brand_name / industry / visual_analysis / copy_analysis — preserved verbatim so
 * nothing is lost, exactly as the vault does.
 *
 * Pure + deterministic.
 */
export function buildFrameworkColumns(
  fw: Record<string, unknown>,
  opts: { isImage?: boolean } = {},
): FrameworkColumns {
  const obj = fw && typeof fw === "object" ? fw : {};
  const hasFields = Object.keys(obj).length > 0;
  return {
    copywriting_framework: textField(obj.copywriting_framework),
    hook_type: textField(obj.hook_type),
    hook_verbal: opts.isImage ? null : textField(obj.hook_verbal),
    hook_text: textField(obj.hook_text),
    hook_visual: textField(obj.hook_visual),
    hook_formula: textField(obj.hook_formula),
    value_structure: textField(obj.value_structure),
    cta_type: textField(obj.cta_type),
    cta_formula: textField(obj.cta_formula),
    fill_in_blank_script: textField(obj.fill_in_blank_script),
    framework_json: hasFields ? obj : null,
  };
}

/** String-only coercion for metadata/tag values: trimmed non-empty string or null.
 * Unlike textField it does NOT stringify stray numbers/booleans — these fields are
 * free-text metadata where a non-string is noise, not a value to keep. Pure. */
function strField(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Vault-parity metadata promoted to first-class creatives columns:
 * brand_name / industry / ad_format / target_audience.
 *
 * `src` is the brand-metadata object on the video branch (BRAND_METADATA_PROMPT)
 * or the single parsed object on the image branch (IMAGE_ANALYSIS_PROMPT emits
 * these inline). analyze-creative also keeps writing these into tag_suggestions
 * for back-compat with the review-gated auto-tag layer. Pure.
 */
export function metadataColumns(src: Record<string, unknown>): {
  brand_name: string | null;
  industry: string | null;
  ad_format: string | null;
  target_audience: string | null;
} {
  const o = src && typeof src === "object" ? src : {};
  return {
    brand_name: strField(o.brand_name),
    industry: strField(o.industry),
    ad_format: strField(o.ad_format),
    target_audience: strField(o.target_audience),
  };
}

export interface TagSuggestion {
  value: string;
  confidence: number;
  signal: "script" | "visual" | "destination";
}

/**
 * Build the review-gated tag_suggestions blob from the analysis outputs.
 *
 * AI-derived tags land HERE (not directly in the creatives tag columns): the
 * creatives.tag_source CHECK has no 'ai' value, so promotion of these suggestions
 * into the style/person/… tag columns stays with the review-gated auto-tag layer.
 * style + person are now first-class extractions from the framework prompt (`fw`);
 * ad_type still maps from ad_format (a distinct dimension). Pure.
 *
 * @param fw          parsed framework object (carries hook_type, value_structure,
 *                    and now style + person).
 * @param brand       parsed brand-metadata object (ad_format, brand_name, industry).
 * @param fromVision  true when the ad_type/style signal came from a vision call
 *                    (image branch or frame-vision) rather than the script.
 */
export function buildTagSuggestions(
  fw: Record<string, unknown>,
  brand: Record<string, unknown>,
  fromVision: boolean,
): Record<string, TagSuggestion> {
  const out: Record<string, TagSuggestion> = {};
  const put = (dim: string, value: string | null, confidence: number, signal: TagSuggestion["signal"]) => {
    if (value) out[dim] = { value, confidence, signal };
  };
  const adFormat = strField(brand.ad_format);
  put("ad_type", adFormat, 0.6, fromVision ? "visual" : "script");
  // Prefer the dedicated `style` extraction; fall back to ad_format for older rows.
  put("style", strField(fw.style) ?? adFormat, 0.5, fromVision ? "visual" : "script");
  put("person", strField(fw.person), 0.5, fromVision ? "visual" : "script");
  put("product", strField(brand.brand_name), 0.5, "script");
  put("hook", strField(fw.hook_type), 0.7, "script");
  put("theme", strField(brand.industry), 0.5, "script");
  put("angle", strField(fw.value_structure), 0.5, "script");
  return out;
}
