// Audit 7.3: the name-mapping re-match must read every untagged creative and every mapping,
// even when the server returns fewer rows per page than the page size asked for.
// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadMappingsByCode, loadUntaggedCreatives } from "./rematch-reads.ts";

// A fake client like PostgREST with max_rows set to `cap`: filters, order and range apply,
// and no response carries more than `cap` rows.
function fakeDb(tables: Record<string, any[]>, cap: number, opts: { error?: string } = {}) {
  return {
    from(table: string) {
      const filters: ((r: any) => boolean)[] = [];
      let orderKey: string | null = null;
      let start = 0;
      let end = Number.POSITIVE_INFINITY;
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        order: (k: string) => ((orderKey = k), q),
        range: (from: number, to: number) => ((start = from), (end = to + 1), q),
        then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
          if (opts.error) return Promise.resolve({ data: null, error: { message: opts.error } }).then(resolve, reject);
          let out = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (orderKey) out = [...out].sort((a, b) => (a[orderKey!] < b[orderKey!] ? -1 : 1));
          out = out.slice(start, end).slice(0, cap);
          return Promise.resolve({ data: out, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

const creatives = [
  ...Array.from({ length: 2300 }, (_, i) => ({
    ad_id: `ad_${String(i).padStart(5, "0")}`, account_id: "act_a", tag_source: "untagged", unique_code: `c${i % 900}`,
  })),
  ...Array.from({ length: 50 }, (_, i) => ({ ad_id: `t_${i}`, account_id: "act_a", tag_source: "manual", unique_code: "c1" })),
  ...Array.from({ length: 50 }, (_, i) => ({ ad_id: `b_${i}`, account_id: "act_b", tag_source: "untagged", unique_code: "c1" })),
];
const mappings = [
  ...Array.from({ length: 1700 }, (_, i) => ({ account_id: "act_a", unique_code: `m${String(i).padStart(5, "0")}`, product: "P" })),
  { account_id: "act_b", unique_code: "other", product: "Q" },
];

for (const cap of [1000, 500]) {
  Deno.test(`every untagged creative in the account is read (server cap ${cap})`, async () => {
    const rows = await loadUntaggedCreatives(fakeDb({ creatives }, cap), "act_a");
    assertEquals(rows.length, 2300);
    assertEquals(new Set(rows.map((r) => r.ad_id)).size, 2300);
  });

  Deno.test(`every mapping in the account is read (server cap ${cap})`, async () => {
    const byCode = await loadMappingsByCode(fakeDb({ name_mappings: mappings }, cap), "act_a");
    assertEquals(byCode.size, 1700);
    assertEquals(byCode.has("other"), false);
  });
}

Deno.test("a failed read throws instead of re-matching a partial list", async () => {
  await assertRejects(() => loadUntaggedCreatives(fakeDb({ creatives }, 1000, { error: "boom" }), "act_a"));
  await assertRejects(() => loadMappingsByCode(fakeDb({ name_mappings: mappings }, 1000, { error: "boom" }), "act_a"));
});
