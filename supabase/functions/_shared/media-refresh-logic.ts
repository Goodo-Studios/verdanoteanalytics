// US-005 (meta-media-completeness): pure decision logic for the self-healing media
// refresh poller. Dependency-free so it can be unit-tested under BOTH the Deno edge
// runtime (supabase/functions/refresh-media-queue/index.test.ts) AND the repo's
// vitest suite (src/test/mediaRefreshSelfHeal.test.ts) — the latter is what `npm run
// test` (the US-005 back-pressure gate) actually runs.
//
// The heavy lifting (candidate selection, backoff gate, enqueue, coverage snapshot)
// is done in SQL (migration 20260714000028): enqueue_media_refresh_candidates() and
// latest_coverage_regression(). This module only holds the small, branch-y decisions
// the edge fn makes around those RPCs, kept pure so they are cheap to test exhaustively.

// The failure_reason values (from public.media_coverage) that represent RE-CACHEABLE
// media rot the refresh poller should feed back into the queue. Kept in sync with the
// SQL predicate in enqueue_media_refresh_candidates — this constant is the TS mirror
// used by tests + any client-side reasoning, so the two must not drift.
//   • video_uncached  — a live Meta CDN url that was never cached (the CDN-expiry rot).
//   • image_low_res   — only the ~130px thumbnail fallback was cached.
//   • image_missing   — no image cached at all.
//   • video_unresolved— generic 'no-video' sentinel, still re-attemptable.
export const RECACHEABLE_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "video_uncached",
  "image_low_res",
  "image_missing",
  "video_unresolved",
]);

// Terminal / out-of-scope failure_reasons the poller must NEVER re-enqueue: the
// genuinely-unresolvable residual (permission/deleted) and the carousel-frame gap
// (owned by the US-004 sync path, not a CDN-expiry re-cache).
export const TERMINAL_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "video_permission",
  "video_deleted",
  "frames_incomplete",
]);

/** Is this coverage failure_reason one the refresh poller should re-enqueue? */
export function isRecacheable(failureReason: string | null | undefined): boolean {
  if (!failureReason) return false;
  return RECACHEABLE_FAILURE_REASONS.has(failureReason);
}

// Safety bound on the poller's self-chain depth, mirroring drain-media-queue's
// MAX_CHAIN. BATCH_LIMIT × MAX_REFRESH_CHAIN caps the ads re-enqueued per poll cycle,
// so a huge backlog is paged over many bounded invocations rather than one blast.
export const MAX_REFRESH_CHAIN = 50;

// How many rotted ads one invocation re-enqueues. Bounded (AC#2): the feeder RPC only
// SELECTs + INSERTs (no downloads), so this can be larger than the drain's BATCH_SIZE,
// but stays bounded so a single poll never scans/writes the whole backlog.
export const BATCH_LIMIT = 100;

/**
 * Decide whether the poller should self-chain a fresh invocation. Chains WHILE the
 * feeder still enqueued a full batch (there is very likely more rotted media to page
 * to) AND we are under the chain-depth bound. A poll that enqueued fewer than the
 * batch limit has reached the tail of the backlog → stop (the 15-min cron re-checks
 * later). Mirrors drain-media-queue's "chain while work remains, bounded by MAX_CHAIN".
 */
export function shouldChainRefresh(
  enqueued: number,
  chainDepth: number,
  batchLimit: number = BATCH_LIMIT,
  maxChain: number = MAX_REFRESH_CHAIN,
): boolean {
  return enqueued >= batchLimit && chainDepth < maxChain;
}

// Shape of one row returned by the latest_coverage_regression(threshold) RPC.
export interface CoverageRegression {
  regressed: boolean;
  prev_pct: number | null;
  curr_pct: number | null;
  delta_pct: number | null;
  prev_captured_at: string | null;
  curr_captured_at: string | null;
}

/**
 * Decide whether to fire a coverage-regression Slack alert. Only alert when the SQL
 * helper flagged a regression AND we actually have both snapshots (guards a first-run
 * with only one snapshot, where prev_pct is null and nothing regressed).
 */
export function shouldAlertRegression(reg: CoverageRegression | null | undefined): boolean {
  if (!reg) return false;
  return reg.regressed === true && reg.prev_pct != null && reg.curr_pct != null;
}

/**
 * Build the Slack message body for a coverage regression. Pure (no fetch) so the exact
 * wording is testable. Mirrors the block-kit shape used by sync/index.ts' alerts.
 */
export function buildRegressionSlackBody(reg: CoverageRegression, appUrl: string): {
  blocks: unknown[];
} {
  const prev = (reg.prev_pct ?? 0).toFixed(2);
  const curr = (reg.curr_pct ?? 0).toFixed(2);
  const drop = Math.abs(reg.delta_pct ?? 0).toFixed(2);
  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🟠 Media coverage regressed", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `Aggregate media coverage dropped *${drop} pts* — from *${prev}%* to *${curr}%*.\n` +
            `The self-healing refresh poller will re-enqueue rotted media, but a sudden drop is worth a look.`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View coverage →", emoji: true },
            url: `${appUrl}/creatives`,
          },
        ],
      },
    ],
  };
}
