// cluster-creatives restamps members in small steps (audit plan item 7.3 follow-up).
//
// The single restamp_creative_clusters call cleared and re-stamped every member of an
// account in one statement. On the four largest accounts that is 2,000 to 3,300 row
// updates on a table with 46 indexes, which ran past the API's 8 second statement
// limit, so grouping failed for exactly the accounts that need it most. The work now
// goes through restamp_creative_clusters_step, which only changes rows whose stamp
// differs and at most p_limit of them per call. restampInSteps calls it until nothing
// is left to change.
//
//   deno test -A supabase/functions/cluster-creatives/restamp-steps.test.ts

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RESTAMP_STEP, restampInSteps } from "./restamp.ts";

type Call = { fn: string; args: Record<string, unknown> };

function fakeDb(results: Array<{ data: unknown; error: { message: string } | null }>) {
  const calls: Call[] = [];
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const next = results.shift();
      if (!next) throw new Error("unexpected extra rpc call");
      return Promise.resolve(next);
    },
  };
}

const stamps = [
  { ad_id: "a1", cluster_id: "00000000-0000-0000-0000-0000000000b1", confidence: "exact" },
  { ad_id: "a2", cluster_id: "00000000-0000-0000-0000-0000000000b1", confidence: "exact" },
];

Deno.test("keeps calling the step function until no rows are left to change", async () => {
  const db = fakeDb([
    { data: 700, error: null },
    { data: 400, error: null },
    { data: 100, error: null },
    { data: 0, error: null },
  ]);
  const result = await restampInSteps(db, "act_1", stamps);
  assertEquals(result.steps, 4);
  assertEquals(db.calls.length, 4);
  for (const c of db.calls) {
    assertEquals(c.fn, "restamp_creative_clusters_step");
    assertEquals(c.args, { p_account_id: "act_1", p_stamps: stamps, p_limit: RESTAMP_STEP });
  }
});

Deno.test("one call is enough when the stamps already match", async () => {
  const db = fakeDb([{ data: 0, error: null }]);
  assertEquals((await restampInSteps(db, "act_1", stamps)).steps, 1);
});

Deno.test("a step error stops the loop and reports the database message", async () => {
  const db = fakeDb([
    { data: 500, error: null },
    { data: null, error: { message: "canceling statement due to statement timeout" } },
  ]);
  await assertRejects(() => restampInSteps(db, "act_1", stamps), Error, "statement timeout");
  assertEquals(db.calls.length, 2);
});

Deno.test("stops instead of looping forever when a step makes no progress", async () => {
  const db = fakeDb([
    { data: 500, error: null },
    { data: 500, error: null },
  ]);
  await assertRejects(() => restampInSteps(db, "act_1", stamps), Error, "no progress");
});

Deno.test("rejects a non-numeric step result", async () => {
  const db = fakeDb([{ data: "oops", error: null }]);
  await assertRejects(() => restampInSteps(db, "act_1", stamps), Error, "unexpected");
});

Deno.test("the step size keeps each call well under the 8 second statement limit", () => {
  assert(RESTAMP_STEP > 0 && RESTAMP_STEP <= 300, `step ${RESTAMP_STEP} is too large`);
});
