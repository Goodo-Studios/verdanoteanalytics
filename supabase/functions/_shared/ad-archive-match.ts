// =============================================================================
// ad-archive-match — US-001B match-back core (pure, unit-testable)
// =============================================================================
// Resolving `creatives.ad_archive_id` means taking an ad returned by the Meta Ad
// Library (either the FREE Graph `ads_archive` API, or the Apify page-harvest
// fallback actor) and deciding WHICH of our creatives it corresponds to. This
// module is the single, dependency-light, side-effect-free brain for that:
//
//   1. `normalizeGraphAd` / `normalizeApifyItem` fold either upstream shape into
//      one `NormalizedAdLibraryAd` carrying whatever anchors that source exposes.
//   2. `buildCreativeIndex` builds the reverse lookups from our creative rows.
//   3. `matchAd` applies the acceptance priority the story mandates:
//        effective_object_story_id  →  meta_video_ids / meta_image_hashes
//        →  linkUrl  →  ad-copy fuzzy (last resort).
//
// WHY the two families of tiers behave differently:
//   • STORY / VIDEO / IMAGE are EXACT identity anchors. A single Ad Library ad
//     legitimately maps to MANY of our creatives (e.g. the same boosted post run
//     as several ad-manager ads shares one effective_object_story_id, hence one
//     Ad Library entry). So an exact-anchor hit returns EVERY matching creative.
//   • LINK / AD-COPY are FUZZY. A destination URL or a body string is shared by
//     dozens of unrelated ads, so a fuzzy tier only accepts a UNIQUE best match —
//     ambiguity yields no match rather than a wrong ad_archive_id (a wrong id is
//     worse than an unresolved one: US-002 would then capture the wrong ad).
//
// Reality note (recorded so downstream stories trust the tiers): the FREE Graph
// `ads_archive` API returns only `id`, `ad_snapshot_url`, and creative COPY
// (bodies/titles/captions/descriptions) — it does NOT expose story id, video id,
// or image hash. So free-path matches can only ever land in the link / ad-copy
// tiers. The exact-anchor tiers fire for the Apify snapshot path (and any future
// enrichment) that carries those identifiers. The matcher degrades gracefully to
// whatever anchors are actually present.
// =============================================================================

import { normalizeDestinationUrl } from "./normalize-destination.ts";

// ── Public shapes ────────────────────────────────────────────────────────────

/** A single Ad Library ad, folded to the anchors we can match on. */
export interface NormalizedAdLibraryAd {
  adArchiveId: string;
  pageId: string | null;
  /** effective_object_story_id (`{page_id}_{post_id}`) when derivable, else null. */
  storyId: string | null;
  /** Meta internal video ids, when the source exposes them (usually Apify only). */
  videoIds: string[];
  /** Meta image hashes, when the source exposes them (usually Apify only). */
  imageHashes: string[];
  /** Normalized destination URLs pulled from the ad. */
  linkUrls: string[];
  /** Normalized copy tokens for the fuzzy last-resort tier. */
  textTokens: string[];
  /** Raw concatenated copy, kept only for logging/debugging. */
  rawText: string;
}

/** The subset of a `creatives` row this module needs. */
export interface CreativeForMatch {
  ad_id: string;
  account_id?: string | null;
  ad_name?: string | null;
  campaign_name?: string | null;
  effective_object_story_id?: string | null;
  meta_video_ids?: string[] | null;
  meta_image_hashes?: string[] | null;
  destination_key?: string | null;
  ad_post_url?: string | null;
}

/** Reverse lookups over a set of creatives, built once per sweep. */
export interface CreativeIndex {
  byStoryId: Map<string, string[]>;
  byVideoId: Map<string, string[]>;
  byImageHash: Map<string, string[]>;
  byLink: Map<string, string[]>;
  /** ad_id → normalized copy token set (for the fuzzy tier). */
  tokensByAdId: Map<string, Set<string>>;
  adIds: string[];
}

export type MatchTier =
  | "story_id"
  | "video_id"
  | "image_hash"
  | "link_url"
  | "ad_copy";

export interface MatchResult {
  /** Every creative ad_id this Ad Library ad resolves to (many for exact tiers). */
  adIds: string[];
  tier: MatchTier;
  /** 0..1 score; 1 for exact-anchor tiers, Jaccard overlap for ad_copy. */
  confidence: number;
}

// ── Text / link normalization ────────────────────────────────────────────────

// Small English stopword set — enough to stop generic ad boilerplate ("shop now",
// "the best") from dominating the fuzzy overlap. Kept short on purpose.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "to", "of", "in", "on", "at",
  "is", "are", "be", "with", "your", "you", "our", "we", "it", "this", "that",
  "now", "get", "new", "best", "all", "off", "up", "out", "from", "by", "as",
  "shop", "buy", "free", "today", "more", "just", "can", "will", "have", "has",
]);

/**
 * Lowercase, strip everything but latin word chars + digits, split, drop
 * stopwords and <3-char tokens, dedupe into a Set. Pure.
 */
export function tokenizeCopy(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  const cleaned = String(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ") // URLs are matched by the link tier, not copy
    .replace(/[^a-z0-9\s]/g, " ");
  for (const tok of cleaned.split(/\s+/)) {
    if (tok.length >= 3 && !STOPWORDS.has(tok)) out.add(tok);
  }
  return out;
}

/** Jaccard overlap between two token sets. 0 when either is empty. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Minimum Jaccard for a fuzzy ad-copy match to be considered at all. */
export const AD_COPY_MIN_JACCARD = 0.34;
/** The best fuzzy candidate must beat the runner-up by at least this margin. */
export const AD_COPY_MIN_MARGIN = 0.12;

/**
 * Derive `{page_id}_{post_id}` from a page id + a post/story id, or pass through a
 * value that already looks like a full story id. Returns null when not derivable.
 */
export function buildStoryId(
  pageId: string | null | undefined,
  postOrStoryId: string | null | undefined,
): string | null {
  const post = postOrStoryId == null ? "" : String(postOrStoryId).trim();
  if (!post) return null;
  if (post.includes("_")) return post; // already a full story id
  const page = pageId == null ? "" : String(pageId).trim();
  if (!page) return null;
  return `${page}_${post}`;
}

function pushUnique(arr: string[], v: unknown): void {
  if (v == null) return;
  const s = String(v).trim();
  if (s && !arr.includes(s)) arr.push(s);
}

// ── Normalizers ──────────────────────────────────────────────────────────────

/**
 * Normalize a FREE Graph `ads_archive` ad object. Available anchors are limited to
 * the archive id, page id, and creative COPY (+ any caption that reads like a
 * domain). No story/video/image identifiers exist on this payload.
 */
// deno-lint-ignore no-explicit-any
export function normalizeGraphAd(raw: any): NormalizedAdLibraryAd | null {
  const adArchiveId = raw?.id == null ? "" : String(raw.id).trim();
  if (!adArchiveId) return null;

  const bodies: string[] = raw?.ad_creative_bodies ?? [];
  const titles: string[] = raw?.ad_creative_link_titles ?? [];
  const captions: string[] = raw?.ad_creative_link_captions ?? [];
  const descriptions: string[] = raw?.ad_creative_link_descriptions ?? [];

  const linkUrls: string[] = [];
  // Captions are frequently a bare display domain ("example.com"); treat each as a
  // possible destination so the link tier can fire on the free path.
  for (const c of captions) {
    const norm = normalizeDestinationUrl(c);
    if (norm) pushUnique(linkUrls, norm);
  }

  const rawText = [...bodies, ...titles, ...captions, ...descriptions]
    .filter(Boolean)
    .join(" — ");

  return {
    adArchiveId,
    pageId: raw?.page_id == null ? null : String(raw.page_id),
    storyId: null,
    videoIds: [],
    imageHashes: [],
    linkUrls,
    textTokens: [...tokenizeCopy(rawText)],
    rawText,
  };
}

/**
 * Normalize an Apify `apify~facebook-ads-scraper` item (v2 snapshot shape). This
 * source can expose a page id, link urls, and (version-dependent) media ids; it
 * carries a null top-level `adId`, so we key strictly on `adArchiveID`.
 */
// deno-lint-ignore no-explicit-any
export function normalizeApifyItem(raw: any): NormalizedAdLibraryAd | null {
  const adArchiveId = String(
    raw?.adArchiveID ?? raw?.ad_archive_id ?? raw?.adArchiveId ?? "",
  ).trim();
  if (!adArchiveId) return null;

  const snap = raw?.snapshot ?? {};
  const pageId = raw?.pageId ?? raw?.page_id ?? snap?.pageId ?? snap?.page_id ?? null;

  const videoIds: string[] = [];
  const imageHashes: string[] = [];
  const linkUrls: string[] = [];
  const texts: string[] = [];

  const addLink = (v: unknown) => {
    const norm = normalizeDestinationUrl(typeof v === "string" ? v : null);
    if (norm) pushUnique(linkUrls, norm);
  };
  const addText = (v: unknown) => {
    if (typeof v === "string" && v.trim()) texts.push(v.trim());
  };

  // Top-level snapshot copy + link.
  addText(snap?.body?.text ?? snap?.body?.markup?.__html ?? snap?.body);
  addText(snap?.title);
  addText(snap?.caption);
  addText(snap?.linkDescription ?? snap?.link_description);
  addLink(snap?.linkUrl ?? snap?.link_url);
  addLink(snap?.caption); // caption is often a display domain

  // Videos: URLs only on most versions, but capture any exposed id/hash.
  for (const v of snap?.videos ?? []) {
    pushUnique(videoIds, v?.videoId ?? v?.video_id);
  }
  // Images: capture hash when a version exposes it.
  for (const im of snap?.images ?? []) {
    pushUnique(imageHashes, im?.hash ?? im?.imageHash ?? im?.image_hash);
  }
  // Carousel cards carry per-card copy + link.
  for (const card of snap?.cards ?? []) {
    addText(card?.body);
    addText(card?.title);
    addLink(card?.linkUrl ?? card?.link_url);
    pushUnique(videoIds, card?.videoId ?? card?.video_id);
  }

  // Story id: Ad Library snapshots don't carry effective_object_story_id directly,
  // but some expose the underlying page-post id — fold it with the page id if so.
  const storyId = buildStoryId(
    pageId,
    snap?.effectiveObjectStoryId ?? snap?.effective_object_story_id ??
      snap?.postId ?? snap?.post_id ?? null,
  );

  const rawText = texts.join(" — ");
  return {
    adArchiveId,
    pageId: pageId == null ? null : String(pageId),
    storyId: storyId ?? (snap?.effectiveObjectStoryId ?? null),
    videoIds,
    imageHashes,
    linkUrls,
    textTokens: [...tokenizeCopy(rawText)],
    rawText,
  };
}

// ── Index + matcher ──────────────────────────────────────────────────────────

function addToBucket(map: Map<string, string[]>, key: string, adId: string): void {
  const arr = map.get(key);
  if (arr) {
    if (!arr.includes(adId)) arr.push(adId);
  } else {
    map.set(key, [adId]);
  }
}

/**
 * Build reverse lookups over the creatives to resolve. Link keys use the stored
 * `destination_key` (already normalized by normalize-destination) plus a
 * normalization of `ad_post_url` as a fallback anchor.
 */
export function buildCreativeIndex(creatives: CreativeForMatch[]): CreativeIndex {
  const byStoryId = new Map<string, string[]>();
  const byVideoId = new Map<string, string[]>();
  const byImageHash = new Map<string, string[]>();
  const byLink = new Map<string, string[]>();
  const tokensByAdId = new Map<string, Set<string>>();
  const adIds: string[] = [];

  for (const c of creatives) {
    const adId = c.ad_id;
    if (!adId) continue;
    adIds.push(adId);

    if (c.effective_object_story_id) {
      addToBucket(byStoryId, String(c.effective_object_story_id), adId);
    }
    for (const vid of c.meta_video_ids ?? []) {
      if (vid) addToBucket(byVideoId, String(vid), adId);
    }
    for (const h of c.meta_image_hashes ?? []) {
      if (h) addToBucket(byImageHash, String(h), adId);
    }
    if (c.destination_key) addToBucket(byLink, String(c.destination_key), adId);
    const postNorm = normalizeDestinationUrl(c.ad_post_url ?? null);
    if (postNorm) addToBucket(byLink, postNorm, adId);

    // Fuzzy anchor: ad name + campaign name tokens (creatives don't store ad copy).
    tokensByAdId.set(
      adId,
      tokenizeCopy(`${c.ad_name ?? ""} ${c.campaign_name ?? ""}`),
    );
  }

  return { byStoryId, byVideoId, byImageHash, byLink, tokensByAdId, adIds };
}

function unionFromKeys(map: Map<string, string[]>, keys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    for (const adId of map.get(k) ?? []) {
      if (!out.includes(adId)) out.push(adId);
    }
  }
  return out;
}

/**
 * Resolve a normalized Ad Library ad to creative ad_id(s), applying the mandated
 * acceptance priority. Returns null when no tier produces an accepted match.
 *
 * Exact-anchor tiers (story/video/image) accept every matching creative.
 * Fuzzy tiers (link/ad_copy) accept only a UNIQUE best match.
 */
export function matchAd(
  ad: NormalizedAdLibraryAd,
  index: CreativeIndex,
): MatchResult | null {
  // 1. effective_object_story_id — strongest anchor.
  if (ad.storyId) {
    const hits = index.byStoryId.get(ad.storyId);
    if (hits && hits.length) return { adIds: [...hits], tier: "story_id", confidence: 1 };
  }

  // 2. meta_video_ids.
  if (ad.videoIds.length) {
    const hits = unionFromKeys(index.byVideoId, ad.videoIds);
    if (hits.length) return { adIds: hits, tier: "video_id", confidence: 1 };
  }

  // 3. meta_image_hashes.
  if (ad.imageHashes.length) {
    const hits = unionFromKeys(index.byImageHash, ad.imageHashes);
    if (hits.length) return { adIds: hits, tier: "image_hash", confidence: 1 };
  }

  // 4. link url — fuzzy: accept only when it maps to exactly one creative.
  if (ad.linkUrls.length) {
    const hits = unionFromKeys(index.byLink, ad.linkUrls);
    if (hits.length === 1) return { adIds: hits, tier: "link_url", confidence: 0.8 };
    // >1 distinct creatives share this destination → too ambiguous, fall through.
  }

  // 5. ad-copy fuzzy — last resort. Unique best above threshold + margin.
  if (ad.textTokens.length) {
    const adTokens = new Set(ad.textTokens);
    let bestId: string | null = null;
    let bestScore = 0;
    let secondScore = 0;
    for (const [adId, toks] of index.tokensByAdId) {
      const score = jaccard(adTokens, toks);
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        bestId = adId;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
    if (
      bestId &&
      bestScore >= AD_COPY_MIN_JACCARD &&
      bestScore - secondScore >= AD_COPY_MIN_MARGIN
    ) {
      return { adIds: [bestId], tier: "ad_copy", confidence: bestScore };
    }
  }

  return null;
}
