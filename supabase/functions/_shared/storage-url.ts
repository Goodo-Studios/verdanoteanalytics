// Pure, dependency-free helpers for Supabase Storage public URLs and paths.
// No Deno/network imports — testable directly via `deno test` or `vitest`.
//
// Moved here from enrich-thumbnails/index.ts so backfill-thumbnail-storage-path
// (and anything else that needs to derive a storage path from a stored URL) can
// share one implementation instead of re-deriving the marker/parsing logic.

/**
 * Split a Supabase public storage URL into its bucket + object key. Strips any
 * query string. Returns null for non-storage URLs (e.g. a live fbcdn.net CDN url).
 */
export function parseStoragePublicUrl(
  url: string,
): { bucket: string; path: string } | null {
  const marker = "/storage/v1/object/public/";
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const rest = url.slice(i + marker.length).split("?")[0];
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
}

// Extensions every correctly-written thumbnail/video storage path ends in. Kept
// as a single source of truth so the "is this path missing its extension" check
// used by the backfill matches exactly what downloadAndCache() ever writes.
const KNOWN_MEDIA_EXTENSIONS = ["jpg", "png", "mp4", "webm"];

/**
 * True if `path` ends in one of the extensions downloadAndCache() actually
 * writes. A `thumbnail_storage_path` failing this is the extensionless-path bug
 * (creative-diversity US-001 spike, 2026-08-02): the value looks like
 * "act_123/456" instead of "act_123/456.jpg", so the public URL built from it
 * 404/400s even though the real object in Storage has the extension.
 */
export function hasKnownMediaExtension(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return KNOWN_MEDIA_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase());
}
