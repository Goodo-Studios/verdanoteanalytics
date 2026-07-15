//   deno test supabase/functions/_shared/media-archive-export.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildExportManifest,
  safeZipEntryName,
  type ArchiveRow,
} from "./media-archive-export.ts";

Deno.test("manifest includes video + thumb, prefers video first, sums bytes", () => {
  const rows: ArchiveRow[] = [
    {
      ad_id: "A",
      video_storage_path: "acct/assets/hashA.mp4",
      video_bucket: "ad-videos",
      thumb_storage_path: "acct/assets/hashA.jpg",
      thumb_bucket: "ad-thumbnails",
      byte_size: 1000,
    },
  ];
  const m = buildExportManifest(rows);
  assertEquals(m.entries.length, 2);
  assertEquals(m.entries[0].kind, "video");
  assertEquals(m.entries[1].kind, "image");
  assertEquals(m.estimatedBytes, 1000);
});

Deno.test("image-only row still exports the thumbnail", () => {
  const rows: ArchiveRow[] = [
    { ad_id: "B", thumb_storage_path: "acct/assets/b.jpg", thumb_bucket: "ad-thumbnails", byte_size: 500 },
  ];
  const m = buildExportManifest(rows);
  assertEquals(m.entries.length, 1);
  assertEquals(m.entries[0].kind, "image");
});

Deno.test("row with no media paths is skipped", () => {
  const rows: ArchiveRow[] = [{ ad_id: "C", byte_size: 0 }];
  assertEquals(buildExportManifest(rows).entries.length, 0);
});

Deno.test("safeZipEntryName keeps extension and sanitizes unsafe chars", () => {
  const used = new Set<string>();
  assertEquals(safeZipEntryName("123:ad/x", "acct/assets/h.mp4", used), "123_ad_x.mp4");
  // Different extension => no collision with the .mp4 above.
  assertEquals(safeZipEntryName("123:ad/x", "acct/assets/h.jpg", used), "123_ad_x.jpg");
});

Deno.test("safeZipEntryName dedupes identical names with a numeric suffix", () => {
  const used = new Set<string>();
  assertEquals(safeZipEntryName("A", "x/h.jpg", used), "A.jpg");
  assertEquals(safeZipEntryName("A", "y/other.jpg", used), "A-2.jpg");
  assertEquals(safeZipEntryName("A", "z/third.jpg", used), "A-3.jpg");
});

Deno.test("safeZipEntryName handles a path with no extension", () => {
  const used = new Set<string>();
  assertEquals(safeZipEntryName("A", "acct/assets/noext", used), "A");
});
