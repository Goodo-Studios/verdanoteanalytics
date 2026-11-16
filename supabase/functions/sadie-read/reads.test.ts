// Audit 7.3: sadie-read's summary, tags and media-stats reads must see every creative,
// not just the first 1,000 rows PostgREST returns for a plain select.
// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { loadAccountCreatives, loadMediaRows, SUMMARY_ONE_COLUMNS, TAG_COLUMNS } from "./reads.ts";

const SERVER_CAP = 1000;

type Row = { ad_id: string; account_id: string; impressions: number; tag_source: string; spend: number };

// A fake client that behaves like PostgREST: filters, order, range and limit apply, and
// no response ever carries more than SERVER_CAP rows.
function fakeDb(rows: Row[], opts: { error?: string } = {}) {
  return {
    from(_table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let orderKey: string | null = null;
      let start = 0;
      let end = Number.POSITIVE_INFINITY;
      let limit = Number.POSITIVE_INFINITY;
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r: any) => r[k] === v), q),
        gt: (k: string, v: number) => (filters.push((r: any) => r[k] > v), q),
        neq: (k: string, v: unknown) => (filters.push((r: any) => r[k] !== v), q),
        order: (k: string) => ((orderKey = k), q),
        range: (from: number, to: number) => ((start = from), (end = to + 1), q),
        limit: (n: number) => ((limit = n), q),
        then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
          if (opts.error) return Promise.resolve({ data: null, error: { message: opts.error } }).then(resolve, reject);
          let out = rows.filter((r) => filters.every((f) => f(r)));
          if (orderKey) out = [...out].sort((a: any, b: any) => (a[orderKey!] < b[orderKey!] ? -1 : 1));
          out = out.slice(start, Math.min(end, start + limit)).slice(0, SERVER_CAP);
          return Promise.resolve({ data: out, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

function makeRows(account: string, n: number, extra: Partial<Row> = {}): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    ad_id: `${account}_${String(i).padStart(5, "0")}`,
    account_id: account,
    impressions: 10,
    tag_source: "manual",
    spend: 1,
    ...extra,
  }));
}

Deno.test("account summary reads every creative past the 1,000-row cap", async () => {
  const db = fakeDb([...makeRows("act_a", 2500), ...makeRows("act_b", 300), ...makeRows("act_a0", 5, { impressions: 0 })]);
  const rows = await loadAccountCreatives(db, "act_a", SUMMARY_ONE_COLUMNS);
  assertEquals(rows.length, 2500);
  assertEquals(new Set(rows.map((r: Row) => r.ad_id)).size, 2500);
});

Deno.test("tags read every tagged creative past the cap and skips untagged ones", async () => {
  const db = fakeDb([...makeRows("act_a", 1800), ...makeRows("act_a", 400, { tag_source: "untagged" }).map((r) => ({ ...r, ad_id: `u_${r.ad_id}` }))]);
  const rows = await loadAccountCreatives(db, "act_a", TAG_COLUMNS, true);
  assertEquals(rows.length, 1800);
});

Deno.test("media stats read every creative across all accounts", async () => {
  const db = fakeDb([...makeRows("act_a", 1500), ...makeRows("act_b", 1500)]);
  assertEquals((await loadMediaRows(db, null)).length, 3000);
  assertEquals((await loadMediaRows(db, "act_b")).length, 1500);
});

Deno.test("a failed read throws instead of returning a partial list", async () => {
  const db = fakeDb(makeRows("act_a", 10), { error: "boom" });
  await assertRejects(() => loadAccountCreatives(db, "act_a", SUMMARY_ONE_COLUMNS));
  await assertRejects(() => loadMediaRows(db, null));
});
