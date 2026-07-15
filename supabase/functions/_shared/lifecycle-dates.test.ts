// F2 — unit tests for the lifecycle-date helpers.
//
//   deno test supabase/functions/_shared/lifecycle-dates.test.ts
//
// Deno edge tests are manual, not part of the vitest CI gate
// (verdanote-deno-edge-tests-are-manual-not-in-ci-vitest).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCreatedTimeUrl,
  createdTimeToLaunchDate,
  extractLaunchDates,
} from "./lifecycle-dates.ts";

Deno.test("createdTimeToLaunchDate: ISO with +0000 offset → UTC date", () => {
  assertEquals(createdTimeToLaunchDate("2026-01-02T10:30:00+0000"), "2026-01-02");
});

Deno.test("createdTimeToLaunchDate: crosses UTC day at negative offset", () => {
  // 2026-01-02 23:30 -05:00 == 2026-01-03 04:30 UTC → UTC day is the 3rd.
  assertEquals(createdTimeToLaunchDate("2026-01-02T23:30:00-05:00"), "2026-01-03");
});

Deno.test("createdTimeToLaunchDate: null / empty / garbage → null", () => {
  assertEquals(createdTimeToLaunchDate(null), null);
  assertEquals(createdTimeToLaunchDate(undefined), null);
  assertEquals(createdTimeToLaunchDate(""), null);
  assertEquals(createdTimeToLaunchDate("not-a-date"), null);
});

Deno.test("buildCreatedTimeUrl: requests only created_time and encodes token", () => {
  const url = buildCreatedTimeUrl("v22.0", ["1", "2"], "tok en/+");
  assertEquals(
    url,
    "https://graph.facebook.com/v22.0/?ids=1,2&fields=created_time&access_token=tok%20en%2F%2B",
  );
});

Deno.test("extractLaunchDates: keeps valid, skips error nodes and missing time", () => {
  const resp = {
    a1: { created_time: "2026-03-04T00:00:00+0000" },
    a2: { error: { message: "no perm" } },
    a3: { created_time: "bad" },
    a4: {},
    // a5 absent entirely
  };
  const out = extractLaunchDates(resp, ["a1", "a2", "a3", "a4", "a5"]);
  assertEquals(out, [
    { ad_id: "a1", created_time: "2026-03-04T00:00:00+0000", launch_date: "2026-03-04" },
  ]);
});
