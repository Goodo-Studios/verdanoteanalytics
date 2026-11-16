import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dispatchScopeError, postWebhook } from "./webhook-dispatch.ts";

Deno.test("dispatch needs the write scope", () => {
  assertEquals(dispatchScopeError(["read", "write"]), null);
  assertMatch(dispatchScopeError(["read"]) ?? "", /write/);
  assertMatch(dispatchScopeError([]) ?? "", /write/);
  assertMatch(dispatchScopeError(null) ?? "", /write/);
});

Deno.test("a refused destination is not fetched and records 0", async () => {
  let fetched = false;
  const status = await postWebhook({ id: "w1", url: "http://169.254.169.254/latest", secret: null }, "{}", {
    fetchImpl: (() => { fetched = true; return Promise.resolve(new Response("x")); }) as typeof fetch,
    assertTarget: () => Promise.reject(new Error("Unsafe destination URL")),
  });
  assertEquals(status, 0);
  assertEquals(fetched, false);
});

Deno.test("redirects are not followed and the status is recorded", async () => {
  let init: RequestInit | undefined;
  const status = await postWebhook({ id: "w2", url: "https://hooks.example.com/x", secret: "s" }, "{}", {
    fetchImpl: ((_u: string, i?: RequestInit) => {
      init = i;
      return Promise.resolve(new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } }));
    }) as typeof fetch,
    assertTarget: (u) => Promise.resolve(new URL(u)),
  });
  assertEquals(status, 302);
  assertEquals(init?.redirect, "manual");
  assertMatch(String((init?.headers as Record<string, string>)["X-Verdanote-Signature"]), /^[0-9a-f]{64}$/);
});

Deno.test("webhooks-dispatch checks the scope and uses the shared staff helper", async () => {
  const src = await Deno.readTextFile(new URL("../webhooks-dispatch/index.ts", import.meta.url));
  assertMatch(src, /dispatchScopeError\(/);
  assertMatch(src, /postWebhook\(/);
  assertMatch(src, /isStaffUser\(/);
  assertEquals(/\.in\("role", \["builder", "employee"\]\)\s*\.maybeSingle\(\)/.test(src), false);
});
