// =============================================================================
// apify-drain-logic — PURE, I/O-free decision helpers for US-003 pipeline wiring.
// =============================================================================
// US-003 wires the US-002 per-ad Apify capture into the live media pipeline:
//   1. RESCUE gating  — when Meta-API media discovery gives up on a creative, hand
//      it to Apify instead of abandoning it (rescueEnqueueDecision).
//   2. DRAIN selection — pick the next batch of resolved+pending creatives to
//      capture, NEWEST-FIRST (selectDrainBatch).
//   3. HEALTH findings — surface Apify pipeline trouble to system-health-check
//      (apifyHealthFindings).
//
// Every branch that does NOT touch the network, Deno, or Supabase lives here so it
// can be unit-tested with fixtures (deno test), following the US-002
// apify-capture-logic.ts style. The edge functions (drain-media-queue rescue hook,
// apify-capture-drain, system-health-check) are thin shells that call these.
//
// Sentinel string literals are mirrored here as LOCAL constants (not imported from
// media-discovery.ts) so this module stays free of the Deno fetch runtime and
// unit-testable in isolation — exactly as apify-capture-logic.ts mirrors
// STORAGE_URL_MARKER. The values are intentionally identical to media-discovery's.
// =============================================================================

import { isStorageOwnedUrl } from "./apify-capture-logic.ts";

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
  /** creatives.ad_archive_id_status: null (unresolved) | 'resolved' | 'unresolvable'. */
  adArchiveIdStatus: string | null | undefined;
  /** True when a storage-owned video OR full-res static is already present. */
  alreadyCovered: boolean;
  /** creatives.apify_capture_status — non-null means an Apify lifecycle already exists. */
  apifyCaptureStatus: string | null | undefined;
}

export type RescueSkip =
  | "already_covered"
  | "already_queued"
  | "unresolvable"
  | "awaiting_resolver"
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
 * Decide whether to rescue a creative into the Apify capture queue after the Meta
 * media pipeline's verdict for this tick. Ordering of the guards is deliberate:
 *   • already-covered / already-in-an-Apify-lifecycle  → never (AC#4, idempotent).
 *   • ad_archive_id_status === 'unresolvable'          → never enqueue.
 *   • ad_archive_id_status IS NULL (unresolved)        → leave for the resolver.
 *   • ad_archive_id_status === 'resolved' → eligible; then:
 *       - a Meta throttle is inconclusive               → never rescue on it.
 *       - a terminal video sentinel (permission/deleted) → rescue IMMEDIATELY (AC#1).
 *       - a genuine media gap (failed / no-media skip) AND
 *           first attempt                                → rescue (AC#2 fast path);
 *           attempts exhausted                           → rescue (AC#1);
 *           otherwise                                    → keep retrying via Meta.
 */
export function rescueEnqueueDecision(input: RescueDecisionInput): RescueDecision {
  const {
    outcome,
    reasons,
    attempts,
    maxAttempts,
    adArchiveIdStatus,
    alreadyCovered,
    apifyCaptureStatus,
  } = input;

  // AC#4: never for an ad whose media is already covered/captured.
  if (alreadyCovered) return { enqueue: false, skip: "already_covered" };
  // Never overwrite an existing Apify lifecycle (pending/captured/failed/skipped).
  if (apifyCaptureStatus != null) return { enqueue: false, skip: "already_queued" };

  // Resolution-status gate (AC#1/#2).
  if (adArchiveIdStatus === "unresolvable") return { enqueue: false, skip: "unresolvable" };
  if (adArchiveIdStatus !== "resolved") return { enqueue: false, skip: "awaiting_resolver" };

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
// 2. Drain batch selection / ordering (AC#3)
// =============================================================================

export interface DrainCandidate {
  ad_id: string;
  account_id: string;
  created_time: string | null;
  ad_archive_id_status: string | null;
  apify_capture_status: string | null;
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
 * Select the next batch of creatives to capture, NEWEST-FIRST (AC#3). Filters to
 * exactly the drainable set — apify_capture_status='pending', ad_archive_id_status
 * ='resolved', and NOT already covered (AC#4) — then orders by created_time DESC
 * (NULLs last, since a null launch date is treated as oldest) with a stable ad_id
 * DESC tiebreak, and slices to batchSize. The edge fn orders+limits in SQL for
 * index efficiency; this pure pass is the tested contract + a covered-row safety net.
 */
export function selectDrainBatch(
  candidates: DrainCandidate[],
  batchSize: number,
): DrainCandidate[] {
  const eligible = candidates.filter(
    (c) =>
      c.apify_capture_status === "pending" &&
      c.ad_archive_id_status === "resolved" &&
      !isCaptureCovered(c),
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

export interface ApifyHealthInput {
  /** Distinct creatives whose apify_last_attempt_at is within the last 6h. */
  attempts6h: number;
  /** Of those, how many are currently apify_capture_status='failed'. */
  failures6h: number;
  /** Today's per-day cap is set (non-null) AND the day's spend has reached it. */
  budgetCapHit: boolean;
  /** Creatives resolved + pending awaiting capture. */
  queueDepth: number;
  /** Fraction of attempts failing that trips the spike finding (default 0.5 = 50%). */
  failureRateThreshold?: number;
  /** Minimum attempts before the failure-rate finding fires (default 10, anti-noise). */
  minAttemptsForRate?: number;
  /** Queue depth that trips the backlog finding (default 200). */
  queueDepthThreshold?: number;
}

export interface HealthFinding {
  severity: "pass" | "warn" | "fail";
  category: "apify";
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Build the 'apify' health findings (AC#5): a failure-rate spike (>50% of attempts
 * failing over 6h, above a minimum sample), a budget-cap hit, and a queue backlog
 * (>200). Returns each tripped finding; when none trip, a single 'pass' finding —
 * mirroring how each system-health-check category emits a pass when clean.
 */
export function apifyHealthFindings(input: ApifyHealthInput): HealthFinding[] {
  const {
    attempts6h,
    failures6h,
    budgetCapHit,
    queueDepth,
    failureRateThreshold = 0.5,
    minAttemptsForRate = 10,
    queueDepthThreshold = 200,
  } = input;

  const findings: HealthFinding[] = [];
  const failureRate = attempts6h > 0 ? failures6h / attempts6h : 0;

  if (attempts6h >= minAttemptsForRate && failureRate > failureRateThreshold) {
    findings.push({
      severity: "fail",
      category: "apify",
      message:
        `Apify capture failure rate ${Math.round(failureRate * 100)}% over the last 6h ` +
        `(${failures6h}/${attempts6h} attempts failing)`,
      details: { attempts_6h: attempts6h, failures_6h: failures6h, failure_rate: failureRate },
    });
  }

  if (budgetCapHit) {
    findings.push({
      severity: "warn",
      category: "apify",
      message: "Apify daily capture budget cap reached — captures paused until tomorrow (or cap raised)",
    });
  }

  if (queueDepth > queueDepthThreshold) {
    findings.push({
      severity: "warn",
      category: "apify",
      message: `Apify capture queue depth ${queueDepth} exceeds ${queueDepthThreshold} — drain may be falling behind`,
      details: { queue_depth: queueDepth },
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "pass",
      category: "apify",
      message: "Apify capture pipeline healthy (no failure spike, budget, or backlog)",
      details: { attempts_6h: attempts6h, failures_6h: failures6h, queue_depth: queueDepth },
    });
  }

  return findings;
}
