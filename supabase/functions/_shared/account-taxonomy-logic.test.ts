// US-002: Unit tests for the pure account-taxonomy logic.
//
//   deno test supabase/functions/_shared/account-taxonomy-logic.test.ts
//
// Covers name normalization, review-mining source detection, seed-source
// selection (never fabricates — empty when no real source), and request
// validation for every action. No network / DB — pure functions only.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ORIGIN_MANUAL,
  normalizeTaxonomyName,
  isReviewMiningSource,
  selectSeedFromRows,
  parseTaxonomyRequest,
  MAX_NAME_LENGTH,
} from "./account-taxonomy-logic.ts";

// ── normalizeTaxonomyName ────────────────────────────────────────────────────
Deno.test("normalizeTaxonomyName trims and collapses internal whitespace", () => {
  assertEquals(normalizeTaxonomyName("  Busy   Parents \n"), "Busy Parents");
});

Deno.test("normalizeTaxonomyName returns null for empty / whitespace / non-string", () => {
  assertEquals(normalizeTaxonomyName(""), null);
  assertEquals(normalizeTaxonomyName("   "), null);
  assertEquals(normalizeTaxonomyName(undefined), null);
  assertEquals(normalizeTaxonomyName(42), null);
});

Deno.test("normalizeTaxonomyName caps at MAX_NAME_LENGTH", () => {
  const long = "a".repeat(MAX_NAME_LENGTH + 50);
  assertEquals(normalizeTaxonomyName(long)?.length, MAX_NAME_LENGTH);
});

// ── isReviewMiningSource ─────────────────────────────────────────────────────
Deno.test("isReviewMiningSource recognizes csv and csv:<batch>", () => {
  assertEquals(isReviewMiningSource("csv"), true);
  assertEquals(isReviewMiningSource("csv:batch-2026-07"), true);
});

Deno.test("isReviewMiningSource rejects manual and other origins", () => {
  assertEquals(isReviewMiningSource(ORIGIN_MANUAL), false);
  assertEquals(isReviewMiningSource("bid"), false);
  assertEquals(isReviewMiningSource(null), false);
  assertEquals(isReviewMiningSource(undefined), false);
});

// ── selectSeedFromRows ───────────────────────────────────────────────────────
Deno.test("selectSeedFromRows picks only review-mining rows as the seed", () => {
  const sel = selectSeedFromRows([
    { id: "a", source: "csv" },
    { id: "b", source: "csv:batch1" },
    { id: "c", source: "manual" },
    { id: "d", source: null },
  ]);
  assertEquals(sel.seededIds, ["a", "b"]);
  assertEquals(sel.reviewMiningCount, 2);
  assertEquals(sel.empty, false);
});

Deno.test("selectSeedFromRows is empty (never fabricated) when no review-mining rows", () => {
  assertEquals(selectSeedFromRows([{ id: "c", source: "manual" }]).empty, true);
  assertEquals(selectSeedFromRows([]).empty, true);
  assertEquals(selectSeedFromRows(null).empty, true);
  assertEquals(selectSeedFromRows(undefined).seededIds, []);
});

// ── parseTaxonomyRequest ─────────────────────────────────────────────────────
Deno.test("parseTaxonomyRequest requires account_id", () => {
  assertEquals(parseTaxonomyRequest({ action: "list" }, "").ok, false);
  assertEquals(parseTaxonomyRequest({ action: "list" }, undefined).ok, false);
});

Deno.test("parseTaxonomyRequest rejects a bad body / unknown action", () => {
  assertEquals(parseTaxonomyRequest(null, "acct").ok, false);
  assertEquals(parseTaxonomyRequest({ action: "nuke" }, "acct").ok, false);
});

Deno.test("parseTaxonomyRequest: list / seed need only account_id", () => {
  const list = parseTaxonomyRequest({ action: "list" }, "acct");
  assertEquals(list.ok, true);
  assertEquals(list.action, "list");
  assertEquals(list.accountId, "acct");
  assertEquals(parseTaxonomyRequest({ action: "seed" }, "acct").ok, true);
});

Deno.test("parseTaxonomyRequest: create normalizes the name and rejects empty", () => {
  const ok = parseTaxonomyRequest({ action: "create", name: "  Value   Seekers " }, "acct");
  assertEquals(ok.ok, true);
  assertEquals(ok.name, "Value Seekers");
  assertEquals(parseTaxonomyRequest({ action: "create", name: "  " }, "acct").ok, false);
});

Deno.test("parseTaxonomyRequest: rename needs angle_id AND a valid name", () => {
  const ok = parseTaxonomyRequest({ action: "rename", angle_id: "x1", name: "New" }, "acct");
  assertEquals(ok.ok, true);
  assertEquals(ok.angleId, "x1");
  assertEquals(ok.name, "New");
  assertEquals(parseTaxonomyRequest({ action: "rename", name: "New" }, "acct").ok, false);
  assertEquals(parseTaxonomyRequest({ action: "rename", angle_id: "x1" }, "acct").ok, false);
});

Deno.test("parseTaxonomyRequest: archive / unarchive need angle_id", () => {
  assertEquals(parseTaxonomyRequest({ action: "archive", angle_id: "x1" }, "acct").ok, true);
  assertEquals(parseTaxonomyRequest({ action: "unarchive", angle_id: "x1" }, "acct").ok, true);
  assertEquals(parseTaxonomyRequest({ action: "archive" }, "acct").ok, false);
});

Deno.test("parseTaxonomyRequest: set_creative_type needs creative_type_id + boolean active", () => {
  const on = parseTaxonomyRequest(
    { action: "set_creative_type", creative_type_id: "t1", active: true },
    "acct",
  );
  assertEquals(on.ok, true);
  assertEquals(on.creativeTypeId, "t1");
  assertEquals(on.active, true);
  // missing active
  assertEquals(
    parseTaxonomyRequest({ action: "set_creative_type", creative_type_id: "t1" }, "acct").ok,
    false,
  );
  // non-boolean active
  assertEquals(
    parseTaxonomyRequest(
      { action: "set_creative_type", creative_type_id: "t1", active: "yes" },
      "acct",
    ).ok,
    false,
  );
});
