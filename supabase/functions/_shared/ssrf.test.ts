// Tests for the SSRF host-allowlist guards.
//   deno test -A supabase/functions/_shared/ssrf.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
const { isAllowedMediaUrl, isAllowedFacebookUrl, isPublicHttpUrl } = await import("./ssrf.ts");

Deno.test("isAllowedMediaUrl allows Meta CDNs and own Supabase storage over https", () => {
  assertEquals(isAllowedMediaUrl("https://scontent.fbcdn.net/v/x.jpg"), true);
  assertEquals(isAllowedMediaUrl("https://z.cdninstagram.com/x.mp4"), true);
  assertEquals(isAllowedMediaUrl("https://proj.supabase.co/storage/v1/object/public/x"), true);
});

Deno.test("isAllowedMediaUrl blocks internal targets, other hosts, and non-https", () => {
  assertEquals(isAllowedMediaUrl("http://169.254.169.254/latest/meta-data/"), false);
  assertEquals(isAllowedMediaUrl("https://evil.example.com/x.jpg"), false);
  assertEquals(isAllowedMediaUrl("http://scontent.fbcdn.net/x.jpg"), false); // not https
  assertEquals(isAllowedMediaUrl("file:///etc/passwd"), false);
  // suffix-match must be on a dot boundary, not a lookalike domain
  assertEquals(isAllowedMediaUrl("https://fbcdn.net.evil.com/x"), false);
});

Deno.test("isAllowedFacebookUrl allows only facebook/fb hosts", () => {
  assertEquals(isAllowedFacebookUrl("https://www.facebook.com/ads/library?id=1"), true);
  assertEquals(isAllowedFacebookUrl("https://facebook.com/x"), true);
  assertEquals(isAllowedFacebookUrl("http://169.254.169.254/?view_all_page_id=1"), false);
  assertEquals(isAllowedFacebookUrl("https://facebook.com.evil.com/x"), false);
});

Deno.test("isPublicHttpUrl blocks private/loopback/link-local IPs and non-https", () => {
  assertEquals(isPublicHttpUrl("https://cdn.example.com/v.mp4"), true);
  assertEquals(isPublicHttpUrl("https://169.254.169.254/"), false);
  assertEquals(isPublicHttpUrl("https://127.0.0.1/"), false);
  assertEquals(isPublicHttpUrl("https://10.0.0.5/"), false);
  assertEquals(isPublicHttpUrl("https://192.168.1.1/"), false);
  assertEquals(isPublicHttpUrl("https://172.16.0.1/"), false);
  assertEquals(isPublicHttpUrl("https://localhost/"), false);
  assertEquals(isPublicHttpUrl("https://[::1]/"), false);
  assertEquals(isPublicHttpUrl("http://cdn.example.com/v.mp4"), false); // not https
});
