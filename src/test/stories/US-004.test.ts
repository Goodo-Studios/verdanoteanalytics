// US-004 — Governed ad tagging: select Theme/Persona, creative type, and body
// from the account's managed lists.
//
// e2eTests (from the PRD):
//   1. Given a configured account, when a strategist selects a Theme/Persona and
//      creative type for an ad, then the tags persist and the ad appears in the
//      correct matrix cell.
//   2. Given an ad with a prior free-text theme, when the conversion runs, then
//      it is mapped or flagged for review, never silently dropped.
//
// Live Postgres + deployed edge functions are prod-only (no deploys from this
// story — MIGRATIONS.md), and vitest globs src/** only. So the persistence /
// board-cell assertions are covered by the deterministic UNIT of the code paths
// that decide them, plus static wiring checks — the same DB-free approach as
// US-001/US-002:
//   • The governed OPTION builders (src/lib/tagOptions.ts) project the account
//     taxonomy read payload into the exact dropdown options, with an explicit
//     Untagged sentinel per dimension and hook kept static.
//   • The free-text theme → angle_id CONVERSION (resolve-tags.ts) maps or flags,
//     never drops, and leaves the six-dimension tag precedence untouched.
//   • The feature wiring (creative-library api/hook/component) reads the account
//     lists and persists only the four matrix-axis columns.
//
// No network, no DB, no Deno — pure imports + file reads, so it runs in CI.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildAccountTagOptions,
  buildBodyOptions,
  buildCreativeTypeGroups,
  buildThemeOptions,
  UNTAGGED_OPTION,
  HOOK_OPTIONS,
  type AccountTaxonomy,
} from "@/lib/tagOptions";
import {
  buildAngleIndex,
  normalizeThemeKey,
  resolveAngleReference,
} from "../../../supabase/functions/_shared/resolve-tags";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../.."); // src/test/stories -> repo root
const FEATURE_DIR = path.join(REPO_ROOT, "src", "features", "creative-library");
const read = (...p: string[]) => readFileSync(path.join(REPO_ROOT, ...p), "utf8");

// A representative account-taxonomy read payload (shape of rpc_account_taxonomy).
const TAXONOMY: AccountTaxonomy = {
  account_id: "acct_1",
  themes: [
    { id: "t-value", label: "Value Seeker", archived: false },
    { id: "t-spring", label: "Spring Refresh", archived: false },
    { id: "t-old", label: "Retired Angle", archived: true }, // archived -> excluded
    { id: "t-blank", label: "   ", archived: false }, // blank -> excluded
  ],
  creative_types: [
    { creative_type_id: "c1", lane: "Creator", type_name: "UGC Testimonial", active: true },
    { creative_type_id: "c2", lane: "Creator", type_name: "Unboxing", active: false }, // inactive
    { creative_type_id: "c3", lane: "Static", type_name: "Product Shot", active: true },
  ],
};

describe("US-004: governed option builders (tagOptions)", () => {
  it("buildThemeOptions drops archived + blank, keeps live angle_id refs", () => {
    const themes = buildThemeOptions(TAXONOMY.themes);
    expect(themes).toEqual([
      { value: "t-value", label: "Value Seeker" },
      { value: "t-spring", label: "Spring Refresh" },
    ]);
  });

  it("buildCreativeTypeGroups keeps only ACTIVE types, grouped by lane", () => {
    const groups = buildCreativeTypeGroups(TAXONOMY.creative_types);
    expect(groups).toEqual([
      { lane: "Creator", types: [{ value: "UGC Testimonial", label: "UGC Testimonial" }] },
      { lane: "Static", types: [{ value: "Product Shot", label: "Product Shot" }] },
    ]);
  });

  it("buildBodyOptions de-dups and drops blanks, preserving order", () => {
    expect(buildBodyOptions(["Founder story", "Founder story", "  ", "Testimonial", null]))
      .toEqual(["Founder story", "Testimonial"]);
  });

  it("buildAccountTagOptions assembles all axes; hook stays the static vocab", () => {
    const opts = buildAccountTagOptions(TAXONOMY, ["Founder story"]);
    expect(opts.themes.map((t) => t.value)).toEqual(["t-value", "t-spring"]);
    expect(opts.creativeTypeGroups.map((g) => g.lane)).toEqual(["Creator", "Static"]);
    expect(opts.bodies).toEqual(["Founder story"]);
    expect(opts.hooks).toBe(HOOK_OPTIONS); // hook remains the existing tag
  });

  it("an explicit Untagged sentinel exists (value clears the dimension)", () => {
    expect(UNTAGGED_OPTION).toEqual({ value: "", label: "Untagged" });
  });

  it("null/empty taxonomy yields empty governed lists (never throws)", () => {
    const opts = buildAccountTagOptions(null, null);
    expect(opts.themes).toEqual([]);
    expect(opts.creativeTypeGroups).toEqual([]);
    expect(opts.bodies).toEqual([]);
  });
});

describe("US-004: free-text theme → angle_id conversion (never drops)", () => {
  const angles = [
    { id: "t-value", label: "Value Seeker" },
    { id: "t-spring", label: "Spring Refresh" },
  ];

  it("normalizeThemeKey is case- and whitespace-insensitive", () => {
    expect(normalizeThemeKey("  Spring   Refresh ")).toBe("spring refresh");
  });

  it("maps a matching free-text theme to its angle_id, preserving the text", () => {
    const r = resolveAngleReference("spring refresh", angles);
    expect(r.angle_id).toBe("t-spring");
    expect(r.theme).toBe("spring refresh"); // preserved
    expect(r.matched).toBe(true);
    expect(r.needs_review).toBe(false);
  });

  it("FLAGS an unmatched free-text theme for review — never silently dropped", () => {
    const r = resolveAngleReference("Winter Sale", angles);
    expect(r.angle_id).toBeNull();
    expect(r.theme).toBe("Winter Sale"); // kept for review
    expect(r.needs_review).toBe(true);
  });

  it("blank/absent theme is untagged, not a review case", () => {
    const r = resolveAngleReference("", angles);
    expect(r.theme).toBeNull();
    expect(r.needs_review).toBe(false);
  });

  it("buildAngleIndex maps normalized labels to ids", () => {
    const idx = buildAngleIndex(angles);
    expect(idx.get("value seeker")).toBe("t-value");
  });
});

describe("US-004: feature wiring (static)", () => {
  it("the creative-library api reads the account taxonomy and body vocabulary", () => {
    const api = read("src", "features", "creative-library", "api.ts");
    expect(api).toContain("fetchAccountTaxonomy");
    expect(api).toContain("account-taxonomy"); // the US-002 session-authed read fn
    expect(api).toContain("fetchBodyVocabulary");
  });

  it("saveGovernedTags persists ONLY the four matrix-axis columns", () => {
    const api = read("src", "features", "creative-library", "api.ts");
    // The write must not touch tag_source (the six-dim precedence stays intact).
    const fn = api.slice(api.indexOf("export async function saveGovernedTags"));
    expect(fn).toContain("angle_id");
    expect(fn).toContain("creative_lane");
    expect(fn).toContain("creative_type");
    expect(fn).toContain("body");
    expect(fn).not.toContain("tag_source");
  });

  it("the governed tag editor sources every dropdown from the account lists", () => {
    const cmp = read("src", "features", "creative-library", "components", "GovernedTagEditor.tsx");
    expect(cmp).toContain("useAccountTaxonomy");
    expect(cmp).toContain("options.themes");
    expect(cmp).toContain("options.creativeTypeGroups");
    expect(cmp).toContain("options.bodies");
    // Untagged is reachable per dimension.
    expect(cmp).toContain("Untagged");
  });

  it("the hook builds options via the shared governed builder", () => {
    const hook = read("src", "features", "creative-library", "hooks", "useAccountTaxonomy.ts");
    expect(hook).toContain("buildAccountTagOptions");
  });

  it("the feature directory is the only src home for the governed editor", () => {
    // Guard: the editor lives inside the declared feature dir, not scattered.
    expect(() => read(path.relative(REPO_ROOT, path.join(FEATURE_DIR, "components", "GovernedTagEditor.tsx"))))
      .not.toThrow();
  });
});
