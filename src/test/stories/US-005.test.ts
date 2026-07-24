// US-005 — Backfill creative-type and AI-suggest body across the account.
//
// e2eTests (from the PRD):
//   1. Given an account with historical ads, when the backfill runs, then
//      creative_lane and creative_type coverage rises and no manual or csv tag is
//      demoted.
//
// Live Postgres + deployed edge functions are prod-only (no deploys from this
// story — MIGRATIONS.md), and vitest globs src/** only. So the "coverage rises /
// nothing demoted" behaviour is proven by the deterministic UNITS that decide it
// — the same DB-free approach as US-001/US-002/US-004:
//   • deriveMatrixTags — the deterministic ad_type + style + ad_format → lane/type
//     mapping that RUNS FIRST (no LLM, never guesses).
//   • suggestBody — the review-only body suggestion (framework / value_structure),
//     destined for tag_suggestions, never the body column.
//   • decideMatrixWrite — the FILL-ONLY-EMPTY no-demote guard. Simulated over a
//     representative account, it proves coverage can only rise and that a manual or
//     csv lane/type is never overwritten or cleared.
//   • Static wiring of backfill-retag/index.ts — it imports the derive helpers,
//     merges body into tag_suggestions (not the column), fires selfContinue()
//     UNCONDITIONALLY (gated only on the global drained terminator), and is
//     registered in the edge-function deploy script.
//
// No network, no DB, no Deno — pure imports + file reads, so it runs in CI.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  deriveMatrixTags,
  suggestBody,
  decideMatrixWrite,
  CREATIVE_LANES,
  type CurrentMatrixColumns,
} from "../../../supabase/functions/_shared/derive-creative-tags";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../.."); // src/test/stories -> repo root
const read = (...p: string[]) => readFileSync(path.join(REPO_ROOT, ...p), "utf8");

describe("US-005: deterministic lane/type mapping (runs first, never guesses)", () => {
  it("maps the five house lanes from ad_type + style + ad_format", () => {
    expect(deriveMatrixTags({ ad_type: "Static" }).creative_lane).toBe("Static");
    expect(deriveMatrixTags({ ad_type: "GIF" }).creative_lane).toBe("Motion");
    expect(deriveMatrixTags({ ad_type: "Video", ad_format: "Animated explainer" }).creative_lane).toBe("Motion");
    expect(deriveMatrixTags({ ad_type: "Video", ad_format: "Reaction edit" }).creative_lane).toBe("Video edits");
    expect(deriveMatrixTags({ ad_type: "Video", style: "UGC Native" }).creative_lane).toBe("Creator");
    expect(deriveMatrixTags({ ad_type: "Video" }).creative_lane).toBe("Studio video");
  });

  it("a still image stays in the Static production lane even when UGC-styled", () => {
    expect(deriveMatrixTags({ ad_type: "Static", style: "UGC Native" }).creative_lane).toBe("Static");
  });

  it("resolves a specific creative_type from a clear keyword, else lane-only", () => {
    expect(deriveMatrixTags({ ad_type: "Video", ad_format: "Talking head" }).creative_type).toBe("Talking Head");
    expect(deriveMatrixTags({ ad_type: "Static", ad_format: "Product shot" }).creative_type).toBe("Product Shot");
    expect(deriveMatrixTags({ ad_type: "Video" }).creative_type).toBeNull(); // lane only
  });

  it("nothing recognizable → null lane + null type (deterministic, never guesses)", () => {
    expect(deriveMatrixTags({})).toEqual({ creative_lane: null, creative_type: null });
    expect(deriveMatrixTags({ ad_type: "???" })).toEqual({ creative_lane: null, creative_type: null });
  });

  it("exposes exactly the five house lanes", () => {
    expect([...CREATIVE_LANES]).toEqual(["Studio video", "Creator", "Static", "Motion", "Video edits"]);
  });
});

describe("US-005: body is AI review-only (framework / value_structure)", () => {
  it("suggests a named copywriting framework verbatim (high confidence)", () => {
    expect(suggestBody({ copywriting_framework: "PAS" })).toEqual({ value: "PAS", confidence: 0.6, signal: "script" });
  });

  it("falls back to a value_structure token when the framework is Other/absent", () => {
    expect(suggestBody({ copywriting_framework: "Other", value_structure: "before-after reveal" }))
      .toEqual({ value: "Before-After", confidence: 0.4, signal: "script" });
    expect(suggestBody({ value_structure: "customer testimonial montage" })?.value).toBe("Testimonial");
  });

  it("suggests nothing when neither field is recognizable (never dumps raw text)", () => {
    expect(suggestBody({})).toBeNull();
    expect(suggestBody({ copywriting_framework: "Other", value_structure: "a freeform sentence" })).toBeNull();
  });
});

describe("US-005 e2e: backfill raises coverage and demotes no manual/csv tag", () => {
  // A representative historical account: a mix of untagged, deterministically
  // placeable, manual, and csv rows. `protected` marks rows whose lane/type were
  // human/Coda-curated and MUST survive the sweep unchanged.
  interface Row {
    id: string;
    current: CurrentMatrixColumns;
    input: { ad_type?: string | null; style?: string | null; ad_format?: string | null };
    protectedTag: boolean; // true = manual/csv-sourced lane/type (must not be demoted)
  }
  const account: Row[] = [
    // Untagged video that deterministically becomes Studio video / Talking Head.
    { id: "a1", current: { creative_lane: null, creative_type: null }, input: { ad_type: "Video", ad_format: "Talking head" }, protectedTag: false },
    // Untagged static → Static / Product Shot.
    { id: "a2", current: { creative_lane: null, creative_type: null }, input: { ad_type: "Static", ad_format: "Product shot" }, protectedTag: false },
    // Untagged, unrecognizable → stays untagged (no false placement).
    { id: "a3", current: { creative_lane: null, creative_type: null }, input: {}, protectedTag: false },
    // MANUAL row whose deterministic signal is empty — must be PROTECTED.
    { id: "a4", current: { creative_lane: "Creator", creative_type: "UGC Testimonial" }, input: {}, protectedTag: true },
    // CSV row whose deterministic signal DISAGREES — the curated value must win.
    { id: "a5", current: { creative_lane: "Static", creative_type: "Lifestyle" }, input: { ad_type: "Video", ad_format: "Talking head" }, protectedTag: true },
  ];

  const laneTagged = (rows: { creative_lane: string | null }[]) => rows.filter((r) => r.creative_lane !== null).length;

  it("lane coverage strictly rises and every manual/csv tag is preserved", () => {
    const before = laneTagged(account.map((r) => r.current));

    const after = account.map((r) => {
      const decision = decideMatrixWrite(r.current, deriveMatrixTags(r.input));
      // The stored value after the write (fill-only-empty).
      const resolved = { creative_lane: decision.creative_lane, creative_type: decision.creative_type };

      // NO-DEMOTE invariant: a protected (manual/csv) tag must never change.
      if (r.protectedTag) {
        expect(resolved.creative_lane).toBe(r.current.creative_lane);
        expect(resolved.creative_type).toBe(r.current.creative_type);
      }
      // A demote is impossible for ANY row: a non-null column is never cleared.
      if (r.current.creative_lane !== null) expect(resolved.creative_lane).toBe(r.current.creative_lane);
      if (r.current.creative_type !== null) expect(resolved.creative_type).toBe(r.current.creative_type);

      return resolved;
    });

    const afterCount = laneTagged(after);
    expect(afterCount).toBeGreaterThan(before); // coverage rose
    // a1 + a2 filled; a3 still untagged; a4 + a5 preserved.
    expect(afterCount).toBe(4);
    expect(after[2].creative_lane).toBeNull(); // a3 not falsely placed
    expect(after[4].creative_lane).toBe("Static"); // a5 kept its csv lane, not "Studio video"
  });
});

describe("US-005: backfill-retag wiring (static)", () => {
  const index = read("supabase", "functions", "backfill-retag", "index.ts");

  it("imports the deterministic matrix + body helpers from the shared module", () => {
    expect(index).toContain("deriveMatrixTags");
    expect(index).toContain("suggestBody");
    expect(index).toContain("decideMatrixWrite");
    expect(index).toContain("derive-creative-tags.ts");
  });

  it("body is review-only: merged into tag_suggestions, never written to the body column", () => {
    expect(index).toContain("tag_suggestions");
    expect(index).toContain("body: suggestion");
    // The matrix pass must never write the creatives.body column directly.
    expect(index).not.toMatch(/rowUpdate\.body\s*=/);
  });

  it("fires selfContinue() UNCONDITIONALLY, gated only on the global drained terminator", () => {
    expect(index).toContain("async function selfContinue");
    // The ONLY gate on the continue is `if (!drained)` — no narrower sub-condition.
    expect(index).toMatch(/if \(!drained\) \{\s*await selfContinue\(/);
  });

  it("runs a coverage sweep with an explicit untagged bucket per new dimension", () => {
    expect(index).toContain("lane_untagged");
    expect(index).toContain("type_untagged");
    expect(index).toContain("matrix_coverage");
  });
});

describe("US-005: deploy-script registration (verdanote-supabase-add-function-update-deploy-script)", () => {
  it("backfill-retag is registered in the edge-function deploy script", () => {
    const deploy = read("scripts", "deploy-functions.sh");
    expect(deploy).toMatch(/^\s*backfill-retag\s*$/m);
  });
});
