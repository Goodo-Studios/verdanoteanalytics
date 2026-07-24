// Static tag vocabularies + the governed (per-account) option builders.
//
// The four *_OPTIONS arrays below are the app-wide fallback vocabularies for the
// six-dimension tag editor (ad_type / person / style / hook). They stay static —
// hook in particular "remains the existing tag" per the Creative Matrix spec
// (US-004): it is NOT governed by the per-account list.
//
// US-004 adds the GOVERNED axes on top: Theme/Persona, creative type, and body
// are sourced from the account's managed lists (the account-taxonomy read path,
// US-002) rather than from a static array. The builders at the bottom turn that
// read payload into dropdown options, and every governed dimension carries an
// explicit "Untagged" sentinel so a strategist can clear a dimension.

export const TYPE_OPTIONS = ["Video", "Static", "GIF", "Carousel"];
export const PERSON_OPTIONS = ["Creator", "Customer", "Founder", "Actor", "No Talent"];
export const STYLE_OPTIONS = ["UGC Native", "Studio Clean", "Text Forward", "Lifestyle"];
export const HOOK_OPTIONS = ["Problem Callout", "Confession", "Question", "Statement Bold", "Authority Intro", "Before & After", "Pattern Interrupt"];

export const TAG_OPTIONS_MAP: Record<string, string[]> = {
  ad_type: TYPE_OPTIONS,
  person: PERSON_OPTIONS,
  style: STYLE_OPTIONS,
  hook: HOOK_OPTIONS,
};

// ─────────────────────────────────────────────────────────────────────────────
// US-004: governed per-account tag options.
//
// The account-taxonomy read RPC (rpc_account_taxonomy, US-002) returns one object
// per account: a Theme/Persona list (angle_clusters) and the creative-type
// activation state (creative_type_menu ⨝ account_creative_types). These builders
// project that payload into the option shapes the governed tag editor renders.
// PURE — no IO, no React — so they are unit-testable on their own.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The explicit "no value for this dimension" sentinel. Its value is the empty
 * string so it round-trips to a real cleared column (null) on save while staying
 * a selectable option in a dropdown. Every governed dimension offers it, so
 * "untagged" is always reachable per the story's precedence requirement.
 */
export const UNTAGGED_OPTION = { value: "", label: "Untagged" } as const;

/** One Theme/Persona row from rpc_account_taxonomy.themes. */
export interface TaxonomyThemeRow {
  id: string;
  label: string | null;
  archived?: boolean | null;
}

/** One creative-type row from rpc_account_taxonomy.creative_types. */
export interface TaxonomyCreativeTypeRow {
  creative_type_id: string;
  lane: string;
  type_name: string;
  active?: boolean | null;
  account_sort_order?: number | null;
  menu_sort_order?: number | null;
}

/** The account-taxonomy read payload (subset this module consumes). */
export interface AccountTaxonomy {
  account_id?: string;
  themes?: TaxonomyThemeRow[] | null;
  creative_types?: TaxonomyCreativeTypeRow[] | null;
}

/** A Theme/Persona option — value is the angle_id reference. */
export interface ThemeOption {
  /** angle_clusters.id — the reference persisted to creatives.angle_id. */
  value: string;
  label: string;
}

/** A creative type option within a lane. */
export interface CreativeTypeOption {
  /** Display-cased creative_type value persisted to creatives.creative_type. */
  value: string;
  label: string;
}

/** Active creative types grouped by their house lane, for a grouped dropdown. */
export interface CreativeTypeLaneGroup {
  lane: string;
  types: CreativeTypeOption[];
}

/** The full governed option set for one account. */
export interface AccountTagOptions {
  themes: ThemeOption[];
  creativeTypeGroups: CreativeTypeLaneGroup[];
  bodies: string[];
  /** hook remains the existing (static) tag — surfaced here for one-stop access. */
  hooks: string[];
}

/**
 * Live Theme/Persona options (angle_id → label). Archived entries are dropped
 * (you can't tag against an archived Theme/Persona), and blank labels are
 * skipped. Order is preserved from the read payload (already score/newest-ranked
 * by the RPC).
 */
export function buildThemeOptions(
  themes: TaxonomyThemeRow[] | null | undefined,
): ThemeOption[] {
  const out: ThemeOption[] = [];
  for (const t of themes ?? []) {
    if (!t || typeof t.id !== "string" || t.id.length === 0) continue;
    if (t.archived) continue;
    const label = (t.label ?? "").trim();
    if (label.length === 0) continue;
    out.push({ value: t.id, label });
  }
  return out;
}

/**
 * Active creative types grouped by lane. Only rows with active === true are
 * included (the account activated them from the house menu). Lanes preserve the
 * read payload's lane→sort order; within a lane, rows keep the RPC's order
 * (account_sort_order then menu order). Empty lanes are omitted.
 */
export function buildCreativeTypeGroups(
  creativeTypes: TaxonomyCreativeTypeRow[] | null | undefined,
): CreativeTypeLaneGroup[] {
  const groups: CreativeTypeLaneGroup[] = [];
  const byLane = new Map<string, CreativeTypeLaneGroup>();
  for (const ct of creativeTypes ?? []) {
    if (!ct || ct.active !== true) continue;
    const lane = (ct.lane ?? "").trim();
    const typeName = (ct.type_name ?? "").trim();
    if (lane.length === 0 || typeName.length === 0) continue;
    let group = byLane.get(lane);
    if (!group) {
      group = { lane, types: [] };
      byLane.set(lane, group);
      groups.push(group);
    }
    group.types.push({ value: typeName, label: typeName });
  }
  return groups;
}

/**
 * The body vocabulary as a de-duplicated, order-preserving list. There is no
 * dedicated body table — the vocabulary is the set of body values already in use
 * on the account's creatives (plus whatever the caller has seen). Blanks are
 * dropped; de-dup is exact (values are display-cased, like the tag columns).
 */
export function buildBodyOptions(
  bodies: ReadonlyArray<string | null | undefined> | null | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of bodies ?? []) {
    if (typeof b !== "string") continue;
    const v = b.trim();
    if (v.length === 0 || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Assemble the full governed option set for an account from the taxonomy read
 * payload plus the observed body values. hook stays the static vocabulary.
 */
export function buildAccountTagOptions(
  taxonomy: AccountTaxonomy | null | undefined,
  bodies?: ReadonlyArray<string | null | undefined> | null,
): AccountTagOptions {
  return {
    themes: buildThemeOptions(taxonomy?.themes),
    creativeTypeGroups: buildCreativeTypeGroups(taxonomy?.creative_types),
    bodies: buildBodyOptions(bodies),
    hooks: HOOK_OPTIONS,
  };
}
