// One purchase action type from Meta (audit plan item 6.1, part 7).
//
// Meta reports the same purchases under several action types: omni_purchase (all
// channels, de-duplicated), purchase, and offsite_conversion.fb_pixel_purchase (pixel
// only). The parsers took whichever of these came first in Meta's list, so purchases and
// revenue could switch definition from one day to the next, and spend-diagnostic added
// all three together. Every parser now picks by a fixed priority instead of list order.
//
//   deno test -A supabase/functions/_shared/meta-actions.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SYNC_NO_SERVE", "1");
Deno.env.set("BACKFILL_DAILY_HISTORY_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

// deno-lint-ignore no-explicit-any
const sync: any = await import("../sync/index.ts");
// deno-lint-ignore no-explicit-any
const backfill: any = await import("../backfill-daily-history/index.ts");

// Pixel listed first, the de-duplicated total second: the old code took the pixel number.
const row = {
  ad_id: "ad1",
  date_start: "2020-05-01",
  spend: "100",
  impressions: "1000",
  actions: [
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
    { action_type: "purchase", value: "4" },
    { action_type: "omni_purchase", value: "5" },
    { action_type: "offsite_conversion.fb_pixel_add_to_cart", value: "7" },
    { action_type: "omni_add_to_cart", value: "9" },
  ],
  action_values: [
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "30" },
    { action_type: "omni_purchase", value: "50" },
  ],
  cost_per_action_type: [
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "33.33" },
    { action_type: "omni_purchase", value: "20" },
  ],
};

// Same day, Meta lists the types in a different order.
const reordered = {
  ...row,
  actions: [...row.actions].reverse(),
  action_values: [...row.action_values].reverse(),
  cost_per_action_type: [...row.cost_per_action_type].reverse(),
};

// An account with only the pixel type falls back to it.
const pixelOnly = {
  ...row,
  actions: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "3" }],
  action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "30" }],
  cost_per_action_type: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "33.33" }],
};

Deno.test("sync parseInsightsRow takes omni_purchase whatever order Meta lists the types in", () => {
  assert(typeof sync.parseInsightsRow === "function", "parseInsightsRow must be exported");
  for (const r of [row, reordered]) {
    const p = sync.parseInsightsRow(r);
    assertEquals(p.purchases, 5);
    assertEquals(p.purchase_value, 50);
    assertEquals(p.cpa, 20);
    assertEquals(p.adds_to_cart, 9);
  }
});

Deno.test("sync parseInsightsRow falls back to the pixel type when it is the only one", () => {
  const p = sync.parseInsightsRow(pixelOnly);
  assertEquals(p.purchases, 3);
  assertEquals(p.purchase_value, 30);
});

Deno.test("backfill buildDailyRow uses the same purchase type as sync", () => {
  const ids = new Set(["ad1"]);
  for (const r of [row, reordered]) {
    const d = backfill.buildDailyRow(r, "act_1", ids);
    assertEquals(d.purchases, 5);
    assertEquals(d.purchase_value, 50);
    assertEquals(d.adds_to_cart, 9);
  }
  assertEquals(backfill.buildDailyRow(pixelOnly, "act_1", ids).purchases, 3);
});

Deno.test("spend-diagnostic does not add the overlapping purchase types together", async () => {
  const src = await Deno.readTextFile(new URL("../spend-diagnostic/index.ts", import.meta.url));
  assert(src.includes("pickActionValue("), "spend-diagnostic must use the shared pickActionValue");
  assert(!/\+=\s*parseInt\(action\.value/.test(src), "spend-diagnostic must not sum every purchase action");
});
