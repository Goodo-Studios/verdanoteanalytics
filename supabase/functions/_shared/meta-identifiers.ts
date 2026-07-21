// meta-identifiers — Creative Intelligence WS3 (US-014). Pull the Meta creative /
// asset identifiers out of a creative's object_story_spec / asset_feed_spec, which
// the sync ALREADY fetches (fields=creative{effective_object_story_id,
// object_story_spec,asset_feed_spec}) — so persisting them costs no new Meta call.
//
// These are SECONDARY entity anchors (US-015). The PRIMARY within-account exact
// anchor stays media_assets.asset_key (content SHA-256). Kept in its own module
// (not media-discovery.ts) so persisting ids does not force a redeploy of every
// function that imports the media helpers.
//
// Pure + throwing-free: only reads optional fields, returns empties on anything
// unexpected, so callers can run it over partial/unknown Meta payloads.

export interface MetaIdentifiers {
  videoIds: string[]; // ordered; dynamic (asset_feed_spec) ads can carry multiple
  imageHashes: string[];
  effectiveObjectStoryId: string | null; // the published post id (page_post)
  creativeId: string | null; // Meta's creative node id, when present
}

function pushUnique(arr: string[], v: unknown): void {
  if (v === null || v === undefined) return;
  const s = String(v).trim();
  if (s && !arr.includes(s)) arr.push(s);
}

// deno-lint-ignore no-explicit-any
export function extractMetaIdentifiers(creative: any): MetaIdentifiers {
  const videoIds: string[] = [];
  const imageHashes: string[] = [];

  const oss = creative?.object_story_spec;
  if (oss) {
    pushUnique(videoIds, oss.video_data?.video_id);
    pushUnique(imageHashes, oss.link_data?.image_hash);
    pushUnique(imageHashes, oss.photo_data?.image_hash);
    for (const c of oss.link_data?.child_attachments ?? []) {
      pushUnique(imageHashes, c?.image_hash);
      pushUnique(videoIds, c?.video_id);
    }
  }

  const afs = creative?.asset_feed_spec;
  if (afs) {
    for (const v of afs.videos ?? []) pushUnique(videoIds, v?.video_id);
    for (const im of afs.images ?? []) pushUnique(imageHashes, im?.hash);
  }

  return {
    videoIds,
    imageHashes,
    effectiveObjectStoryId: creative?.effective_object_story_id ?? null,
    creativeId: creative?.id ?? null,
  };
}
