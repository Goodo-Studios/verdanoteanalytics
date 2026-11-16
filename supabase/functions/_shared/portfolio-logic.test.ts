//   deno test supabase/functions/_shared/portfolio-logic.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchAllRows, PORTFOLIO_MIN_TOP_SPEND, summarizePortfolio } from "./portfolio-logic.ts";

function pager(total: number) {
  const calls: Array<[number, number]> = [];
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  return {
    calls,
    fetchPage: (from: number, to: number) => {
      calls.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
}

Deno.test("fetchAllRows reads past the 1000-row cap, page by page", async () => {
  const p = pager(2500);
  const all = await fetchAllRows(p.fetchPage);
  assertEquals(all.length, 2500);
  assertEquals(all[2499], { id: 2499 });
  assertEquals(p.calls, [[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]);
});

Deno.test("fetchAllRows stops on an exact page boundary with an empty next page", async () => {
  const p = pager(2000);
  assertEquals((await fetchAllRows(p.fetchPage)).length, 2000);
  assertEquals(p.calls.length, 3);
});

Deno.test("fetchAllRows with no rows returns an empty list", async () => {
  assertEquals(await fetchAllRows(pager(0).fetchPage), []);
});

Deno.test("fetchAllRows throws on a page error instead of returning a partial total", async () => {
  let n = 0;
  await assertRejects(
    () =>
      fetchAllRows((_f, _t) => {
        n++;
        return Promise.resolve(
          n === 1
            ? { data: Array.from({ length: 1000 }, () => ({})), error: null }
            : { data: null, error: { message: "boom" } },
        );
      }),
    Error,
    "boom",
  );
});

Deno.test("summarizePortfolio totals every row, not just the top ones", () => {
  // 1500 ads at $10 spend each returning $20, so the total must be 15000 spend, ROAS 2.
  const rows = Array.from({ length: 1500 }, () => ({ spend: 10, purchases: 1, purchase_value: 20 }));
  const s = summarizePortfolio(rows);
  assertEquals(s.totalSpend, 15000);
  assertEquals(s.totalPurchases, 1500);
  assertEquals(s.blendedRoas, 2);
});

Deno.test("summarizePortfolio is spend-weighted and zero when nothing was spent", () => {
  assertEquals(
    summarizePortfolio([
      { spend: 900, purchase_value: 900, purchases: 9 },
      { spend: 100, purchase_value: 900, purchases: 1 },
    ]).blendedRoas,
    1.8,
  );
  assertEquals(summarizePortfolio([]).blendedRoas, 0);
  assertEquals(summarizePortfolio([{ spend: 0, purchase_value: 0 }]).blendedRoas, 0);
});

Deno.test("the featured-creative spend floor is $100", () => {
  assertEquals(PORTFOLIO_MIN_TOP_SPEND, 100);
});

// Audit 7.3: a server row cap below the page size (PostgREST max_rows, say 500) must not end the
// read after the first short page. The read keeps going until a page comes back empty.
function cappedPager(total: number, cap: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  return (from: number, to: number) =>
    Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + cap)), error: null });
}

Deno.test("fetchAllRows keeps reading when the server returns fewer rows than asked for", async () => {
  const all = await fetchAllRows<number>(cappedPager(2300, 500));
  assertEquals(all.length, 2300);
  assertEquals(all[2299], 2299);
  assertEquals(new Set(all).size, 2300);
});
