// =============================================================================
// apify-capture-logic — PURE, I/O-free decision + parse helpers for US-002.
// =============================================================================
// Everything the apify-capture edge function decides that does NOT touch the
// network, Deno, or Supabase lives here so it can be unit-tested with fixtures
// (deno test) shaped from the US-000 real actor output. index.ts is then a thin
// shell: gate -> run actor -> download+store -> update rows, delegating every
// branch to a function in this file.
//
// Locked facts from US-000 (see companies/verdanote/projects/apify-creative-
// capture/US-000-spike.md — do not deviate):
//   * The ONLY per-ad URL that works is the Ad-Library ?id=<ad_archive_id> lookup
//     enriched with active_status=all & ad_type=all & country=ALL. Post/page URLs
//     trigger uncappable, unmatchable whole-page scrapes and are NEVER sent.
//   * Actor apify~facebook-ads-scraper is PAY_PER_EVENT at $0.005 per returned
//     dataset item. A single ?id= lookup returns EXACTLY ONE billed item — even
//     an empty/private ad, which comes back as ONE item shaped
//     {"error":"no_items","errorDescription":"Empty or private data for provided input"}.
//   * Output media: videos at snapshot.videos[].videoHdUrl|videoSdUrl (prefer HD),
//     statics at snapshot.images[].originalImageUrl, carousel at snapshot.cards[].
//     item.adArchiveID is present; item.adId is null (never match on adId).
// =============================================================================

// -- Cost (US-000 section 4: PAY_PER_EVENT, $0.005 per returned dataset item) --
export const APIFY_COST_PER_ITEM_USD = 0.005;

// Retry cap (AC#5): at most 3 attempts, then terminal 'failed'.
export const APIFY_MAX_ATTEMPTS = 3;

// Storage-ownership marker — the TS mirror of the SQL predicate
// `%/storage/v1/object/public/%` used for "already covered" (US-000 section 8:
// storage-owned media = video_url OR full_res_url matching that pattern). Kept as
// a local constant (not an import of media-discovery.isStorageUrl) so this module
// stays dependency-free and unit-testable without the Deno fetch runtime; the two
// predicates are intentionally identical.
export const STORAGE_URL_MARKER = "/storage/v1/object/public/";

/** True when a url is a permanent Supabase-Storage (owned) url, not a CDN link. */
export function isStorageOwnedUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.includes(STORAGE_URL_MARKER);
}

// -- 1. URL builder -----------------------------------------------------------
/**
 * Build THE locked, only-ever-sent Ad-Library URL for a resolved ad_archive_id.
 * This is the single URL shape the actor is ever given (US-000 section 5); the
 * active_status/ad_type/country=ALL enrichment is required and confirmed
 * necessary. Never build post URLs or page URLs — they scrape the whole
 * advertiser page (uncappable, unmatchable).
 */
export function buildAdArchiveUrl(adArchiveId: string): string {
  const id = encodeURIComponent(String(adArchiveId));
  return `https://www.facebook.com/ads/library/?id=${id}&active_status=all&ad_type=all&country=ALL`;
}

// -- 2. Actor-result parser ---------------------------------------------------
export interface ParsedCard {
  video: string | null;
  image: string | null;
}
export interface ParsedCapture {
  /** The actor returned at least one non-error item. */
  found: boolean;
  /** The ad archive returned nothing usable — either a zero-length dataset OR
   *  the single {"error":"no_items"} item the actor bills for an empty/private ad. */
  empty: boolean;
  adArchiveId: string | null;
  /** Best single video CDN url (HD preferred), from snapshot.videos[] or a card. */
  video: string | null;
  /** Best single image/thumbnail CDN url (originalImageUrl / video preview / card). */
  image: string | null;
  /** Carousel frames in order (snapshot.cards[]), each with its media urls. */
  cards: ParsedCard[];
  isCarousel: boolean;
}

// deno-lint-ignore no-explicit-any
type AnyItem = Record<string, any>;

function pickUrl(...cands: unknown[]): string | null {
  for (const c of cands) {
    if (typeof c === "string" && c.startsWith("http")) return c;
  }
  return null;
}

function cardVideo(card: AnyItem): string | null {
  return pickUrl(
    card?.videoHdUrl, card?.videoSdUrl,
    card?.video_hd_url, card?.video_sd_url,
    card?.videoUrl, card?.video_url,
  );
}
function cardImage(card: AnyItem): string | null {
  return pickUrl(
    card?.originalImageUrl, card?.original_image_url,
    card?.resizedImageUrl, card?.resized_image_url,
    card?.imageUrl, card?.image_url, card?.url,
  );
}

/**
 * Normalize the actor's dataset items (from run-sync-get-dataset-items) into the
 * fields the capture pipeline needs. Handles the three US-000 shapes:
 *   * real ad       -> items[0] with snapshot.videos / snapshot.images / cards
 *   * empty/private -> items[0] = {"error":"no_items", ...}  (still one billed item)
 *   * no dataset    -> items = []  (defensive; the actor normally returns the error item)
 * Pure: takes the already-parsed JSON, returns a plain object. No I/O.
 */
export function parseApifyCaptureResult(items: unknown): ParsedCapture {
  const emptyResult = (): ParsedCapture => ({
    found: false, empty: true, adArchiveId: null,
    video: null, image: null, cards: [], isCarousel: false,
  });

  if (!Array.isArray(items) || items.length === 0) return emptyResult();
  const item = items[0] as AnyItem;
  // The actor bills an empty/private lookup as a single error item (no snapshot).
  if (item?.error === "no_items" || (typeof item?.error === "string" && !item?.snapshot)) {
    return emptyResult();
  }

  const adArchiveId =
    (item?.adArchiveID ?? item?.ad_archive_id ?? item?.adArchiveId ?? null) as string | null;
  const snap: AnyItem = item?.snapshot ?? {};

  const videos: AnyItem[] = Array.isArray(snap?.videos) ? snap.videos : [];
  const images: AnyItem[] = Array.isArray(snap?.images) ? snap.images : [];
  const rawCards: AnyItem[] = Array.isArray(snap?.cards) ? snap.cards : [];

  // Primary video: first snapshot.videos[] (HD preferred), else first card w/ video.
  let video: string | null = null;
  if (videos.length > 0) {
    const v = videos[0];
    video = pickUrl(
      v?.videoHdUrl, v?.videoSdUrl,
      v?.video_hd_url, v?.video_sd_url,
      v?.videoUrl, v?.video_url, v?.url, v?.src,
    );
  }
  if (!video) {
    for (const c of rawCards) {
      const cv = cardVideo(c);
      if (cv) { video = cv; break; }
    }
  }

  // Primary image/thumbnail: snapshot.images[].originalImageUrl, else the video's
  // preview image, else the first card image.
  let image: string | null = null;
  if (images.length > 0) {
    const im = images[0];
    image = pickUrl(
      im?.originalImageUrl, im?.original_image_url,
      im?.resizedImageUrl, im?.resized_image_url,
      im?.url, im?.src,
    );
  }
  if (!image && videos.length > 0) {
    image = pickUrl(
      videos[0]?.videoPreviewImageUrl, videos[0]?.video_preview_image_url,
      videos[0]?.thumbnailUrl, videos[0]?.thumbnail_url,
    );
  }
  if (!image) {
    for (const c of rawCards) {
      const ci = cardImage(c);
      if (ci) { image = ci; break; }
    }
  }

  const cards: ParsedCard[] = rawCards.map((c) => ({ video: cardVideo(c), image: cardImage(c) }));
  const isCarousel = cards.length > 1;

  return {
    found: true,
    empty: !video && !image && !cards.some((c) => c.video || c.image),
    adArchiveId,
    video,
    image,
    cards,
    isCarousel,
  };
}

// -- 3. Retry / backoff decision (AC#5) ---------------------------------------
// Exponential backoff BETWEEN attempts, enforced by comparing last_attempt_at,
// because the caller is a cron drain that would otherwise re-run every tick. The
// nth attempt (n = attempts already made) must wait base*2^(n-1) before running.
export const APIFY_BACKOFF_BASE_MS = 30 * 60 * 1000; // 30 min

/** Minimum wait (ms) required before the next attempt, given how many attempts
 *  have already been made. attempts<=0 => 0 (never tried -> run immediately). */
export function apifyBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return APIFY_BACKOFF_BASE_MS * 2 ** (attempts - 1);
}

export type RetryAction = "run" | "backoff" | "terminal";
export interface RetryDecisionInput {
  attempts: number;
  lastAttemptAt: string | number | Date | null | undefined;
  now: number;
  maxAttempts?: number;
  force?: boolean;
}
export interface RetryDecision {
  action: RetryAction;
  /** Epoch ms the row becomes eligible again (only for action === 'backoff'). */
  nextEligibleAt?: number;
}

/**
 * Decide whether to run the actor for a creative given its attempt bookkeeping.
 *   * attempts >= max         -> 'terminal' (caller marks apify_capture_status='failed')
 *   * within backoff window   -> 'backoff'  (skip this drain tick, no attempt burned)
 *   * otherwise               -> 'run'
 * force bypasses BOTH the attempt cap and the backoff window (operator recapture).
 */
export function retryDecision(input: RetryDecisionInput): RetryDecision {
  const { attempts, lastAttemptAt, now, force } = input;
  const max = input.maxAttempts ?? APIFY_MAX_ATTEMPTS;
  if (force) return { action: "run" };
  if (attempts >= max) return { action: "terminal" };
  if (attempts > 0 && lastAttemptAt != null) {
    const last = new Date(lastAttemptAt).getTime();
    if (!Number.isNaN(last)) {
      const eligibleAt = last + apifyBackoffMs(attempts);
      if (now < eligibleAt) return { action: "backoff", nextEligibleAt: eligibleAt };
    }
  }
  return { action: "run" };
}

// -- 4. Budget decision (AC#2) ------------------------------------------------
export interface BudgetDecisionInput {
  /** Today's apify_spend.cap_usd — NULL means UNCAPPED (owner decision 2026-07-21). */
  capUsd: number | null | undefined;
  /** Today's apify_spend.spent_usd running total (0 when no row yet). */
  spentUsd: number | null | undefined;
}
export interface BudgetDecision {
  allowed: boolean;
  reason?: "budget_exceeded";
}

/** Budget gate evaluated BEFORE the actor call. Uncapped (cap NULL) always
 *  allows; otherwise deny once the day's spend has reached the cap. */
export function budgetDecision(input: BudgetDecisionInput): BudgetDecision {
  const cap = input.capUsd;
  const spent = Number(input.spentUsd ?? 0);
  if (cap == null) return { allowed: true }; // uncapped
  if (spent >= Number(cap)) return { allowed: false, reason: "budget_exceeded" };
  return { allowed: true };
}

/** Actual spend to charge after a run. A single ?id= lookup returns exactly one
 *  billed item even when empty, so charge for max(1, itemCount) items. */
export function computeSpendUsd(itemCount: number): number {
  const n = Number.isFinite(itemCount) ? Math.max(1, Math.floor(itemCount)) : 1;
  return n * APIFY_COST_PER_ITEM_USD;
}

// -- 5. Creative media-update planner (AC#4) ----------------------------------
export interface CapturedAsset {
  publicUrl: string; // always a storage-owned url produced by our download+store
  assetId?: string | null;
}
export interface CreativeMediaCurrent {
  video_url: string | null | undefined;
  full_res_url: string | null | undefined;
  thumbnail_url?: string | null | undefined;
  image_quality?: string | null | undefined;
}
export interface CapturedMedia {
  video?: CapturedAsset | null;
  image?: CapturedAsset | null;
}

/**
 * Compute the creatives update honoring AC#4:
 *   * NEVER overwrite a column that already holds a storage-owned url (the API
 *     tier or an earlier drain already landed real media there).
 *   * The only values written here are real storage urls we just produced, so a
 *     sentinel is never written over a real url (sentinel-safe by construction).
 * Returns only the columns to change (empty object => nothing to write).
 */
export function planCreativeMediaUpdate(
  current: CreativeMediaCurrent,
  captured: CapturedMedia,
): Record<string, string | null> {
  const updates: Record<string, string | null> = {};

  // Video: write only when we captured one AND the column is not already owned.
  if (captured.video?.publicUrl && !isStorageOwnedUrl(current.video_url)) {
    updates.video_url = captured.video.publicUrl;
    if (captured.video.assetId) updates.video_asset_id = captured.video.assetId;
  }

  // Image/full-res: write only when we captured one AND full_res is not already
  // owned (full_res_url is the durable owned-static column per US-000 section 8).
  if (captured.image?.publicUrl && !isStorageOwnedUrl(current.full_res_url)) {
    updates.thumbnail_url = captured.image.publicUrl;
    updates.full_res_url = captured.image.publicUrl;
    updates.image_quality = "full_res";
    if (captured.image.assetId) updates.thumb_asset_id = captured.image.assetId;
  }

  return updates;
}

// -- 6. Final capture status (AC#5) -------------------------------------------
export type CaptureStatus = "captured" | "failed" | "pending";
export interface FinalStatusInput {
  /** Any real media landed to owned storage this run. */
  landedAny: boolean;
  /** Attempt count AFTER incrementing for this run. */
  attempts: number;
  maxAttempts?: number;
}
export interface FinalStatus {
  status: CaptureStatus;
  terminal: boolean;
}

/**
 * Map a run outcome to the terminal/lifecycle status written to
 * creatives.apify_capture_status:
 *   * landed media           -> 'captured' (terminal success)
 *   * no media, attempts<max  -> 'pending'  (eligible for a bounded retry)
 *   * no media, attempts>=max  -> 'failed'   (terminal — stop re-billing)
 */
export function finalCaptureStatus(input: FinalStatusInput): FinalStatus {
  const max = input.maxAttempts ?? APIFY_MAX_ATTEMPTS;
  if (input.landedAny) return { status: "captured", terminal: true };
  if (input.attempts >= max) return { status: "failed", terminal: true };
  return { status: "pending", terminal: false };
}

// -- 7. Archive-id gate (AC#1) ------------------------------------------------
/** Capture requires a resolved ad_archive_id. Returns the skip reason
 *  'no_archive_id' when the creative is not ready, else null (proceed). */
export function archiveIdSkipReason(
  adArchiveIdStatus: string | null | undefined,
  adArchiveId: string | null | undefined,
): "no_archive_id" | null {
  if (adArchiveIdStatus !== "resolved") return "no_archive_id";
  if (!adArchiveId) return "no_archive_id";
  return null;
}

/** Already-covered gate (AC#1): storage-owned video OR full-res static already
 *  present => skip 'already_covered' unless force. */
export function alreadyCovered(current: CreativeMediaCurrent): boolean {
  return isStorageOwnedUrl(current.video_url) || isStorageOwnedUrl(current.full_res_url);
}
