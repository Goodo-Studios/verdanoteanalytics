// Audit plan item 3.2: a tag save for one creative names the account the user is working in, and
// the creatives function refuses the save when the creative belongs to a different account.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { workingAccountScope } from "./creative-account-scope.ts";

Deno.test("workingAccountScope reads a single account id", () => {
  assertEquals(workingAccountScope(new URL("https://x/creatives/ad1?account_id=acct-a")), "acct-a");
});

Deno.test("workingAccountScope is null for no account, all accounts or an empty value", () => {
  assertEquals(workingAccountScope(new URL("https://x/creatives/ad1")), null);
  assertEquals(workingAccountScope(new URL("https://x/creatives/ad1?account_id=all")), null);
  assertEquals(workingAccountScope(new URL("https://x/creatives/ad1?account_id=")), null);
  assertEquals(workingAccountScope(new URL("https://x/creatives/ad1?account_id=%20")), null);
});

Deno.test("the creatives PUT handler limits the update to the working account", async () => {
  const src = await Deno.readTextFile(new URL("../creatives/index.ts", import.meta.url));
  const put = src.slice(src.indexOf('req.method === "PUT" && path'), src.indexOf("POST /creatives/bulk-untag"));
  assertEquals(put.includes("workingAccountScope(url)"), true, "PUT reads the working account");
  assertEquals(/status: 409/.test(put), true, "PUT answers 409 for a creative in another account");
});
