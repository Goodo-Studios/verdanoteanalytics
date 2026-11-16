// The Creatives filter menus list every product, theme and hook (audit plan item 7.3, part 2).
//
// The product and theme lists were plain selects, which PostgREST caps at 1,000 rows, so with
// about 52,000 creatives most products and themes never reached the menus. The fake database
// below behaves like PostgREST: a select returns at most 1,000 rows (or the range asked for),
// and the creative_filter_values RPC answers over every row.
//   deno test supabase/functions/_shared/creative-filter-values.test.ts
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadFilterValues } from "./creative-filter-values.ts";

type Row = { account_id: string; product: string | null; theme: string | null; hook: string | null };

// 2,500 creatives: products/themes/hooks cycle every 1,200 rows, so values past row 1,000 only
// appear in the second and third thousand.
const rows: Row[] = Array.from({ length: 2500 }, (_, i) => ({
  account_id: i % 2 === 0 ? "act_a" : "act_b",
  product: `P${i % 1200}`,
  theme: `T${i % 1200}`,
  hook: `H${i % 1200}`,
}));

function fakeDb(opts: { rpcError?: string } = {}) {
  const rpcCalls: Array<[string, unknown]> = [];
  const db = {
    rpcCalls,
    rpc(name: string, args: { p_allowed_ids: string[] | null }) {
      rpcCalls.push([name, args]);
      if (name !== "creative_filter_values") return Promise.resolve({ data: null, error: { message: "no such function" } });
      if (opts.rpcError) return Promise.resolve({ data: null, error: { message: opts.rpcError } });
      const scoped = rows.filter((r) => !args.p_allowed_ids || args.p_allowed_ids.includes(r.account_id));
      const distinct = (k: keyof Row) => [...new Set(scoped.map((r) => r[k]).filter((v) => v !== null))].sort();
      return Promise.resolve({ data: { product: distinct("product"), theme: distinct("theme"), hook: distinct("hook") }, error: null });
    },
    from(_table: string) {
      let col = "";
      let ids: string[] | null = null;
      let range: [number, number] | null = null;
      const q = {
        select(c: string) { col = c; return q; },
        not() { return q; },
        order() { return q; },
        in(_c: string, v: string[]) { ids = v; return q; },
        range(a: number, b: number) { range = [a, b]; return q; },
        then(res: (v: unknown) => unknown) {
          const scoped = rows.filter((r) => !ids || ids.includes(r.account_id));
          const [a, b] = range ?? [0, 999];
          const page = scoped.slice(a, Math.min(b + 1, a + 1000)).map((r) => ({ [col]: (r as Record<string, unknown>)[col] }));
          return Promise.resolve({ data: page, error: null }).then(res);
        },
      };
      return q;
    },
  };
  return db;
}

Deno.test("every product and theme reaches the filter menus, not just the first 1,000 creatives", async () => {
  const v = await loadFilterValues(fakeDb(), null);
  assertEquals(v.product.length, 1200);
  assertEquals(v.theme.length, 1200);
  assert(v.product.includes("P1199"));
  assertEquals(v.hook.length, 1200);
});

Deno.test("values stay scoped to the caller's accounts", async () => {
  const db = fakeDb();
  const v = await loadFilterValues(db, ["act_a"]);
  assertEquals(v.product.length, 600);
  assert(v.product.every((p) => Number(p.slice(1)) % 2 === 0));
});

Deno.test("a database error is reported, not shown as empty menus", async () => {
  await assertRejects(() => loadFilterValues(fakeDb({ rpcError: "boom" }), null), Error, "boom");
});
