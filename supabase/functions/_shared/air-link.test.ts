// deno test -A supabase/functions/_shared/air-link.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseAssetLink } from "./air-link.ts";

const OK: [string, string][] = [
  ["https://app.air.inc/a/baf09d5e3", "https://app.air.inc/a/baf09d5e3"],
  ["  https://app.air.inc/a/baf09d5e3 \n", "https://app.air.inc/a/baf09d5e3"],
  ["https://air.inc/a/x", "https://air.inc/a/x"],
  ["https://APP.AIR.INC/a/x", "https://app.air.inc/a/x"],
  ["https://goodo.shares.air.inc/s/abc?x=1", "https://goodo.shares.air.inc/s/abc?x=1"],
];
const BAD: unknown[] = [
  "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "http://app.air.inc/a/x", "ftp://air.inc/a",
  "https://air.inc.evil.com/a", "https://evilair.inc/a", "https://notair.inc/a", "https://air.inc.evil.com/air.inc",
  "https://app.air.inc@evil.com/a", "https://user:pw@app.air.inc/a", "https://app.air.inc:8443/a",
  "https://evil.com/?u=https://app.air.inc/a", "//app.air.inc/a", "app.air.inc/a", "https://app.air.inc/a b",
  "", "   ", null, undefined, 42, {}, "https://app.air.inc/" + "a".repeat(500),
];

Deno.test("accepts https links on air.inc and its subdomains", () => {
  for (const [input, out] of OK) assertEquals(parseAssetLink(input), out, input);
});
Deno.test("drops everything else", () => {
  for (const input of BAD) assertEquals(parseAssetLink(input), null, String(input));
});
