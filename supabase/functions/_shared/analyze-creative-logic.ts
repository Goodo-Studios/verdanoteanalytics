// analyze-creative — pure framework→columns mapping for Creative-Vault parity.
//
// The Creative Vault (vault-analyze) persists the FULL structured framework for
// every saved item: the 9 discrete fields (copywriting_framework, hook_type,
// hook_verbal, hook_text, hook_formula, value_structure, cta_type, cta_formula,
// fill_in_blank_script) PLUS the raw parsed object in framework_json
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
    hook_formula: textField(obj.hook_formula),
    value_structure: textField(obj.value_structure),
    cta_type: textField(obj.cta_type),
    cta_formula: textField(obj.cta_formula),
    fill_in_blank_script: textField(obj.fill_in_blank_script),
    framework_json: hasFields ? obj : null,
  };
}
