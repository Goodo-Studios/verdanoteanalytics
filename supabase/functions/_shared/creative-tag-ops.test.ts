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
  assertEquals(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
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
