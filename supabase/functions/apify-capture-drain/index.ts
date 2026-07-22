// =============================================================================
// apify-capture-drain — US-003: newest-first drain of the Apify capture queue.
// =============================================================================
// Selects resolved-but-uncaptured creatives (apify_capture_status='pending' AND
// ad_archive_id_status='resolved', NOT already covered), NEWEST-FIRST, and POSTs
// { ad_id } to apify-capture for each — the per-ad worker enforces its own
// budget/backoff/dedupe gates. This drain adds the orchestration around it:
//   • SINGLE-FLIGHT: a cron poke (chain=0) claims a DB lock so overlapping chains
//     never double-drain; self-chain continuations (chain>0) ARE the flight.
//   • BOUNDED batch per invocation + a wall-time budget, with a self-chain that
//     fires a fresh invocation while pending rows remain (bursts drain fully).
//   • STOP ON BUDGET: the day's apify_spend cap is checked BEFORE any capture, and
//     the loop halts the moment apify-capture reports 'budget_exceeded'.
//   • INERT by construction: no pending rows → no_work (no captures, no spend, no
//     Meta calls — Apify replaces Meta here); budget spent → budget_exceeded.
//
// SECURITY: verify_jwt=false and NO self-auth — internal only, never linked from a
// client (mirrors drain-media-queue / apify-capture, the proven internal-cron
// pattern in this repo). It is poked ONLY by the apify-capture-drain-10min pg_cron
// and its own self-chain, both carrying the runtime service-role key the edge
// gateway admits when verify_jwt is off. (A `role === 'service_role'` JWT gate does
// NOT work here: the cron's vault bearer is an sb_secret_ value, not a decodable
// JWT — the resolve-ad-archive-ids gate 403s the cron for exactly this reason.)
// Internal calls (apify-capture + self-chain) use SUPABASE_SERVICE_ROLE_KEY, the
// same outgoing-auth idiom as drain-media-queue.
//
// The pg_cron poke (every 10 min) is registered in a companion migration. Ordering,
// filtering, and batch selection are the PURE, unit-tested _shared/apify-drain-logic
// helpers; this file is the thin I/O shell.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { budgetDecision } from "../_shared/apify-capture-logic.ts";
import { type DrainCandidate, selectDrainBatch } from "../_shared/apify-drain-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Small batch: each apify-capture call can run the actor for up to ~125s, so an
// invocation captures only a few ads and relies on the self-chain for volume.
export const BATCH_SIZE = 3;
// Per-invocation wall budget. Edge fn hard wall ~150s; leave margin to fire the
// self-chain + serialize the response after the last capture returns.
export const DEADLINE_MS = 110_000;
// Self-chain depth bound (BATCH_SIZE × MAX_CHAIN captures per drain — ample).
export const MAX_CHAIN = 50;
// Over-fetch a few extra candidates so covered-row filtering in selectDrainBatch
// still yields a full batch without a second query.
const CANDIDATE_FETCH = BATCH_SIZE * 4;

// Columns selectDrainBatch needs (newest-first ordering + covered filtering).
const CANDIDATE_SELECT =
  "ad_id, account_id, created_time, ad_archive_id_status, apify_capture_status, video_url, full_res_url";

/** Today's UTC calendar day (matches apify_spend.day / add_apify_spend). */
function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Count creatives resolved + pending awaiting capture (queue depth). */
async function pendingCount(db: SupabaseClient): Promise<number> {
  const { count } = await db
    .from("creatives")
    .select("ad_id", { count: "exact", head: true })
    .eq("apify_capture_status", "pending")
    .eq("ad_archive_id_status", "resolved");
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Internal-only: no self-auth (mirrors drain-media-queue). Outgoing calls to
  // apify-capture / the self-chain carry the runtime service-role key.
  const internalAuth = `Bearer ${SERVICE_ROLE_KEY}`;

  const db = createClient(
    SUPABASE_URL,
    SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const chainDepth = Number(body.chain ?? url.searchParams.get("chain") ?? 0);
  const dryRun = body.dry_run === true;
  const batchSize = Number(body.batch_size ?? BATCH_SIZE);
  const isCronPoke = chainDepth === 0;

  // ── SINGLE-FLIGHT for cron pokes (chain=0). Self-chain continuations (chain>0)
  //    ARE the running flight and skip the claim. ──
  let claimedLock = false;
  if (isCronPoke) {
    const { data: got } = await db.rpc("claim_apify_drain_singleflight", { p_stale_seconds: 900 });
    if (got !== true) return json({ ok: true, status: "skipped", reason: "singleflight-active" });
    claimedLock = true;
  }

  try {
    // ── Budget gate BEFORE any capture (AC#3: stop on budget). Uncapped (cap NULL)
    //    always allows — the owner set cap_usd NULL = UNCAPPED (US-001). ──
    const day = utcDay();
    const { data: spendRow } = await db
      .from("apify_spend")
      .select("spent_usd, cap_usd")
      .eq("day", day)
      .maybeSingle();
    const budget = budgetDecision({
      capUsd: spendRow?.cap_usd ?? null,
      spentUsd: spendRow?.spent_usd ?? 0,
    });
    if (!budget.allowed) {
      return json({ ok: true, status: "budget_exceeded", day, chain_depth: chainDepth });
    }

    // ── Select the newest-first batch. SQL orders + limits for index efficiency;
    //    selectDrainBatch re-filters covered rows and re-orders as the tested contract. ──
    const { data: rows } = await db
      .from("creatives")
      .select(CANDIDATE_SELECT)
      .eq("apify_capture_status", "pending")
      .eq("ad_archive_id_status", "resolved")
      .order("created_time", { ascending: false, nullsFirst: false })
      .limit(CANDIDATE_FETCH);
    const batch = selectDrainBatch((rows ?? []) as DrainCandidate[], batchSize);

    if (batch.length === 0) {
      // INERT: nothing resolved+pending to capture.
      return json({ ok: true, no_work: true, status: "idle", day, chain_depth: chainDepth });
    }

    // ── Capture each ad in turn (sequential so a 'budget_exceeded' halts promptly). ──
    const startedMs = Date.now();
    const results: Array<{ ad_id: string; status?: string; reason?: string }> = [];
    let budgetExceeded = false;
    let captured = 0;
    let processed = 0;

    for (const cand of batch) {
      if (Date.now() - startedMs > DEADLINE_MS) break; // wall budget — self-chain picks up the rest
      if (dryRun) {
        results.push({ ad_id: cand.ad_id, status: "dry_run" });
        processed++;
        continue;
      }
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/apify-capture`, {
          method: "POST",
          headers: { Authorization: internalAuth, "Content-Type": "application/json" },
          body: JSON.stringify({ ad_id: cand.ad_id }),
        });
        const payload = await resp.json().catch(() => ({}));
        const status = String(payload?.status ?? `http_${resp.status}`);
        const reason = payload?.reason ? String(payload.reason) : undefined;
        results.push({ ad_id: cand.ad_id, status, reason });
        processed++;
        if (status === "captured") captured++;
        // Stop the moment the per-ad worker reports the budget is spent (AC#3).
        if (reason === "budget_exceeded") {
          budgetExceeded = true;
          break;
        }
      } catch (e) {
        results.push({ ad_id: cand.ad_id, status: "error", reason: String((e as Error).message ?? e) });
        processed++;
      }
    }

    // ── Self-chain while pending rows remain, unless the budget is spent (AC#3) or
    //    we're in dry-run. Bounded by MAX_CHAIN. ──
    const pending = await pendingCount(db);
    let chained = false;
    if (!dryRun && !budgetExceeded && pending > 0 && chainDepth < MAX_CHAIN) {
      chained = true;
      fetch(`${SUPABASE_URL}/functions/v1/apify-capture-drain?chain=${chainDepth + 1}`, {
        method: "POST",
        headers: { Authorization: internalAuth, "Content-Type": "application/json" },
        body: JSON.stringify({ chain: chainDepth + 1 }),
      }).catch((e: Error) => console.error("apify-capture-drain self-chain error:", e.message));
    }

    console.log("apify-capture-drain:", JSON.stringify({
      chain_depth: chainDepth, processed, captured, budget_exceeded: budgetExceeded, pending, chained,
    }));
    return json({
      ok: true,
      status: budgetExceeded ? "budget_exceeded" : "completed",
      chain_depth: chainDepth,
      day,
      processed,
      captured,
      budget_exceeded: budgetExceeded,
      pending,
      chained,
      results,
    });
  } finally {
    if (claimedLock) {
      try { await db.rpc("release_apify_drain_singleflight"); } catch { /* best effort */ }
    }
  }
});
