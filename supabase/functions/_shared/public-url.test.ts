import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertPublicNetworkTarget, isPublicHttpUrl, isPublicIpAddress } from "./public-url.ts";

Deno.test("isPublicHttpUrl allows public HTTPS destinations", () => {
  assertEquals(isPublicHttpUrl("https://example.com/products/widget"), true);
});

Deno.test("isPublicHttpUrl rejects non-HTTP schemes and credentialed URLs", () => {
  assertEquals(isPublicHttpUrl("file:///etc/passwd"), false);
  assertEquals(isPublicHttpUrl("ftp://example.com/file"), false);
  assertEquals(isPublicHttpUrl("https://user:pass@example.com/"), false);
});

Deno.test("isPublicHttpUrl rejects localhost and private or link-local literals", () => {
  for (const url of [
    "http://localhost/admin",
    "http://127.0.0.1/admin",
    "http://10.0.0.1/admin",
    "http://172.16.0.1/admin",
    "http://192.168.1.1/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/admin",
    "http://[fc00::1]/admin",
    "http://[fe80::1]/admin",
  ]) {
    assertEquals(isPublicHttpUrl(url), false, url);
  }
});

Deno.test("isPublicIpAddress rejects special-use addresses returned by DNS", () => {
  for (const ip of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:7f00:1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
  ]) {
    assertEquals(isPublicIpAddress(ip), false, ip);
  }
  assertEquals(isPublicIpAddress("8.8.8.8"), true);
  assertEquals(isPublicIpAddress("2606:4700:4700::1111"), true);
});

Deno.test("assertPublicNetworkTarget rejects DNS names resolving to private IPs", async () => {
  await assertRejects(
    () => assertPublicNetworkTarget("https://metadata.example/", async (_host, type) =>
      type === "A" ? ["169.254.169.254"] : []),
    Error,
    "exclusively to public IPs",
  );
});

Deno.test("assertPublicNetworkTarget fails closed on empty DNS and accepts public answers", async () => {
  await assertRejects(
    () => assertPublicNetworkTarget("https://missing.example/", async () => []),
    Error,
    "exclusively to public IPs",
  );
  const url = await assertPublicNetworkTarget("https://public.example/path", async (_host, type) =>
    type === "A" ? ["8.8.4.4"] : []);
  assertEquals(url.href, "https://public.example/path");
});
