// Audit 7.4: the creatives ?all=1 path paged by spend only. Most creatives tie at zero spend,
// so the order among them is not stable between requests and offset paging skipped some and
// repeated others. ad_id breaks the tie.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { unstableOrderDb } from "../_shared/unstable-order-fake.ts";
import { fetchAllCreatives } from "./all-creatives.ts";

const pad = (i: number) => String(i).padStart(5, "0");
// 300 spending creatives and 2,700 with zero spend.
const creatives = Array.from({ length: 3000 }, (_, i) => ({
  ad_id: `a_${pad(i)}`, account_id: "act_a", spend: i < 300 ? 1000 - i : 0,
}));

Deno.test("every creative comes back exactly once despite zero-spend ties", async () => {
  const db = unstableOrderDb({ creatives });
  const rows = await fetchAllCreatives(() => db.from("creatives").select("*").eq("account_id", "act_a"));
  assertEquals(rows.length, 3000);
  assertEquals(new Set(rows.map((r) => r.ad_id)).size, 3000);
});

Deno.test("highest spend still comes first", async () => {
  const db = unstableOrderDb({ creatives });
  const rows = await fetchAllCreatives(() => db.from("creatives").select("*"));
  assertEquals(rows.slice(0, 3).map((r) => r.spend), [1000, 999, 998]);
});

Deno.test("a server cap below the page size does not end the read early", async () => {
  const db = unstableOrderDb({ creatives }, { cap: 500 });
  const rows = await fetchAllCreatives(() => db.from("creatives").select("*"));
  assertEquals(new Set(rows.map((r) => r.ad_id)).size, 3000);
});
