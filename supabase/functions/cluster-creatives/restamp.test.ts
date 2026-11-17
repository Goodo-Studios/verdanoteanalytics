// cluster-creatives restamps members only after every group is saved (audit plan
// item 5.10), in small steps (7.3 follow-up).
//
// It used to clear every creative's cluster stamp for the account, then re-stamp group by
// group, so a failure part way left the account unclustered. The stamps are now applied
// by restampInSteps (restamp.ts) after every group is saved. Each step changes only rows
// whose stamp differs, so an interrupted run leaves every creative stamped with either
// its old or its new group, and both still exist because stale groups are retired last.
// See supabase/tests/restamp_creative_clusters_step_test.sql for the database side.
//
//   deno test -A supabase/functions/cluster-creatives/restamp.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("no separate clear of every cluster stamp", () => {
  assertEquals(/update\(\{\s*cluster_id:\s*null/.test(src), false);
});

Deno.test("no per-group member stamp updates", () => {
  assertEquals(/update\(\{\s*cluster_id:\s*entityId/.test(src), false);
});

Deno.test("no single all-at-once restamp call", () => {
  assertEquals(src.includes('rpc("restamp_creative_clusters"'), false);
});

Deno.test("members are stamped with one restampInSteps call after the groups are saved", () => {
  const at = src.indexOf("await restampInSteps(");
  assert(at > 0, "restampInSteps call missing");
  assert(at > src.lastIndexOf('from("creative_clusters").upsert('), "restamp must run after the group upserts");
  assert(at < src.indexOf("await retireEntities("), "restamp must run before stale groups are retired");
  assertEquals(src.split("await restampInSteps(").length - 1, 1);
});
