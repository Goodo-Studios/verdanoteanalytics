//   deno test supabase/functions/_shared/name-sync-logic.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNameSyncChange,
  nameSyncUpdate,
  needsAutoParse,
  SYNC_FROM_NAME_MAX_IDS,
  validateSyncFromNameBody,
} from "./name-sync-logic.ts";
import { goodoConvention } from "./goodo-convention.fixture.ts";

// ── rename re-parse decision ────────────────────────────────────────────────

Deno.test("needsAutoParse: new ad (never parsed) is parsed", () => {
  assertEquals(needsAutoParse({ tag_source: "untagged", ad_name: "GS1_Video", parsed_ad_name: null }), true);
});

Deno.test("needsAutoParse: renamed parsed / untagged ads are re-parsed", () => {
  assertEquals(needsAutoParse({ tag_source: "parsed", ad_name: "GS1_Static", parsed_ad_name: "GS1_Video" }), true);
  assertEquals(needsAutoParse({ tag_source: "untagged", ad_name: "GS1_Static", parsed_ad_name: "GS1_Video" }), true);
});

Deno.test("needsAutoParse: unchanged name is not re-parsed (no catch-up)", () => {
  assertEquals(needsAutoParse({ tag_source: "parsed", ad_name: "GS1_Video", parsed_ad_name: "GS1_Video" }), false);
  assertEquals(needsAutoParse({ tag_source: "untagged", ad_name: "GS1_Video", parsed_ad_name: "GS1_Video" }), false);
});

Deno.test("needsAutoParse: manual is never touched, even when renamed", () => {
  assertEquals(needsAutoParse({ tag_source: "manual", ad_name: "GS1_Static", parsed_ad_name: "GS1_Video" }), false);
  assertEquals(needsAutoParse({ tag_source: "manual", ad_name: "GS1_Static", parsed_ad_name: null }), false);
});

Deno.test("needsAutoParse: csv_match / ai / legacy sources are left alone", () => {
  for (const src of ["csv_match", "csv", "ai", "inferred"]) {
    assertEquals(needsAutoParse({ tag_source: src, ad_name: "GS1_Static", parsed_ad_name: "x" }), false);
  }
});

Deno.test("needsAutoParse: empty / missing name is skipped", () => {
  assertEquals(needsAutoParse({ tag_source: "untagged", ad_name: "", parsed_ad_name: null }), false);
  assertEquals(needsAutoParse({ tag_source: "untagged", ad_name: null, parsed_ad_name: null }), false);
});

Deno.test("needsAutoParse: untagged row with a Coda mapping is retried even if unchanged", () => {
  const row = { tag_source: "untagged", ad_name: "GS1_Video", parsed_ad_name: "GS1_Video" };
  assertEquals(needsAutoParse(row, true), true);
  assertEquals(needsAutoParse(row, false), false);
  // ...but a mapping never re-opens a parsed or manual row whose name is unchanged.
  assertEquals(needsAutoParse({ ...row, tag_source: "parsed" }, true), false);
  assertEquals(needsAutoParse({ ...row, tag_source: "manual" }, true), false);
});

// ── sync-from-name diff ─────────────────────────────────────────────────────

const NAME = "GS200001_Image_NoTalent_UGCNative_WeightedBlanket_TiredBy3pm_BedtimeRoutine";

Deno.test("buildNameSyncChange overwrites manual values with what the name says", () => {
  const c = buildNameSyncChange({
    ad_id: "a1", ad_name: NAME,
    ad_type: "Video", person: "Creator", style: "Studio Clean", product: "Other", hook: "Old", theme: null,
  }, goodoConvention);
  assertEquals(c.id, "a1");
  assertEquals(c.ad_name, NAME);
  assertEquals(c.before, {
    ad_type: "Video", person: "Creator", style: "Studio Clean", product: "Other", hook: "Old", theme: null,
  });
  assertEquals(c.after, {
    ad_type: "Static", person: "No Talent", style: "UGC Native",
    product: "Weighted Blanket", hook: "Tired By 3pm", theme: "Bedtime Routine",
  });
  assertEquals(c.changed, true);
  assertEquals(c.unique_code, "GS200001");
});

Deno.test("buildNameSyncChange: segments the name lacks become null", () => {
  const c = buildNameSyncChange({
    ad_id: "a2", ad_name: "GS2_Video_Creator",
    ad_type: "Video", person: "Creator", style: "UGC Native", product: "P", hook: "H", theme: "T",
  }, goodoConvention);
  assertEquals(c.after, { ad_type: "Video", person: "Creator", style: null, product: null, hook: null, theme: null });
  assertEquals(c.changed, true);
});

Deno.test("buildNameSyncChange: identical tags -> changed=false", () => {
  const c = buildNameSyncChange({
    ad_id: "a3", ad_name: NAME,
    ad_type: "Static", person: "No Talent", style: "UGC Native",
    product: "Weighted Blanket", hook: "Tired By 3pm", theme: "Bedtime Routine",
  }, goodoConvention);
  assertEquals(c.changed, false);
});

Deno.test("buildNameSyncChange: stored legacy 'Image' differs from 'Static'", () => {
  const c = buildNameSyncChange({ ad_id: "a4", ad_name: "GS4_Image", ad_type: "Image" }, goodoConvention);
  assertEquals(c.before.ad_type, "Image");
  assertEquals(c.after.ad_type, "Static");
  assertEquals(c.changed, true);
});

Deno.test("buildNameSyncChange: empty-string columns count as null", () => {
  const c = buildNameSyncChange({ ad_id: "a5", ad_name: "GS5_Video", ad_type: "Video", hook: "" }, goodoConvention);
  assertEquals(c.before.hook, null);
  assertEquals(c.changed, false);
});

Deno.test("nameSyncUpdate writes six tags + tag_source parsed + parsed_ad_name", () => {
  const c = buildNameSyncChange({ ad_id: "a6", ad_name: "GS6_Video_Creator", style: "UGC Native" }, goodoConvention);
  assertEquals(nameSyncUpdate(c), {
    ad_type: "Video", person: "Creator", style: null, product: null, hook: null, theme: null,
    tag_source: "parsed", unique_code: "GS6", parsed_ad_name: "GS6_Video_Creator",
  });
});

// ── request validation ──────────────────────────────────────────────────────

Deno.test("validateSyncFromNameBody: accepts ids + dry_run, de-dupes", () => {
  assertEquals(validateSyncFromNameBody({ ids: ["a", "b", "a"], dry_run: true }), { ok: true, ids: ["a", "b"], dry_run: true });
  assertEquals(validateSyncFromNameBody({ ids: ["a"] }), { ok: true, ids: ["a"], dry_run: false });
});

Deno.test("validateSyncFromNameBody: rejects bad input", () => {
  for (const body of [null, "x", {}, { ids: [] }, { ids: "a" }, { ids: [1] }, { ids: [""] }, { ids: ["a"], dry_run: "yes" }]) {
    assertEquals(validateSyncFromNameBody(body).ok, false);
  }
});

Deno.test("validateSyncFromNameBody: max 500 ids", () => {
  const ok = Array.from({ length: SYNC_FROM_NAME_MAX_IDS }, (_, i) => `id${i}`);
  assertEquals(validateSyncFromNameBody({ ids: ok, dry_run: true }).ok, true);
  assertEquals(validateSyncFromNameBody({ ids: [...ok, "one-more"], dry_run: true }).ok, false);
});
