// Audit 7.3: creative-embed skips creatives that already have an embedding. The lookup read
// the whole account's embeddings in one select, capped at 1,000 rows, so on an account with
// more embeddings the rest looked new and were paid for again on every run.
// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadEmbeddedAdIds } from "./existing.ts";

const SERVER_CAP = 1000;

function fakeDb(rows: any[], opts: { error?: string } = {}) {
  const calls: { inSize: number }[] = [];
  return {
    calls,
    from(_table: string) {
      const filters: ((r: any) => boolean)[] = [];
      let inSize = 0;
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        in: (k: string, vs: unknown[]) => ((inSize = vs.length), filters.push((r) => vs.includes(r[k])), q),
        then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
          calls.push({ inSize });
          if (opts.error) return Promise.resolve({ data: null, error: { message: opts.error } }).then(resolve, reject);
          const out = rows.filter((r) => filters.every((f) => f(r))).slice(0, SERVER_CAP);
          return Promise.resolve({ data: out, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

const pad = (i: number) => String(i).padStart(5, "0");
// 2,500 embedded ads in act_a and 500 in act_b.
const embeddings = [
  ...Array.from({ length: 2500 }, (_, i) => ({ ad_id: `a_${pad(i)}`, account_id: "act_a" })),
  ...Array.from({ length: 500 }, (_, i) => ({ ad_id: `b_${pad(i)}`, account_id: "act_b" })),
];

Deno.test("a batch past the first 1,000 embeddings is recognised as already embedded", async () => {
  const batch = Array.from({ length: 500 }, (_, i) => `a_${pad(1800 + i)}`); // a_01800..a_02299
  const got = await loadEmbeddedAdIds(fakeDb(embeddings), "act_a", batch);
  for (const id of batch) assertEquals(got.has(id), true, id);
});

Deno.test("across all accounts, a batch past the cap is recognised too", async () => {
  const batch = [...Array.from({ length: 300 }, (_, i) => `b_${pad(i)}`), "a_02400", "new_ad"];
  const got = await loadEmbeddedAdIds(fakeDb(embeddings), undefined, batch);
  assertEquals(got.size, 301);
  assertEquals(got.has("new_ad"), false);
});

Deno.test("the lookup asks only about the batch, in requests of at most 200 ids", async () => {
  const db = fakeDb(embeddings);
  const batch = Array.from({ length: 450 }, (_, i) => `a_${pad(i)}`);
  await loadEmbeddedAdIds(db, "act_a", batch);
  assertEquals(db.calls.map((c) => c.inSize), [200, 200, 50]);
});

Deno.test("a failed lookup throws instead of treating every ad as new (and paying to re-embed it)", async () => {
  await assertRejects(() => loadEmbeddedAdIds(fakeDb(embeddings, { error: "boom" }), "act_a", ["a_00001"]));
});
