import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clientIp, clientKey } from "./public-link.ts";

const h = (o: Record<string, string>) => new Headers(o);

Deno.test("cf-connecting-ip wins over x-forwarded-for", () => {
  assertEquals(clientIp(h({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9, 2.2.2.2" })), "1.1.1.1");
});

Deno.test("a forged first x-forwarded-for entry is ignored: the trusted proxy's entry is used", () => {
  // The client sent "6.6.6.6"; the trusted proxy appended the real peer "2.2.2.2".
  assertEquals(clientIp(h({ "x-forwarded-for": "6.6.6.6, 2.2.2.2" })), "2.2.2.2");
});

Deno.test("hops selects the entry counted from the right", () => {
  assertEquals(clientIp(h({ "x-forwarded-for": "6.6.6.6, 3.3.3.3, 2.2.2.2" }), 2), "3.3.3.3");
  assertEquals(clientIp(h({ "x-forwarded-for": "2.2.2.2" }), 5), "2.2.2.2");
});

Deno.test("no headers is unknown", () => {
  assertEquals(clientIp(h({})), "unknown");
});

Deno.test("spoofing the first x-forwarded-for entry does not change the rate limit key", async () => {
  const a = await clientKey(new Request("http://x", { headers: { "x-forwarded-for": "6.6.6.6, 2.2.2.2" } }));
  const b = await clientKey(new Request("http://x", { headers: { "x-forwarded-for": "7.7.7.7, 2.2.2.2" } }));
  const c = await clientKey(new Request("http://x", { headers: { "x-forwarded-for": "7.7.7.7, 4.4.4.4" } }));
  assertEquals(a, b);
  assertNotEquals(a, c);
});
