// Audit 7.4: the public API's /metrics fallback, /summary and tag-status loops paged creatives
// by offset with no order, so rows could be skipped or counted twice, and a failed page ended
// the loop and returned partial totals as if they were complete.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { unstableOrderDb } from "../_shared/unstable-order-fake.ts";
import { loadMetricRows, loadSummaryRows, loadTagSources } from "./creative-reads.ts";

const pad = (i: number) => String(i).padStart(5, "0");
const creatives = [
  ...Array.from({ length: 2500 }, (_, i) => ({
    ad_id: `a_${pad(i)}`, account_id: "act_a", spend: i + 1, impressions: 10, clicks: 1, purchases: 1, purchase_value: 3,
    roas: 3, cpa: 1, ctr: 10, ad_status: "ACTIVE", tag_source: i % 2 ? "manual" : null,
  })),
  ...Array.from({ length: 700 }, (_, i) => ({
    ad_id: `b_${pad(i)}`, account_id: "act_b", spend: 10000 + i, impressions: 10, clicks: 1, purchases: 1, purchase_value: 3,
    roas: 3, cpa: 1, ctr: 10, ad_status: "PAUSED", tag_source: "parsed",
  })),
];

// Every row has a different spend, so a skipped row and a repeated row cannot cancel out.
const sum = (rows: { spend: number }[]) => rows.reduce((s, r) => s + r.spend, 0);
const SUM_A = (2500 * 2501) / 2; // 1 + 2 + ... + 2500
const SUM_B = 700 * 10000 + (699 * 700) / 2;

Deno.test("/metrics fallback: every creative counted exactly once (all accounts and one account)", async () => {
  assertEquals(sum(await loadMetricRows(unstableOrderDb({ creatives }), null)), SUM_A + SUM_B);
  assertEquals(sum(await loadMetricRows(unstableOrderDb({ creatives }), "act_a")), SUM_A);
});

Deno.test("/summary: every creative in the account counted exactly once", async () => {
  const rows = await loadSummaryRows(unstableOrderDb({ creatives }), "act_a");
  assertEquals(rows.length, 2500);
  assertEquals(sum(rows), SUM_A);
});

Deno.test("tag status: every creative's tag source counted exactly once", async () => {
  const rows = await loadTagSources(unstableOrderDb({ creatives }), "act_a");
  assertEquals(rows.length, 2500);
  assertEquals(rows.filter((r) => r.tag_source === "manual").length, 1250);
});

Deno.test("a failed page is an error, not a partial total", async () => {
  await assertRejects(() => loadMetricRows(unstableOrderDb({ creatives }, { failAt: 1 }), "act_a"));
  await assertRejects(() => loadSummaryRows(unstableOrderDb({ creatives }, { failAt: 1 }), "act_a"));
  await assertRejects(() => loadTagSources(unstableOrderDb({ creatives }, { failAt: 1 }), "act_a"));
});
