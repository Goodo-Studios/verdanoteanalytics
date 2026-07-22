// =============================================================================
// preview-drain-logic — PURE, I/O-free decision helpers for the preview-capture
// pipeline wiring (Apify → preview pivot).
// =============================================================================
// Wires the FREE per-ad preview capture into the live media pipeline:
//   1. RESCUE gating  — when Meta-API media discovery gives up on a creative, hand
//      it to the free preview-capture queue instead of abandoning it
//      (rescueEnqueueDecision), gated on MEDIA-INTENT (NOT a Meta Ad-Library
//      archive id — the preview surface is ad-scoped by construction).
//   2. DRAIN selection — pick the next batch of pending creatives to capture,
//      NEWEST-FIRST (selectDrainBatch).
//   3. HEALTH findings — surface preview-capture trouble to system-health-check
//      (previewCaptureHealthFindings).
//
// Every branch that does NOT touch the network, Deno, or Supabase lives here so it
// can be unit-tested with fixtures (deno test), following the preview-capture-logic.ts
// style. The edge functions (drain-media-queue rescue hook, preview-capture-drain,
// system-health-check) are thin shells that call these.
//
// Sentinel string literals are mirrored here as LOCAL constants (not imported from
// media-discovery.ts) so this module stays free of the Deno fetch runtime and
// unit-testable in isolation — exactly as preview-capture-logic.ts mirrors
// STORAGE_URL_MARKER. The values are intentionally identical to media-discovery's.
// =============================================================================

import { isStorageOwnedUrl } from "./preview-capture-logic.ts";

// -- Sentinels mirrored from _shared/media-discovery.ts (kept in lockstep) -----
export const NO_VIDEO_PERMISSION = "no-video-permission";
export const NO_VIDEO_DELETED = "no-video-deleted";
export const NO_VIDEO_GENERIC = "no-video";
export const NO_THUMB = "no-thumbnail";

// Terminal video sentinels that trigger an IMMEDIATE Apify rescue (AC#1): the
// video is genuinely-unresolvable under our Meta access (permission-gated or
// deleted), so re-discovery via the Meta API would fail identically. Apify's
// public Ad-Library scrape is our only remaining path, so enqueue on first sight.
export const RESCUE_TERMINAL_SENTINELS: ReadonlySet<string> = new Set([
  NO_VIDEO_PERMISSION,
  NO_VIDEO_DELETED,
]);

// Media-gap reasons that trigger a rescue only once the Meta path is out of road —
// a first-attempt failure (new-ad fast path, AC#2) or exhausted retries (AC#1).
// video_unresolved (generic no-video), image_missing (no-thumbnail), or a
// both-missing 'no-media' skip. Oversized video is deliberately EXCLUDED: Apify
// would fetch the same too-large asset, so it stays a Meta-side terminal.
export const RESCUE_GAP_REASONS: ReadonlySet<string> = new Set([
  NO_VIDEO_GENERIC,
  NO_THUMB,
  "no-media",
]);

// =============================================================================
// 1. Rescue enqueue gating (AC#1 + AC#2)
// =============================================================================
// The media pipeline (drain-media-queue.processQueuedAd) decides a creative's
// terminal media state. This function decides whether that state should hand the
// creative to Apify (mark creatives.apify_capture_status='pending') — always
// gated on the ad_archive_id resolution status per the PRD.

export type MediaOutcome = "cached" | "skipped" | "failed" | "throttled";

export interface RescueDecisionInput {
  /** processQueuedAd outcome for this drain tick. */
  outcome: MediaOutcome;
  /** Reason tokens processQueuedAd recorded (its comma-joined reason, split). */
  reasons: string[];
  /** media_cache_queue.attempts AFTER the claim RPC bumped it (1 = first attempt). */
  attempts: number;
  /** drain-media-queue MAX_ATTEMPTS. */
  maxAttempts: number;
  /**
   * True when the ad genuinely has capturable media — meta_video_ids present OR it
   * is an image ad (meta_image_hashes present). Preview capture has no path for a
   * pure text/no-media ad, so those are never rescued. Replaces the retired
   * ad_archive_id_status gate (that column is dropped in the preview pivot).
   */
  hasMediaIntent: boolean;
  /** True when a storage-owned video OR full-res static is already present. */
  alreadyCovered: boolean;
  /** creatives.capture_status — non-null means a capture lifecycle already exists. */
  captureStatus: string | null | undefined;
}

export type RescueSkip =
  | "already_covered"
  | "already_queued"
  | "no_media_intent"
  | "throttled"
  | "media_ok"
  | "retrying";
export type RescueTrigger =
  | "terminal_video_sentinel"
  | "new_ad_first_attempt"
  | "retries_exhausted";

export interface RescueDecision {
  enqueue: boolean;
  trigger?: RescueTrigger;
  skip?: RescueSkip;
}

/**
 * Decide whether to rescue a creative into the FREE preview-capture queue after
 * the Meta media pipeline's verdict for this tick. Ordering of the guards is
 * deliberate:
 *   • already-covered / already-in-a-capture-lifecycle → never (idempotent).
 *   • no media intent (no video ids, not an image ad)  → never enqueue.
 *   • has media intent → eligible; then:
 *       - a Meta throttle is inconclusive               → never rescue on it.
 *       - a terminal video sentinel (permission/deleted) → rescue IMMEDIATELY.
 *       - a genuine media gap (failed / no-media skip) AND
 *           first attempt                                → rescue (new-ad fast path);
 *           attempts exhausted                           → rescue;
 *           otherwise                                    → keep retrying via Meta.
 */
export function rescueEnqueueDecision(input: RescueDecisionInput): RescueDecision {
  const {
    outcome,
    reasons,
    attempts,
    maxAttempts,
    hasMediaIntent,
    alreadyCovered,
    captureStatus,
  } = input;

  // Never for an ad whose media is already covered/captured.
  if (alreadyCovered) return { enqueue: false, skip: "already_covered" };
  // Never overwrite an existing capture lifecycle (pending/captured/failed/skipped).
  if (captureStatus != null) return { enqueue: false, skip: "already_queued" };

  // Media-intent gate: the free preview surface can only capture a video ad or an
  // image ad; a pure text/no-media ad has no capture path.
  if (!hasMediaIntent) return { enqueue: false, skip: "no_media_intent" };

  // A Meta rate-limit throttle means "we could not check", never a media verdict.
  if (outcome === "throttled") return { enqueue: false, skip: "throttled" };

  // Terminal video sentinel → rescue regardless of attempt count (AC#1).
  if (reasons.some((r) => RESCUE_TERMINAL_SENTINELS.has(r))) {
    return { enqueue: true, trigger: "terminal_video_sentinel" };
  }

  // Otherwise only a genuine media GAP is eligible for rescue.
  const gap =
    outcome === "failed" ||
    (outcome === "skipped" && reasons.some((r) => RESCUE_GAP_REASONS.has(r)));
  if (!gap) return { enqueue: false, skip: "media_ok" };

  if (attempts <= 1) return { enqueue: true, trigger: "new_ad_first_attempt" }; // AC#2
  if (attempts >= maxAttempts) return { enqueue: true, trigger: "retries_exhausted" }; // AC#1
  return { enqueue: false, skip: "retrying" };
}

// =============================================================================
// 2. Drain batch selection / ordering
// =============================================================================

export interface DrainCandidate {
  ad_id: string;
  account_id: string;
  created_time: string | null;
  capture_status: string | null;
  video_url: string | null;
  full_res_url: string | null;
}

/** A capture is "covered" when a storage-owned video OR full-res static is present. */
export function isCaptureCovered(
  c: { video_url: string | null; full_res_url: string | null },
): boolean {
  return isStorageOwnedUrl(c.video_url) || isStorageOwnedUrl(c.full_res_url);
}

/**
 * Select the next batch of creatives to capture, NEWEST-FIRST. Filters to exactly
 * the drainable set — capture_status='pending' and NOT already covered (there is NO
 * archive-id gate in the preview pivot; the preview surface is ad-scoped by
 * construction) — then orders by created_time DESC (NULLs last, a null launch date
 * treated as oldest) with a stable ad_id DESC tiebreak, and slices to batchSize. The
 * edge fn orders+limits in SQL for index efficiency (idx_creatives_capture_queue);
 * this pure pass is the tested contract + a covered-row safety net.
 */
export function selectDrainBatch(
  candidates: DrainCandidate[],
  batchSize: number,
): DrainCandidate[] {
  const eligible = candidates.filter(
    (c) => c.capture_status === "pending" && !isCaptureCovered(c),
  );
  eligible.sort((a, b) => {
    const ta = a.created_time ? Date.parse(a.created_time) : Number.NEGATIVE_INFINITY;
    const tb = b.created_time ? Date.parse(b.created_time) : Number.NEGATIVE_INFINITY;
    if (tb !== ta) return tb - ta; // newest first
    return b.ad_id.localeCompare(a.ad_id); // stable tiebreak
  });
  return batchSize > 0 ? eligible.slice(0, batchSize) : eligible;
}

// =============================================================================
// 3. Apify health findings (AC#5)
// =============================================================================

export interface PreviewCaptureHealthInput {
  /** Distinct creatives whose capture_last_attempt_at is within the last 6h. */
  attempts6h: number;
  /** Of those, how many are currently capture_status='failed'. */
  failures6h: number;
  /** Creatives pending awaiting preview capture (queue depth). */
  queueDepth: number;
  /** Tier-B iframe fetches recorded over the last 6h (drift-alarm denominator). */
  iframeAttempts6h?: number;
  /** Of those, how many returned HTTP 400 (mechanism-drift signal). */
  iframe400s6h?: number;
  /** Fraction of attempts failing that trips the spike finding (default 0.5 = 50%). */
  failureRateThreshold?: number;
  /** Minimum attempts before the failure-rate finding fires (default 10, anti-noise). */
  minAttemptsForRate?: number;
  /** Queue depth that trips the backlog finding (default 200). */
  queueDepthThreshold?: number;
  /** Tier-B 400-rate that trips the drift finding (default 0.2 = 20%). */
  iframe400RateThreshold?: number;
  /** Minimum Tier-B iframe fetches before the drift finding fires (default 10). */
  minIframeForRate?: number;
}

export interface HealthFinding {
  severity: "pass" | "warn" | "fail";
  category: "preview_capture";
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Build the 'preview_capture' health findings: a failure-rate spike (>50% of
 * attempts failing over 6h, above a minimum sample), a queue backlog (>200), and a
 * Tier-B iframe HTTP-400 DRIFT alarm (Facebook changed the required iframe headers
 * once already; a rising 400 rate is the mechanism-drift tripwire). Capture is FREE
 * so there is NO budget finding. Returns each tripped finding; when none trip, a
 * single 'pass' — mirroring how each system-health-check category emits a pass.
 */
export function previewCaptureHealthFindings(input: PreviewCaptureHealthInput): HealthFinding[] {
  const {
    attempts6h,
    failures6h,
    queueDepth,
    iframeAttempts6h = 0,
    iframe400s6h = 0,
    failureRateThreshold = 0.5,
    minAttemptsForRate = 10,
    queueDepthThreshold = 200,
    iframe400RateThreshold = 0.2,
    minIframeForRate = 10,
  } = input;

  const findings: HealthFinding[] = [];
  const failureRate = attempts6h > 0 ? failures6h / attempts6h : 0;
  const iframe400Rate = iframeAttempts6h > 0 ? iframe400s6h / iframeAttempts6h : 0;

  if (attempts6h >= minAttemptsForRate && failureRate > failureRateThreshold) {
    findings.push({
      severity: "fail",
      category: "preview_capture",
      message:
        `Preview capture failure rate ${Math.round(failureRate * 100)}% over the last 6h ` +
        `(${failures6h}/${attempts6h} attempts failing)`,
      details: { attempts_6h: attempts6h, failures_6h: failures6h, failure_rate: failureRate },
    });
  }

  if (queueDepth > queueDepthThreshold) {
    findings.push({
      severity: "warn",
      category: "preview_capture",
      message: `Preview capture queue depth ${queueDepth} exceeds ${queueDepthThreshold} — drain may be falling behind`,
      details: { queue_depth: queueDepth },
    });
  }

  // Mechanism-drift tripwire: Facebook already changed the iframe from Referer-only
  // to also requiring Sec-Fetch-*; the next change would show up as a spike in
  // Tier-B iframe HTTP-400s. Alarm on a sustained 400 rate above a minimum sample.
  if (iframeAttempts6h >= minIframeForRate && iframe400Rate > iframe400RateThreshold) {
    findings.push({
      severity: "fail",
      category: "preview_capture",
      message:
        `Tier-B preview iframe HTTP-400 rate ${Math.round(iframe400Rate * 100)}% over the last 6h ` +
        `(${iframe400s6h}/${iframeAttempts6h}) — Facebook may have changed the required iframe headers`,
      details: { iframe_attempts_6h: iframeAttempts6h, iframe_400s_6h: iframe400s6h, iframe_400_rate: iframe400Rate },
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "pass",
      category: "preview_capture",
      message: "Preview capture pipeline healthy (no failure spike, backlog, or iframe drift)",
      details: {
        attempts_6h: attempts6h, failures_6h: failures6h, queue_depth: queueDepth,
        iframe_attempts_6h: iframeAttempts6h, iframe_400s_6h: iframe400s6h,
      },
    });
  }

  return findings;
}
