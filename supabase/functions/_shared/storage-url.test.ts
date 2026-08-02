// deno test supabase/functions/_shared/storage-url.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasKnownMediaExtension, parseStoragePublicUrl } from "./storage-url.ts";

Deno.test("parseStoragePublicUrl extracts bucket + path, ignores query string, rejects non-storage URLs", () => {
  const parsed = parseStoragePublicUrl(
    "https://example.supabase.co/storage/v1/object/public/ad-thumbnails/act_1058298398102027/12345.jpg?t=1",
  );
  assertEquals(parsed, { bucket: "ad-thumbnails", path: "act_1058298398102027/12345.jpg" });
  assertEquals(parseStoragePublicUrl("https://scontent.fbcdn.net/v/whatever.jpg"), null);
});

Deno.test("hasKnownMediaExtension: true for jpg/png/mp4/webm, false for the extensionless bug shape", () => {
  assertEquals(hasKnownMediaExtension("act_1/123.jpg"), true);
  assertEquals(hasKnownMediaExtension("act_1/123.PNG"), true, "extension check is case-insensitive");
  assertEquals(hasKnownMediaExtension("act_1/123.mp4"), true);
  assertEquals(hasKnownMediaExtension("act_1/123.webm"), true);
  // The exact bug this guards: no extension at all — just "<account>/<ad_id>".
  assertEquals(hasKnownMediaExtension("act_1/123"), false);
  assertEquals(hasKnownMediaExtension("act_1/123.txt"), false, "unknown extension is not a media path");
  // A dot in the account/ad id segment must not be mistaken for an extension.
  assertEquals(hasKnownMediaExtension("act.1/123"), false);
});
