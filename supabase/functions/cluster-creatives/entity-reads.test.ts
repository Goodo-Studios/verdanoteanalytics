// cluster-creatives reads every existing group and retires stale ones reliably
// (audit plan item 7.3 follow-up).
//
// The existing-group read was a plain select, so PostgREST returned at most 1,000 rows.
// Accounts with more groups than that (three of the four largest after a failed run)
// never saw the rest: those groups were neither matched again nor retired. Retirement
// also ignored delete errors and only lowered its count.
//
//   deno test -A supabase/functions/cluster-creatives/entity-reads.test.ts

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadExistingEntityRows, retireEntities } from "./entity-reads.ts";

const SERVER_CAP = 1000;

function fakeDb(rows: Array<Record<string, unknown>>, opts: { deleteError?: string } = {}) {
  const deleted: string[][] = [];
  const orders: string[] = [];
  return {
    deleted,
    orders,
    from(table: string) {
      assertEquals(table, "creative_clusters");
      let filtered = rows;
      const q = {
        select(_cols: string) {
          return q;
        },
        eq(col: string, val: unknown) {
          filtered = filtered.filter((r) => r[col] === val);
          return q;
        },
        order(col: string) {
          orders.push(col);
          filtered = [...filtered].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
          return q;
        },
        range(from: number, to: number) {
          const end = Math.min(to + 1, from + SERVER_CAP);
          return Promise.resolve({ data: filtered.slice(from, end), error: null });
        },
        then(resolve: (v: unknown) => void) {
          return resolve({ data: filtered.slice(0, SERVER_CAP), error: null });
        },
        delete() {
          return {
            in(_col: string, ids: string[]) {
              deleted.push(ids);
              return Promise.resolve({ error: opts.deleteError ? { message: opts.deleteError } : null });
            },
          };
        },
      };
      return q;
    },
  };
}

const many = Array.from({ length: 2345 }, (_, i) => ({
  id: `e-${String(i).padStart(5, "0")}`,
  account_id: "act_1",
  centroid: null,
  asset_keys: [],
  meta_video_ids: [],
  meta_image_hashes: [],
}));

Deno.test("reads every existing group past the 1,000-row server cap", async () => {
  const db = fakeDb([...many, { ...many[0], id: "other", account_id: "act_2" }]);
  const rows = await loadExistingEntityRows(db, "act_1");
  assertEquals(rows.length, 2345);
  assertEquals(new Set(rows.map((r) => r.id)).size, 2345);
  assert(db.orders.includes("id"), "pages must be ordered by id");
});

Deno.test("retires every stale group in chunks and counts them", async () => {
  const db = fakeDb([]);
  const ids = many.slice(0, 450).map((r) => r.id);
  assertEquals(await retireEntities(db, ids), 450);
  assertEquals(db.deleted.map((c) => c.length), [200, 200, 50]);
});

Deno.test("a failed retire is an error, not a quietly lower count", async () => {
  const db = fakeDb([], { deleteError: "permission denied" });
  await assertRejects(() => retireEntities(db, ["e-1"]), Error, "permission denied");
});

Deno.test("cluster-creatives uses both helpers", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(src.includes("await loadExistingEntityRows("), "existing groups must be read through loadExistingEntityRows");
  assert(src.includes("await retireEntities("), "stale groups must be retired through retireEntities");
  assertEquals(src.includes('from("creative_clusters").delete()'), false);
});
