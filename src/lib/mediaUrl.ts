/**
 * Frontend guard for the media-URL sentinels written by the discovery pipeline.
 *
 * `creatives.thumbnail_url` / `video_url` are never NULL once discovery has run —
 * a discovered-but-absent asset is stored as a sentinel string ("no-video",
 * "no-thumbnail", …). A plain truthiness check therefore always reads as "has
 * media", and the sentinel gets rendered as a real URL: `<img src="no-thumbnail">`
 * (broken-image icon) or an anchor pointing at a relative "no-video" path.
 *
 * Source of truth for the sentinel values is
 * `supabase/functions/_shared/media-discovery.ts`. That module is Deno-flavoured
 * (remote `https://` imports) so it cannot be pulled into the Vite bundle; the
 * values are mirrored here and `src/test/mediaUrl.test.ts` asserts the two sets
 * stay in lockstep.
 */

/** Every value that means "we looked, and there is no renderable asset". */
export const MEDIA_SENTINELS: ReadonlySet<string> = new Set([
  "no-thumbnail",
  "no-video",
  "no-video-permission",
  "no-video-deleted",
  "no-video-oversized",
  "no-cover-media",
]);

/** True when the column holds a sentinel (or nothing) rather than a real URL. */
export function isMediaSentinel(url: string | null | undefined): boolean {
  return !url || MEDIA_SENTINELS.has(url);
}

/**
 * Narrow a media column to a URL that is safe to hand to `<img src>` / `<a href>`.
 * Returns null for sentinels, blanks, and anything that isn't an http(s) URL —
 * so a future sentinel value we haven't mirrored yet still fails closed.
 */
export function realMediaUrl(url: string | null | undefined): string | null {
  if (isMediaSentinel(url)) return null;
  return url!.startsWith("http") ? url! : null;
}
