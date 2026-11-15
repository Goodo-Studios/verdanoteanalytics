//   deno test supabase/functions/_shared/report-input.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  inclusiveDays,
  isIsoDate,
  MAX_REPORT_RANGE_DAYS,
  validateAccountIds,
  validateDateRange,
} from "./report-input.ts";

Deno.test("isIsoDate accepts real dates and rejects everything else", () => {
  const good = ["2026-01-01", "2024-02-29", "2026-12-31"];
  const bad = ["2026-02-30", "2025-02-29", "2026-13-01", "2026-1-1", "26-01-01", "banana", "", "2026-01-01T00:00:00Z", null, undefined, 20260101];
  for (const g of good) assertEquals(isIsoDate(g), true, String(g));
  for (const b of bad) assertEquals(isIsoDate(b), false, String(b));
});

Deno.test("inclusiveDays counts both ends, across a DST change", () => {
  assertEquals(inclusiveDays("2026-03-01", "2026-03-01"), 1);
  assertEquals(inclusiveDays("2026-03-01", "2026-03-07"), 7);
  assertEquals(inclusiveDays("2026-03-07", "2026-03-10"), 4);
  assertEquals(inclusiveDays("2026-01-01", "2026-12-31"), 365);
});

const defaults = { start: "2026-11-07", end: "2026-11-14" };

Deno.test("validateDateRange table", () => {
  const cases: Array<{ name: string; start: unknown; end: unknown; d?: typeof defaults; ok: boolean; days?: number }> = [
    { name: "valid week", start: "2026-11-01", end: "2026-11-07", ok: true, days: 7 },
    { name: "single day", start: "2026-11-01", end: "2026-11-01", ok: true, days: 1 },
    { name: "defaults fill missing", start: undefined, end: undefined, d: defaults, ok: true, days: 8 },
    { name: "empty strings use defaults", start: "", end: "", d: defaults, ok: true, days: 8 },
    { name: "missing without defaults", start: undefined, end: "2026-11-01", ok: false },
    { name: "garbage start", start: "banana", end: "2026-11-07", ok: false },
    { name: "garbage end", start: "2026-11-01", end: "2026-02-30", ok: false },
    { name: "non-string", start: 5, end: {}, ok: false },
    { name: "reversed", start: "2026-11-07", end: "2026-11-01", ok: false },
    { name: "max range allowed", start: "2025-01-01", end: "2026-01-01", ok: true, days: 366 },
    { name: "over the cap", start: "2024-01-01", end: "2026-01-01", ok: false },
  ];
  for (const c of cases) {
    const r = validateDateRange(c.start, c.end, c.d);
    assertEquals(r.ok, c.ok, c.name);
    if (r.ok) assertEquals(r.days, c.days, c.name);
    else assertEquals(typeof r.error, "string");
  }
  assertEquals(MAX_REPORT_RANGE_DAYS, 366);
});

Deno.test("validateAccountIds table", () => {
  const ok = validateAccountIds(["act_1", "act_2", "act_1"]);
  assertEquals(ok.ok, true);
  if (ok.ok) assertEquals(ok.accountIds, ["act_1", "act_2"]);

  assertEquals(validateAccountIds(undefined).ok, false);
  assertEquals(validateAccountIds("act_1").ok, false);
  assertEquals(validateAccountIds([]).ok, false);
  assertEquals(validateAccountIds([1, 2]).ok, false);
  assertEquals(validateAccountIds(["act_1", ""]).ok, false);
  assertEquals(validateAccountIds(["act_1,act_2"]).ok, false);
  assertEquals(validateAccountIds(["a".repeat(65)]).ok, false);
  assertEquals(validateAccountIds(["act_1", "act_1"], { min: 2 }).ok, false);
  assertEquals(validateAccountIds(["act_1", "act_2"], { min: 2 }).ok, true);
  assertEquals(validateAccountIds(["a", "b", "c"], { max: 2 }).ok, false);
});
