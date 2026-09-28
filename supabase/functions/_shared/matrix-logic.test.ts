// US-006: Unit tests for the pure creative-matrix param logic.
//
//   deno test supabase/functions/_shared/matrix-logic.test.ts
//
// Covers required account_id, strict YYYY-MM-DD shape, real-calendar-date
// rejection (2026-02-30 etc.), date ordering, and null normalization for
// absent params. No network / DB — pure functions only.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isValidCalendarDate,
  isValidUuid,
  parseMatrixCellParams,
  parseMatrixParams,
} from "./matrix-logic.ts";

// ── isValidCalendarDate ──────────────────────────────────────────────────────
Deno.test("isValidCalendarDate accepts real dates including leap day", () => {
  assertEquals(isValidCalendarDate("2026-07-23"), true);
  assertEquals(isValidCalendarDate("2024-02-29"), true); // 2024 is a leap year
  assertEquals(isValidCalendarDate("2026-12-31"), true);
  assertEquals(isValidCalendarDate("2026-01-01"), true);
});

Deno.test("isValidCalendarDate rejects malformed shapes", () => {
  assertEquals(isValidCalendarDate("2026-7-23"), false);
  assertEquals(isValidCalendarDate("23-07-2026"), false);
  assertEquals(isValidCalendarDate("2026/07/23"), false);
  assertEquals(isValidCalendarDate("2026-07-23T00:00:00Z"), false);
  assertEquals(isValidCalendarDate(" 2026-07-23"), false);
  assertEquals(isValidCalendarDate("not-a-date"), false);
  assertEquals(isValidCalendarDate(""), false);
});

Deno.test("isValidCalendarDate rejects impossible calendar dates", () => {
  assertEquals(isValidCalendarDate("2026-02-30"), false);
  assertEquals(isValidCalendarDate("2026-02-29"), false); // 2026 is not a leap year
  assertEquals(isValidCalendarDate("2026-04-31"), false);
  assertEquals(isValidCalendarDate("2026-13-01"), false);
  assertEquals(isValidCalendarDate("2026-00-10"), false);
  assertEquals(isValidCalendarDate("2026-07-00"), false);
  assertEquals(isValidCalendarDate("2026-07-32"), false);
});

// ── parseMatrixParams: account_id ────────────────────────────────────────────
Deno.test("parseMatrixParams requires account_id", () => {
  assertEquals(parseMatrixParams(null, null, null).ok, false);
  assertEquals(parseMatrixParams("", null, null).ok, false);
  assertEquals(parseMatrixParams("   ", null, null).ok, false);
});

Deno.test("parseMatrixParams trims account_id and normalizes absent dates to null", () => {
  const res = parseMatrixParams(" act_123 ", null, null);
  assertEquals(res.ok, true);
  if (res.ok) {
    assertEquals(res.accountId, "act_123");
    assertEquals(res.dateFrom, null);
    assertEquals(res.dateTo, null);
  }
});

Deno.test("parseMatrixParams treats empty-string dates as absent (all-time)", () => {
  const res = parseMatrixParams("acct", "", "");
  assertEquals(res.ok, true);
  if (res.ok) {
    assertEquals(res.dateFrom, null);
    assertEquals(res.dateTo, null);
  }
});

// ── parseMatrixParams: date validation ───────────────────────────────────────
Deno.test("parseMatrixParams accepts a valid range and passes dates through", () => {
  const res = parseMatrixParams("acct", "2026-06-01", "2026-06-30");
  assertEquals(res.ok, true);
  if (res.ok) {
    assertEquals(res.dateFrom, "2026-06-01");
    assertEquals(res.dateTo, "2026-06-30");
  }
});

Deno.test("parseMatrixParams accepts one-sided ranges", () => {
  const fromOnly = parseMatrixParams("acct", "2026-06-01", null);
  assertEquals(fromOnly.ok, true);
  if (fromOnly.ok) {
    assertEquals(fromOnly.dateFrom, "2026-06-01");
    assertEquals(fromOnly.dateTo, null);
  }
  const toOnly = parseMatrixParams("acct", null, "2026-06-30");
  assertEquals(toOnly.ok, true);
  if (toOnly.ok) {
    assertEquals(toOnly.dateFrom, null);
    assertEquals(toOnly.dateTo, "2026-06-30");
  }
});

Deno.test("parseMatrixParams rejects malformed dates with a per-param error", () => {
  const badFrom = parseMatrixParams("acct", "06/01/2026", null);
  assertEquals(badFrom.ok, false);
  if (!badFrom.ok) assertEquals(badFrom.error, "date_from must be a valid YYYY-MM-DD date");

  const badTo = parseMatrixParams("acct", null, "2026-6-1");
  assertEquals(badTo.ok, false);
  if (!badTo.ok) assertEquals(badTo.error, "date_to must be a valid YYYY-MM-DD date");
});

Deno.test("parseMatrixParams rejects impossible calendar dates", () => {
  assertEquals(parseMatrixParams("acct", "2026-02-30", null).ok, false);
  assertEquals(parseMatrixParams("acct", null, "2026-13-01").ok, false);
});

Deno.test("parseMatrixParams rejects date_from after date_to", () => {
  const res = parseMatrixParams("acct", "2026-07-02", "2026-07-01");
  assertEquals(res.ok, false);
  if (!res.ok) assertEquals(res.error, "date_from must not be after date_to");
});

Deno.test("parseMatrixParams allows date_from equal to date_to (single day)", () => {
  assertEquals(parseMatrixParams("acct", "2026-07-01", "2026-07-01").ok, true);
});

// ── US-008: isValidUuid ──────────────────────────────────────────────────────
Deno.test("isValidUuid accepts well-formed UUIDs, rejects junk", () => {
  assertEquals(isValidUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301"), true);
  assertEquals(isValidUuid("3F2504E0-4F89-41D3-9A0C-0305E82C3301"), true); // case-insensitive
  assertEquals(isValidUuid("not-a-uuid"), false);
  assertEquals(isValidUuid("3f2504e0-4f89-41d3-9a0c"), false);
  assertEquals(isValidUuid(""), false);
});

// ── parseMatrixCellParams (Creative Type × Theme cell, split by hook) ───────
Deno.test("parseMatrixCellParams inherits account_id + date validation", () => {
  assertEquals(parseMatrixCellParams(null, null, null, null, null).ok, false);
  const badDate = parseMatrixCellParams("acct", null, null, "06/01/2026", null);
  assertEquals(badDate.ok, false);
  if (!badDate.ok) assertEquals(badDate.error, "date_from must be a valid YYYY-MM-DD date");
});

Deno.test("parseMatrixCellParams treats absent/blank creative_type + theme as the Other/untagged buckets", () => {
  const res = parseMatrixCellParams("acct", null, null, null, null);
  assertEquals(res.ok, true);
  if (res.ok) {
    assertEquals(res.creativeType, null);
    assertEquals(res.theme, null);
  }
  const empties = parseMatrixCellParams("acct", "", "   ", null, null);
  assertEquals(empties.ok, true);
  if (empties.ok) {
    assertEquals(empties.creativeType, null);
    assertEquals(empties.theme, null);
  }
});

Deno.test("parseMatrixCellParams passes a creative type + free-text theme through (trimmed)", () => {
  const res = parseMatrixCellParams(
    "acct",
    "UGC Native",
    "  Tired By 3pm ",
    "2026-06-01",
    "2026-06-30",
  );
  assertEquals(res.ok, true);
  if (res.ok) {
    assertEquals(res.creativeType, "UGC Native");
    assertEquals(res.theme, "Tired By 3pm");
    assertEquals(res.dateFrom, "2026-06-01");
    assertEquals(res.dateTo, "2026-06-30");
  }
});

Deno.test("parseMatrixCellParams rejects over-long selectors", () => {
  const long = "x".repeat(501);
  const badTheme = parseMatrixCellParams("acct", "Lifestyle", long, null, null);
  assertEquals(badTheme.ok, false);
  if (!badTheme.ok) assertEquals(badTheme.error, "theme is too long");
  const badType = parseMatrixCellParams("acct", long, null, null, null);
  assertEquals(badType.ok, false);
  if (!badType.ok) assertEquals(badType.error, "creative_type is too long");
});
