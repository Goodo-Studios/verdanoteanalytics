import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { chunk, fetchAllRows, validateTagUpdate } from "./creative-tag-ops.ts";

Deno.test("chunk splits into groups of at most the size", () => {
  const ids = Array.from({ length: 250 }, (_, i) => `a${i}`);
  assertEquals(chunk(ids, 100).map((c) => c.length), [100, 100, 50]);
  assertEquals(chunk([], 100), []);
});

Deno.test("fetchAllRows reads past the 1000-row cap", async () => {
  const all = Array.from({ length: 2500 }, (_, i) => i);
  const calls: Array<[number, number]> = [];
  const rows = await fetchAllRows<number>((from, to) => {
    calls.push([from, to]);
    return Promise.resolve({ data: all.slice(from, to + 1), error: null });
  });
  assertEquals(rows.length, 2500);
  assertEquals(calls, [[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]);
});

Deno.test("fetchAllRows throws on a page error instead of returning a truncated list", async () => {
  await assertRejects(
    () =>
      fetchAllRows<number>((from) =>
        Promise.resolve(from === 0 ? { data: new Array(1000).fill(1), error: null } : { data: null, error: { message: "boom" } })
      ),
    Error,
    "boom",
  );
});

Deno.test("validateTagUpdate accepts strings, null and a real date", () => {
  const r = validateTagUpdate({ ad_type: "UGC", person: null, hook: "  ", scheduled_launch_date: "2026-11-30", notes: "ok" });
  assertEquals(r, { ok: true, update: { ad_type: "UGC", person: null, hook: null, scheduled_launch_date: "2026-11-30", notes: "ok" } });
});

Deno.test("validateTagUpdate rejects non-strings, long values and bad dates", () => {
  assertEquals(validateTagUpdate({ ad_type: 5 }).ok, false);
  assertEquals(validateTagUpdate({ person: { a: 1 } }).ok, false);
  assertEquals(validateTagUpdate({ theme: "x".repeat(201) }).ok, false);
  assertEquals(validateTagUpdate({ notes: "x".repeat(5001) }).ok, false);
  assertEquals(validateTagUpdate({ scheduled_launch_date: "tomorrow" }).ok, false);
  assertEquals(validateTagUpdate({ scheduled_launch_date: "2026-13-45" }).ok, false);
});

Deno.test("validateTagUpdate leaves absent fields out", () => {
  assertEquals(validateTagUpdate({}), { ok: true, update: {} });
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
