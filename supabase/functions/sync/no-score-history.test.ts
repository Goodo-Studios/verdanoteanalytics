// Matthew's decision 16 (2026-11-16): sync stops saving score snapshots. Phase 5 wrote one
// score_history row per active creative on every run, and nothing in the app or any function ever
// read them. The table and its existing rows stay; only the writes go.
//   deno test -A supabase/functions/sync/no-score-history.test.ts

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("decision 16: sync no longer writes score_history", () => {
  assert(!source.includes("score_history"), "sync/index.ts still references score_history");
});

Deno.test("decision 16: the per-creative score computation is gone too", () => {
  assert(!source.includes("roas_component"), "sync/index.ts still builds score rows");
});
