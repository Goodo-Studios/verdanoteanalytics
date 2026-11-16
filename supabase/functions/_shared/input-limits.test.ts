import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clampInt, clampNumber, isApifyRunId, sadieOrderColumn } from "./input-limits.ts";

Deno.test("clampInt keeps numbers in range and falls back on junk", () => {
  assertEquals(clampInt("100", 20, 1, 50), 50);
  assertEquals(clampInt(-5, 20, 1, 50), 1);
  assertEquals(clampInt("abc", 20, 1, 50), 20);
  assertEquals(clampInt(undefined, 20, 1, 50), 20);
  assertEquals(clampInt(7.9, 20, 1, 50), 7);
});

Deno.test("clampNumber keeps a threshold within 0..1", () => {
  assertEquals(clampNumber(-1, 0.4, 0, 1), 0);
  assertEquals(clampNumber(3, 0.4, 0, 1), 1);
  assertEquals(clampNumber("0.7", 0.4, 0, 1), 0.7);
  assertEquals(clampNumber(null, 0.4, 0, 1), 0.4);
});

Deno.test("sadie-read accepts only known sort columns", () => {
  assertEquals(sadieOrderColumn(null), "spend");
  assertEquals(sadieOrderColumn("roas"), "roas");
  assertEquals(sadieOrderColumn("ad_name.desc,id"), null);
  assertEquals(sadieOrderColumn("account_id"), null);
});

Deno.test("apify run ids are strictly alphanumeric", () => {
  assert(isApifyRunId("HG7ML7M8z78YcAPEB"));
  assertEquals(isApifyRunId("../../users/me"), false);
  assertEquals(isApifyRunId("abc?token=x"), false);
  assertEquals(isApifyRunId(""), false);
  assertEquals(isApifyRunId(123), false);
});

Deno.test("each function uses its guard", async () => {
  const read = (f: string) => Deno.readTextFile(new URL(`../${f}/index.ts`, import.meta.url));
  const search = await read("vault-search");
  assert(/clampInt\(/.test(search) && /clampNumber\(/.test(search), "vault-search does not clamp limit and threshold");
  const sadie = await read("sadie-read");
  assert(/sadieOrderColumn\(/.test(sadie) && /clampInt\(/.test(sadie), "sadie-read does not check order_by and limit");
  assert(/isApifyRunId\(/.test(await read("apify-debug")), "apify-debug does not check run_id");
  assert(/timingSafeEqual\(/.test(await read("write-brief")), "write-brief compares the secret with ===");
});
