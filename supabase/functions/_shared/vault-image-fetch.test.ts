import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchImageAsDataUrl } from "./vault-image-fetch.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const publicOnly = (u: string) => {
  const url = new URL(u);
  if (["127.0.0.1", "169.254.169.254", "10.0.0.5", "localhost"].includes(url.hostname)) {
    return Promise.reject(new Error("Unsafe destination URL"));
  }
  return Promise.resolve(url);
};

Deno.test("an internal address is refused before any fetch", async () => {
  let calls = 0;
  const out = await fetchImageAsDataUrl("http://169.254.169.254/latest/meta-data", {
    fetchImpl: (() => { calls++; return Promise.resolve(new Response(PNG)); }) as typeof fetch,
    assertTarget: publicOnly,
  });
  assertEquals(out, null);
  assertEquals(calls, 0);
});

Deno.test("a redirect to an internal address is refused", async () => {
  const seen: string[] = [];
  const out = await fetchImageAsDataUrl("https://cdn.example.com/a.png", {
    fetchImpl: ((u: string) => {
      seen.push(u);
      return Promise.resolve(new Response(null, { status: 302, headers: { location: "http://10.0.0.5/x.png" } }));
    }) as typeof fetch,
    assertTarget: publicOnly,
  });
  assertEquals(out, null);
  assertEquals(seen, ["https://cdn.example.com/a.png"]);
});

Deno.test("a public redirect is followed and the image is returned", async () => {
  const out = await fetchImageAsDataUrl("https://cdn.example.com/a", {
    fetchImpl: ((u: string, init?: RequestInit) => {
      assertEquals(init?.redirect, "manual");
      if (u.endsWith("/a")) {
        return Promise.resolve(new Response(null, { status: 301, headers: { location: "/b.png" } }));
      }
      return Promise.resolve(new Response(PNG, { headers: { "content-type": "image/jpeg" } }));
    }) as typeof fetch,
    assertTarget: publicOnly,
  });
  assert(out?.startsWith("data:image/png;base64,"), String(out));
});

Deno.test("redirect loops stop", async () => {
  let calls = 0;
  const out = await fetchImageAsDataUrl("https://cdn.example.com/loop", {
    fetchImpl: (() => {
      calls++;
      return Promise.resolve(new Response(null, { status: 302, headers: { location: "https://cdn.example.com/loop" } }));
    }) as typeof fetch,
    assertTarget: publicOnly,
  });
  assertEquals(out, null);
  assertEquals(calls, 4);
});

Deno.test("vault-analyze uses the guarded downloader", async () => {
  const src = await Deno.readTextFile(new URL("../vault-analyze/index.ts", import.meta.url));
  assert(/from "\.\.\/_shared\/vault-image-fetch\.ts"/.test(src), "vault-analyze does not import the guarded downloader");
  assertEquals(/async function fetchImageAsDataUrl/.test(src), false);
});
