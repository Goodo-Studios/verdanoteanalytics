// The email digest's weekly totals cover every row (audit plan item 7.3, part 3).
//
// The digest summed spend from a plain select, which PostgREST caps at 1,000 rows, and averaged
// each daily row's ROAS. A fake database that behaves like PostgREST (a select returns at most
// 1,000 rows; the account_week_totals RPC sums every row) shows both.
//   deno test supabase/functions/_shared/digest-totals.test.ts
import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadWeekTotals } from "./digest-totals.ts";

// 1,000 small rows (spend 1, ROAS 10) then 500 large rows (spend 100, ROAS 1).
const rows = [
  ...Array.from({ length: 1000 }, () => ({ spend: 1, purchase_value: 10, roas: 10 })),
  ...Array.from({ length: 500 }, () => ({ spend: 100, purchase_value: 100, roas: 1 })),
];

function fakeDb() {
  const rpcCalls: Array<[string, unknown]> = [];
  const q = {
    select() { return q; }, eq() { return q; }, gte() { return q; }, lt() { return q; }, lte() { return q; },
    then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows.slice(0, 1000), error: null }).then(res); },
  };
  return {
    rpcCalls,
    from: () => q,
    rpc(name: string, args: unknown) {
      rpcCalls.push([name, args]);
      if (name !== "account_week_totals") return Promise.resolve({ data: null, error: { message: "no such function" } });
      const spend = rows.reduce((s, r) => s + r.spend, 0);
      const pv = rows.reduce((s, r) => s + r.purchase_value, 0);
      return Promise.resolve({ data: [{ spend, purchase_value: pv }], error: null });
    },
  };
}

Deno.test("weekly spend counts every row, not the first 1,000", async () => {
  const t = await loadWeekTotals(fakeDb(), "act_1", "2026-11-08", "2026-11-15");
  assertEquals(t.spend, 51000);
});

Deno.test("weekly ROAS is revenue over spend, not an average of daily rows", async () => {
  const t = await loadWeekTotals(fakeDb(), "act_1", "2026-11-08", "2026-11-15");
  assertAlmostEquals(t.roas, 60000 / 51000, 1e-9);
});
