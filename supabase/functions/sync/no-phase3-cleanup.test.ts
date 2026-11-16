// Matthew's decision 18 (2026-11-16): remove the sync Phase 3 zero-spend cleanup.
//
// The cleanup deleted creatives with spend <= 0 AND impressions IS NULL, but the column
// defaults to 0, so it never matched (0 such rows in production on 2026-11-15). Fixing the
// condition would have deleted 4,907 creatives, so Matthew chose to remove it: Phase 3 now
// only counts the account's creatives and moves on. Nothing is deleted.
//   deno test -A supabase/functions/sync/no-phase3-cleanup.test.ts

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const start = src.indexOf("if (phase === 3) {");
const end = src.indexOf("if (phase === 4", start);
const phase3 = start > 0 && end > start ? src.slice(start, end) : "";

Deno.test("decision 18: Phase 3 is found", () => {
  assert(phase3.length > 0, "Phase 3 block not found in sync/index.ts");
});

Deno.test("decision 18: Phase 3 deletes no creatives", () => {
  assert(!phase3.includes(".delete("), "Phase 3 still deletes rows");
  assert(!phase3.includes('.is("impressions", null)'), "Phase 3 still filters on impressions IS NULL");
});

Deno.test("decision 18: Phase 3 still counts creatives and moves to Phase 4", () => {
  assert(phase3.includes('count: "exact", head: true'), "Phase 3 must still count the account's creatives");
  assert(phase3.includes("saveState(4, { creatives_upserted: creativesUpserted })"), "Phase 3 must hand off to Phase 4");
});
