// Tests for ClickUp dates read in the studio zone.
//
//   deno test -A supabase/functions/_shared/clickup-dates.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clickupMsToDate } from "./clickup-dates.ts";
import { dateToMs } from "./os-clickup-writeback.ts";
import { msToDate } from "./os-task-map.ts";
import { toIsoDate } from "./clickup-pipeline.ts";

const at = (iso: string) => Date.parse(iso);

Deno.test("a due time in the evening Eastern is that Eastern day, not the next UTC day", () => {
  // 11 pm EST on 20 Nov is 04:00 UTC on 21 Nov.
  assertEquals(clickupMsToDate(at("2026-11-21T04:00:00Z")), "2026-11-20");
  // 8 pm EDT on 10 Jun is exactly 00:00 UTC on 11 Jun.
  assertEquals(clickupMsToDate(at("2026-06-11T00:00:00Z")), "2026-06-10");
  // 11:59 pm EDT.
  assertEquals(clickupMsToDate(at("2026-06-11T03:59:00Z")), "2026-06-10");
  // Midnight Eastern starts the next day.
  assertEquals(clickupMsToDate(at("2026-06-11T04:00:00Z")), "2026-06-11");
});

Deno.test("daytime Eastern times keep their day", () => {
  assertEquals(clickupMsToDate(at("2026-11-20T17:00:00Z")), "2026-11-20"); // noon EST
  assertEquals(clickupMsToDate(at("2026-02-28T23:00:00Z")), "2026-02-28"); // 6 pm EST
});

Deno.test("daylight saving changes fall on the right day", () => {
  // Fall back, 1 Nov 2026: EDT ends at 06:00 UTC.
  assertEquals(clickupMsToDate(at("2026-11-01T03:59:00Z")), "2026-10-31"); // 23:59 EDT
  assertEquals(clickupMsToDate(at("2026-11-01T04:00:00Z")), "2026-11-01"); // 00:00 EDT
  assertEquals(clickupMsToDate(at("2026-11-02T04:59:00Z")), "2026-11-01"); // 23:59 EST
  assertEquals(clickupMsToDate(at("2026-11-02T05:00:00Z")), "2026-11-02"); // 00:00 EST
  // Spring forward, 8 Mar 2026: EST ends at 07:00 UTC.
  assertEquals(clickupMsToDate(at("2026-03-08T04:59:00Z")), "2026-03-07"); // 23:59 EST
  assertEquals(clickupMsToDate(at("2026-03-08T05:00:00Z")), "2026-03-08"); // 00:00 EST
  assertEquals(clickupMsToDate(at("2026-03-09T03:59:00Z")), "2026-03-08"); // 23:59 EDT
});

Deno.test("date-only values set by an Eastern user (start of their day) read as that day", () => {
  assertEquals(clickupMsToDate(at("2026-11-20T05:00:00Z")), "2026-11-20"); // 00:00 EST
  assertEquals(clickupMsToDate(at("2026-06-10T04:00:00Z")), "2026-06-10"); // 00:00 EDT
});

Deno.test("what this app writes for a date reads back as the same date, every day of the year", () => {
  for (let day = 0; day < 366; day++) {
    const iso = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
    assertEquals(msToDate(dateToMs(iso)), iso);
  }
});

Deno.test("documented limitation: a date-only value set east of UTC still reads a day early", () => {
  // 20 Nov at 00:00 in Berlin (UTC+1) is 23:00 UTC on 19 Nov, 18:00 Eastern on 19 Nov. ClickUp
  // does not say which zone set it, so this is left as it was rather than guessed at.
  assertEquals(clickupMsToDate(at("2026-11-19T23:00:00Z")), "2026-11-19");
});

Deno.test("missing and bad values are null, and strings of digits work", () => {
  for (const v of [null, undefined, "", "abc", 0, "0", -5, NaN]) assertEquals(clickupMsToDate(v), null);
  assertEquals(clickupMsToDate(String(at("2026-11-21T04:00:00Z"))), "2026-11-20");
});

Deno.test("the task mapper and the pipeline use the same rule", () => {
  const ms = at("2026-11-21T04:00:00Z");
  assertEquals(msToDate(ms), "2026-11-20");
  assertEquals(toIsoDate(ms), "2026-11-20");
  assertEquals(toIsoDate(String(ms)), "2026-11-20");
});
