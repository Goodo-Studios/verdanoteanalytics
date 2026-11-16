// cluster-creatives restamps members in one database call (audit plan item 5.10).
//
// It used to clear every creative's cluster stamp for the account, then re-stamp group by
// group, so a failure part way left the account unclustered. The clear and the re-stamp
// now happen together in restamp_creative_clusters (see the pgTAP test
// supabase/tests/restamp_creative_clusters_test.sql), after every group is saved.
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

Deno.test("members are stamped with one restamp_creative_clusters call after the groups are saved", () => {
  const rpcAt = src.indexOf('rpc("restamp_creative_clusters"');
  assert(rpcAt > 0, "restamp_creative_clusters call missing");
  assert(rpcAt > src.lastIndexOf('from("creative_clusters").upsert('), "restamp must run after the group upserts");
  assertEquals(src.split('rpc("restamp_creative_clusters"').length - 1, 1);
});
