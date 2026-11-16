import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isOwnUploadPath, isSignableVaultPath, mediaKindForPath } from "./vault-paths.ts";

const U = "11111111-1111-4111-8111-111111111111";

Deno.test("signable paths: the folders in use", () => {
  for (const p of [`uploads/${U}/1.mp4`, `atria/${U}/a.mp4`, `analytics/${U}/ad/1.jpg`, `thumbnails/${U}/t.jpg`]) {
    assert(isSignableVaultPath(p), p);
  }
});

Deno.test("signable paths: refuse traversal, absolute, unknown folders and junk", () => {
  for (const p of [
    `uploads/${U}/../other/x.mp4`, `/uploads/${U}/x.mp4`, `uploads//x.mp4`, `secrets/${U}/x`,
    `uploads/${U}`, "", `uploads\\${U}\\x.mp4`, `uploads/./x/y`, null, 42,
  ]) {
    assertEquals(isSignableVaultPath(p), false, String(p));
  }
});

Deno.test("own upload: only the caller's uploads folder, one file deep", () => {
  assert(isOwnUploadPath(`uploads/${U}/1700000000.mp4`, U));
  assertEquals(isOwnUploadPath(`uploads/22222222-2222-4222-8222-222222222222/x.mp4`, U), false);
  assertEquals(isOwnUploadPath(`atria/${U}/x.mp4`, U), false);
  assertEquals(isOwnUploadPath(`uploads/${U}/../${U}/x.mp4`, U), false);
  assertEquals(isOwnUploadPath(`uploads/${U}/a/b.mp4`, U), false);
});

Deno.test("media kind replaces the path on the public page", () => {
  assertEquals(mediaKindForPath("uploads/u/x.PNG"), "image");
  assertEquals(mediaKindForPath("uploads/u/x.mp4"), "video");
  assertEquals(mediaKindForPath(null), null);
});

Deno.test("each signer checks the stored path, and vault-save checks the caller's", async () => {
  const read = (f: string) => Deno.readTextFile(new URL(`../${f}/index.ts`, import.meta.url));
  for (const f of ["vault-transcribe", "vault-analyze", "vault-share-item"]) {
    assert(/isSignableVaultPath\(/.test(await read(f)), `${f} signs without checking the path`);
  }
  assert(/isOwnUploadPath\(/.test(await read("vault-save")), "vault-save accepts any file_path");
});

Deno.test("the public share response does not include file_path", async () => {
  const src = await Deno.readTextFile(new URL("../vault-share-item/index.ts", import.meta.url));
  const cols = src.match(/PUBLIC_ITEM_COLUMNS =([\s\S]*?);/)?.[1] ?? "";
  assertEquals(/file_path/.test(cols), false);
});
