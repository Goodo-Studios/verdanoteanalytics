// Ad name assembly, ported as-is from the old Ad Name Generator
// (repos/private/goodo-ad-name-generator/src/lib/adName.ts and options.ts).
// Pure functions, so the naming convention can be tested without the page.
//
// Seven positions, underscore-delimited:
//
//   GS200001_Video_Creator_UGCNative_Greens_TiredBy3pm_ChronicFatigue
//   0 unique code, 1 ad type, 2 person on camera, 3 creative type,
//   4 product, 5 hook (typed), 6 theme / persona
//
// Company rules: the taxonomy is not redesigned here (policy
// goodo-studios-ad-naming-taxonomy-in-redesign), and one code covers every aspect
// ratio of the same ad (policy goodo-studios-ad-code-shared-across-aspect-ratios), so
// the page issues one code per ad, not per size.
//
// Free-text segments are stripped to letters and digits: `_` is the delimiter, so a
// typed one would shift every position after it.

export type AdNameFields = {
  /** Verdanote ad_accounts.id. Scopes the theme list; not part of the name. */
  accountId: string;
  adType: string;
  personOnCamera: string;
  productName: string;
  hook: string;
  themeOfAd: string;
  creativeType: string;
  uniqueCode: string;
};

export const emptyFields = (): AdNameFields => ({
  accountId: "",
  adType: "",
  personOnCamera: "",
  productName: "",
  hook: "",
  themeOfAd: "",
  creativeType: "",
  uniqueCode: "",
});

/**
 * Strip a segment to what is safe between delimiters, collapsing word breaks into
 * capitals. A token that already carries capitals is left alone ("UGC", "iPhone").
 */
export function sanitizeSegment(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((token) => (token === token.toLowerCase() ? token.charAt(0).toUpperCase() + token.slice(1) : token))
    .join("");
}

/** `200001` -> `GS200001`. Returns "" when there are no digits to format. */
export function formatCode(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 6);
  return digits ? `GS${digits.padStart(6, "0")}` : "";
}

export function buildAdName(fields: AdNameFields): string {
  return [
    formatCode(fields.uniqueCode),
    fields.adType,
    fields.personOnCamera,
    sanitizeSegment(fields.creativeType),
    sanitizeSegment(fields.productName),
    sanitizeSegment(fields.hook),
    sanitizeSegment(fields.themeOfAd),
  ]
    .filter((segment) => segment.length > 0)
    .join("_");
}

export type FieldErrors = Partial<Record<keyof AdNameFields, string>>;

/** Every field is required. */
const REQUIRED_LABELS: Partial<Record<keyof AdNameFields, string>> = {
  accountId: "Client account is required",
  adType: "Ad type is required",
  creativeType: "Creative type is required",
  personOnCamera: "Person on camera is required",
  productName: "Product name is required",
  hook: "Hook is required",
  themeOfAd: "Theme / persona is required",
  uniqueCode: "Unique code is required",
};

export function validate(fields: AdNameFields): FieldErrors {
  const errors: FieldErrors = {};
  for (const key of Object.keys(REQUIRED_LABELS) as (keyof AdNameFields)[]) {
    if (!fields[key].trim()) {
      errors[key] = REQUIRED_LABELS[key];
    } else if (!sanitizeSegment(fields[key])) {
      // Text made only of symbols or emoji sanitizes to nothing and would drop a segment.
      errors[key] = "Use at least one letter or number";
    }
  }
  return errors;
}

export function isComplete(fields: AdNameFields): boolean {
  return Object.keys(validate(fields)).length === 0;
}

export type Option = { value: string; label: string };

/** Static vocabularies, matching src/lib/tagOptions.ts (TYPE, PERSON and STYLE options). */
export const AD_TYPES: Option[] = [
  { value: "Video", label: "Video" },
  { value: "Static", label: "Static" },
  { value: "GIF", label: "GIF" },
  { value: "Carousel", label: "Carousel" },
];

export const PEOPLE_ON_CAMERA: Option[] = [
  { value: "Creator", label: "Creator" },
  { value: "Customer", label: "Customer" },
  { value: "Founder", label: "Founder" },
  { value: "Actor", label: "Actor" },
  { value: "NoTalent", label: "No Talent" },
];

export const CREATIVE_TYPES: Option[] = [
  { value: "UGCNative", label: "UGC Native" },
  { value: "StudioClean", label: "Studio Clean" },
  { value: "TextForward", label: "Text Forward" },
  { value: "Lifestyle", label: "Lifestyle" },
];

/** The counter's number as the six digits used in the name. Throws on anything unusable. */
export function toCode(value: unknown): string {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n) || n <= 0) {
    throw new Error("The counter returned an unusable value.");
  }
  return String(n).padStart(6, "0");
}

export type Theme = { angleId: string; label: string };
export type ClientAccount = { accountId: string; name: string; themes: Theme[] };

/**
 * Join accounts and their themes the way the old generator's taxonomy mirror did:
 * themes sorted by label, end-to-end test themes ("E2E ...") left out.
 */
export function buildClientList(
  accounts: Array<{ id: string; name: string }>,
  clusters: Array<{ id: string; account_id: string; label: string | null }>,
): ClientAccount[] {
  const byAccount = new Map<string, Theme[]>();
  for (const c of clusters) {
    if (!c.label || /^E2E /i.test(c.label)) continue;
    const list = byAccount.get(c.account_id) ?? [];
    list.push({ angleId: c.id, label: c.label });
    byAccount.set(c.account_id, list);
  }
  for (const list of byAccount.values()) list.sort((a, b) => a.label.localeCompare(b.label));
  return accounts
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({ accountId: a.id, name: a.name, themes: byAccount.get(a.id) ?? [] }));
}
