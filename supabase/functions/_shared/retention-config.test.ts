// US-001: Unit tests for the long-horizon retention constants.
//
//   deno test supabase/functions/_shared/retention-config.test.ts
//
// Deno edge tests are manual, not part of the vitest CI gate
// (verdanote-deno-edge-tests-are-manual-not-in-ci-vitest). These lock the
// single-source-of-truth values so later stories that import them (US-002/004/006)
// don't silently drift the retention window.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RECENT_WINDOW_DAYS, RETENTION_DAYS, TRIM_BUFFER_DAYS } from "./retention-config.ts";

Deno.test("RETENTION_DAYS is the 365-day promised window", () => {
  assertEquals(RETENTION_DAYS, 365);
});

Deno.test("RECENT_WINDOW_DAYS is the 28-day rolling incremental window", () => {
  assertEquals(RECENT_WINDOW_DAYS, 28);
});

Deno.test("TRIM_BUFFER_DAYS is 400 (365 promise + 35d buffer)", () => {
  assertEquals(TRIM_BUFFER_DAYS, 400);
});

Deno.test("trim buffer strictly exceeds the retention promise", () => {
  // The nightly trim must never delete an in-year row.
  assertEquals(TRIM_BUFFER_DAYS > RETENTION_DAYS, true);
});

Deno.test("recent window is far smaller than the full retention window (the cost win)", () => {
  assertEquals(RECENT_WINDOW_DAYS < RETENTION_DAYS, true);
});
