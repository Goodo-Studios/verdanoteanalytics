// F3 bulk-zip export — pure, testable helpers.
//
// The creative-media-archive edge function inlines two pure decisions: turning
// media_archive rows into a flat list of (bucket, path) download entries + an
// estimated total size, and generating a collision-free, path-safe zip entry
// name for each stored object. Extracted here so they can be unit-tested under
// `deno test` with no storage/network. Dependency-free.

export interface ArchiveRow {
  ad_id: string;
  thumb_storage_path?: string | null;
  video_storage_path?: string | null;
  thumb_bucket?: string | null;
  video_bucket?: string | null;
  byte_size?: number | null;
}

export interface ExportEntry {
  adId: string;
  bucket: string;
  path: string;
  kind: "video" | "image";
}

export interface ExportManifest {
  entries: ExportEntry[];
  estimatedBytes: number;
}

/**
 * Flatten archive rows into downloadable entries. Prefers the VIDEO copy when
 * present (the primary creative asset), always also includes the thumbnail so an
 * image-only creative still exports something. Rows with neither path are
 * skipped. estimatedBytes sums the rows' recorded byte_size (0 when unknown).
 */
export function buildExportManifest(rows: ArchiveRow[]): ExportManifest {
  const entries: ExportEntry[] = [];
  let estimatedBytes = 0;
  for (const r of rows) {
    if (r.video_storage_path && r.video_bucket) {
      entries.push({ adId: r.ad_id, bucket: r.video_bucket, path: r.video_storage_path, kind: "video" });
    }
    if (r.thumb_storage_path && r.thumb_bucket) {
      entries.push({ adId: r.ad_id, bucket: r.thumb_bucket, path: r.thumb_storage_path, kind: "image" });
    }
    estimatedBytes += Number(r.byte_size) || 0;
  }
  return { entries, estimatedBytes };
}

/**
 * Build a collision-free, filesystem-safe zip entry name for a stored object.
 * Uses the ad_id as a stable prefix + the object's extension, sanitizing any
 * characters that are awkward in a filename. Appends -2, -3, … on collision
 * (an ad with both a video and a thumbnail, or duplicate ad_ids).
 */
export function safeZipEntryName(adId: string, storagePath: string, used: Set<string>): string {
  const dot = storagePath.lastIndexOf(".");
  const ext = dot >= 0 ? storagePath.slice(dot).replace(/[^.a-zA-Z0-9]/g, "") : "";
  const safeAd = String(adId).replace(/[^a-zA-Z0-9_-]/g, "_") || "creative";
  let name = `${safeAd}${ext}`;
  let n = 2;
  while (used.has(name)) {
    name = `${safeAd}-${n}${ext}`;
    n++;
  }
  used.add(name);
  return name;
}
