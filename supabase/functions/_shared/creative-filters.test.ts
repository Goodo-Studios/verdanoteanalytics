//   deno test supabase/functions/_shared/creative-filters.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { adTypeFilterValues, applyAdTypeFilter, distinctValues } from "./creative-filters.ts";

Deno.test("adTypeFilterValues: Static matches legacy Image and Photo", () => {
  assertEquals(adTypeFilterValues("Static"), ["Static", "Image", "Photo"]);
  assertEquals(adTypeFilterValues("static"), ["Static", "Image", "Photo"]);
});

Deno.test("adTypeFilterValues: other values match exactly; empty -> none", () => {
  assertEquals(adTypeFilterValues("Video"), ["Video"]);
  assertEquals(adTypeFilterValues("GIF"), ["GIF"]);
  assertEquals(adTypeFilterValues("Image"), ["Image"]);
  assertEquals(adTypeFilterValues(""), []);
  assertEquals(adTypeFilterValues(null), []);
});

function recorder() {
  const calls: unknown[][] = [];
  const q = {
    eq(c: string, v: string) { calls.push(["eq", c, v]); return q; },
    in(c: string, v: string[]) { calls.push(["in", c, v]); return q; },
  };
  return { q, calls };
}

Deno.test("applyAdTypeFilter: Static -> in(), Video -> eq(), none -> untouched", () => {
  let r = recorder();
  applyAdTypeFilter(r.q, "Static");
  assertEquals(r.calls, [["in", "ad_type", ["Static", "Image", "Photo"]]]);
  r = recorder();
  applyAdTypeFilter(r.q, "Video");
  assertEquals(r.calls, [["eq", "ad_type", "Video"]]);
  r = recorder();
  applyAdTypeFilter(r.q, null);
  assertEquals(r.calls, []);
});

Deno.test("distinctValues: de-dupes exact text, drops null/blank, sorts", () => {
  assertEquals(
    distinctValues(["Tired By 3pm", null, "", "  ", "Confession", "Tired By 3pm", "tired by 3pm", 5]),
    ["Confession", "Tired By 3pm", "tired by 3pm"],
  );
});
