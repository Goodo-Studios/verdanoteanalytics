// US-005 (meta-media-completeness): CDN-expiry auto-refresh — the self-healing media
// refresh poller (the queue FEEDER half; the migration is the DB half).
//
// WHY: Meta CDN (fbcdn) urls are time-limited. An older ad whose media was never
// cached to storage — or whose cached asset went missing/failed — will eventually rot
// to a dead image/video url. Nothing re-checks those ads today, so coverage silently
// decays. The retired US-011 anti-pattern "fix" was a blind-fanout cron that re-scanned
// every account every few minutes (OOM + churn). This story does the opposite.
//
// WHAT: a BOUNDED, PRIORITIZED, self-chaining poller that reuses the existing
// media_cache_queue + drain-media-queue pipeline instead of adding a second downloader:
//   1. Call enqueue_media_refresh_candidates(BATCH_LIMIT) — the SQL feeder that picks
//      up to BATCH_LIMIT eligible-but-not-covered ads whose failure_reason is
//      RE-CACHEABLE rot (video_uncached / image_low_res / image_missing /
//      video_unresolved), OLDEST-UNVERIFIED FIRST, honoring the existing exponential
//      backoff, and (re-)enqueues them into media_cache_queue. Bounded per call.
//   2. If it enqueued anything, poke drain-media-queue once so the heavy caching starts
//      immediately (rather than waiting up to 2 min for its own cron). The drain does
//      the streaming download + content-hash dedupe, so re-caching a still-valid item
//      is a NO-OP (US-009). drain then self-chains to finish the batch.
//   3. Self-chain a FRESH invocation of THIS poller while the feeder is still filling
//      full batches (more rotted media to page to), bounded by MAX_REFRESH_CHAIN.
//   4. Coverage-regression alert (AC#4): read latest_coverage_regression(); if the
//      aggregate covered% dropped beyond the threshold between the two most recent
//      hourly snapshots, fire a Slack alert (non-fatal, best-effort).
//
// pg_cron pokes this on a conservative 15-min cadence (companion migration
// 20260714000028); the self-chain handles a large backlog within a cycle. A poke that
// finds nothing to refresh is a cheap no-op (feeder enqueues 0, no chain, no alert).
//
// Self-chain contract (per verdanoteanalytics-self-chaining + verdanote-edge-fn-no-
// waituntil-for-http-calls): the chain is a NEW top-level fire-and-forget invocation
// (fetch(...).catch), never EdgeRuntime.waitUntil, so it survives this fn returning.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  BATCH_LIMIT,
  buildRegressionSlackBody,
  type CoverageRegression,
  MAX_REFRESH_CHAIN,
  shouldAlertRegression,
  shouldChainRefresh,
} from "../_shared/media-refresh-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface RefreshSummary {
  enqueued: number;
  chained: boolean;
  drainPoked: boolean;
  regressionAlerted: boolean;
}

/**
 * Fire the coverage-regression Slack alert if the SQL helper flagged a drop. Pure-ish:
 * reads latest_coverage_regression() then, only when a real regression is present,
 * POSTs the block-kit body. Non-fatal — an alerting failure never fails the poll.
 * Returns whether an alert was actually sent.
 */
export async function maybeAlertCoverageRegression(supabase: Supa): Promise<boolean> {
  try {
    const slackUrl = Deno.env.get("SLACK_WEBHOOK_URL");
    if (!slackUrl) return false;

    const thresholdRaw = Deno.env.get("COVERAGE_REGRESSION_THRESHOLD_PCT");
    const threshold = thresholdRaw ? Number(thresholdRaw) : 1.0;

    const { data, error } = await supabase.rpc("latest_coverage_regression", {
      p_threshold_pct: Number.isFinite(threshold) ? threshold : 1.0,
    });
    if (error) {
      console.error("latest_coverage_regression error (non-fatal):", error.message);
      return false;
    }
    const reg: CoverageRegression | null = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
    if (!shouldAlertRegression(reg)) return false;

    const appUrl = Deno.env.get("APP_URL") || "https://verdanote.com";
    const body = buildRegressionSlackBody(reg as CoverageRegression, appUrl);
    console.log(
      `Coverage regression: ${reg!.prev_pct}% → ${reg!.curr_pct}% (Δ ${reg!.delta_pct}) — alerting`,
    );
    await fetch(slackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return true;
  } catch (e) {
    console.error("Coverage regression alert error (non-fatal):", e);
    return false;
  }
}

/**
 * Run one bounded refresh poll: enqueue a batch of rotted candidates, poke the drain
 * if anything was enqueued, and check for a coverage regression. Returns the summary
 * the handler uses to decide whether to self-chain.
 */
export async function refreshOnce(supabase: Supa): Promise<RefreshSummary> {
  const summary: RefreshSummary = {
    enqueued: 0,
    chained: false,
    drainPoked: false,
    regressionAlerted: false,
  };

  // ── 1. Bounded, prioritized re-enqueue (the SQL feeder) ─────────────────────
  const { data: enqueuedCount, error: enqErr } = await supabase.rpc(
    "enqueue_media_refresh_candidates",
    { p_limit: BATCH_LIMIT },
  );
  if (enqErr) {
    console.error("enqueue_media_refresh_candidates error:", enqErr.message);
    // Still attempt the regression check below — a feeder failure shouldn't blind us
    // to a coverage drop.
  } else {
    summary.enqueued = Number(enqueuedCount) || 0;
  }

  // ── 2. Poke the drain to start caching immediately (only if we enqueued) ─────
  if (summary.enqueued > 0 && !Deno.env.get("REFRESH_NO_CHAIN")) {
    const drainUrl = `${SUPABASE_URL}/functions/v1/drain-media-queue`;
    // Fire-and-forget a fresh drain invocation (its own self-chain finishes the batch).
    fetch(drainUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: "{}",
    }).catch((e: Error) => console.error("refresh-media-queue drain poke error:", e.message));
    summary.drainPoked = true;
  }

  // ── 4. Coverage-regression alert (AC#4) ──────────────────────────────────────
  summary.regressionAlerted = await maybeAlertCoverageRegression(supabase);

  return summary;
}

export async function handler(req: Request, supabaseOverride?: unknown): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // serve() invokes handler(req, connInfo); connInfo is truthy but has no `.from`, so
  // only accept an override that actually looks like a Supabase client (mirrors
  // drain-media-queue — guards the "supabase.from is not a function" prod bug).
  const isClient = (o: unknown): boolean =>
    !!o && typeof (o as { from?: unknown }).from === "function";
  const supabase: Supa = isClient(supabaseOverride)
    ? supabaseOverride
    : createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

  try {
    const url = new URL(req.url);
    const chainDepth = Number(url.searchParams.get("chain") || "0");

    const summary = await refreshOnce(supabase);

    // ── 3. Self-chain WHILE the feeder is still filling full batches ────────────
    if (
      shouldChainRefresh(summary.enqueued, chainDepth, BATCH_LIMIT, MAX_REFRESH_CHAIN) &&
      !Deno.env.get("REFRESH_NO_CHAIN")
    ) {
      summary.chained = true;
      const nextUrl =
        `${SUPABASE_URL}/functions/v1/refresh-media-queue?chain=${chainDepth + 1}`;
      // Fresh top-level invocation (new worker, fresh memory) — NOT EdgeRuntime.waitUntil.
      fetch(nextUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: "{}",
      }).catch((e: Error) => console.error("refresh-media-queue self-chain error:", e.message));
    }

    console.log("refresh-media-queue:", JSON.stringify({ ...summary, chainDepth }));
    return new Response(JSON.stringify({ status: "completed", chainDepth, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("refresh-media-queue error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Guard the network bind so tests can import the module without serving.
if (!Deno.env.get("REFRESH_MEDIA_QUEUE_NO_SERVE")) {
  serve(handler);
}
