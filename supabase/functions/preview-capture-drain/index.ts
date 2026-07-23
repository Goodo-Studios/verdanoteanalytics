// =============================================================================
// preview-capture-drain — newest-first drain of the FREE preview-capture queue.
// =============================================================================
// Selects uncaptured creatives (capture_status='pending', NOT already covered),
// NEWEST-FIRST off idx_creatives_capture_queue, and POSTs { ad_id } to
// preview-capture for each — the per-ad worker enforces its own media-intent /
// backoff / dedupe / quota gates. This drain adds the orchestration:
//   • SINGLE-FLIGHT: a cron poke (chain=0) claims a DB lock so overlapping chains
//     never double-drain; self-chain continuations (chain>0) ARE the flight. Reuses
//     the apify_drain_state primitives (claim/release_apify_drain_singleflight).
//   • BOUNDED batch per invocation + a wall-time budget, with a self-chain that fires
//     a fresh invocation while pending rows remain (bursts drain fully).
//   • QUOTA DEGRADE (not halt): capture is FREE (no budget ledger), but Tier B spends
//     shared app-wide Meta quota. The moment preview-capture reports the quota circuit
//     breaker tripped ('quota_paused'), the drain finishes the current batch in
//     TIER-A-ONLY mode (free public video plugin, zero Meta quota — remaining video
//     ads can still be captured) and does NOT self-chain, so no new metered burst
//     starts. The 10-min cron resumes full Tier B once usage falls back under the
//     pause threshold. A quota pause degrades to "Tier A only", never "capture nothing".
//   • INERT by construction: no pending rows → no_work (no captures, no Meta calls).
//
// SECURITY: verify_jwt=false and NO self-auth — internal only, never linked from a
// client (mirrors drain-media-queue). Poked ONLY by the preview-capture-drain-10min
// pg_cron (vault service_role_key bearer) and its own self-chain. Outgoing calls
// (preview-capture + self-chain) carry SUPABASE_SERVICE_ROLE_KEY, the same
// outgoing-auth idiom as drain-media-queue.
//
// Ordering / filtering / batch selection are the PURE, unit-tested
// _shared/preview-drain-logic helpers; this file is the thin I/O shell.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { type DrainCandidate, selectDrainBatch } from "../_shared/preview-drain-logic.ts";
import { STORAGE_URL_MARKER } from "../_shared/preview-capture-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Small batch: each preview-capture call may run Tier B (Graph + iframe fetch, with a
// >=15s inter-Graph floor), so an invocation captures only a few ads and relies on the
// self-chain for volume.
export const BATCH_SIZE = 3;
// Per-invocation wall budget. Edge fn hard wall ~150s; leave margin to fire the
// self-chain + serialize the response after the last capture returns.
export const DEADLINE_MS = 110_000;
// Self-chain depth bound (BATCH_SIZE × MAX_CHAIN captures per drain — ample).
export const MAX_CHAIN = 50;
// Over-fetch generously so post-fetch filtering in selectDrainBatch (backoff/terminal
// rows) still yields a full batch without a second query, even when a cluster of
// ineligible rows sits at the ordering head.
const CANDIDATE_FETCH = BATCH_SIZE * 8;

// Columns selectDrainBatch needs (newest-first ordering + covered/backoff filtering).
const CANDIDATE_SELECT =
  "ad_id, account_id, created_time, capture_status, video_url, full_res_url, " +
  "capture_attempts, capture_last_attempt_at";

// PostgREST `like` wildcard form of the storage-owned marker (`%…%` → `*…*`), used to
// EXCLUDE already-covered rows in the SQL fetch itself. NULL-safe via the paired
// `col.is.null` disjunct — a NULL url is NOT covered, so it must survive the filter.
const OWNED_LIKE = `*${STORAGE_URL_MARKER}*`;
const NOT_OWNED_VIDEO = `video_url.is.null,video_url.not.like.${OWNED_LIKE}`;
const NOT_OWNED_STATIC = `full_res_url.is.null,full_res_url.not.like.${OWNED_LIKE}`;

/** Count creatives pending awaiting capture (queue depth). */
async function pendingCount(db: SupabaseClient): Promise<number> {
  const { count } = await db
    .from("creatives")
    .select("ad_id", { count: "exact", head: true })
    .eq("capture_status", "pending");
  return count ?? 0;
}

export async function handler(req: Request, supabaseOverride?: SupabaseClient): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Internal-only: no self-auth (mirrors drain-media-queue). Outgoing calls to
  // preview-capture / the self-chain carry the runtime service-role key.
  const internalAuth = `Bearer ${SERVICE_ROLE_KEY}`;

  const db = supabaseOverride ??
    createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const chainDepth = Number(body.chain ?? url.searchParams.get("chain") ?? 0);
  const dryRun = body.dry_run === true;
  const batchSize = Number(body.batch_size ?? BATCH_SIZE);
  const isCronPoke = chainDepth === 0;

  // ── SINGLE-FLIGHT for cron pokes (chain=0). Self-chain continuations (chain>0)
  //    ARE the running flight and skip the claim. Reuses the apify_drain_state
  //    primitives (kept by the pivot migration). ──
  let claimedLock = false;
  if (isCronPoke) {
    const { data: got } = await db.rpc("claim_apify_drain_singleflight", { p_stale_seconds: 900 });
    if (got !== true) return json({ ok: true, status: "skipped", reason: "singleflight-active" });
    claimedLock = true;
  }

  try {
    // ── Select the batch. The SQL fetch EXCLUDES already-covered rows (a storage-owned
    //    video OR full-res static already present) — they are not drainable, and a
    //    cluster of covered-but-still-'pending' rows sitting at the ordering head would
    //    otherwise fill the whole limited window and starve the untried backlog behind
    //    them (selectDrainBatch drops covered rows post-fetch, so an all-covered window
    //    yields an EMPTY batch → the drain returns no_work every tick and stalls at zero
    //    captures — the exact recurrence this fixes). This is the same head-starvation
    //    class PR#83 closed for backoff rows; covered rows need excluding in SQL too.
    //    Within the drainable set the fetch surfaces LEAST-RECENTLY-ATTEMPTED rows first
    //    (capture_last_attempt_at ASC NULLS FIRST → never-attempted rows lead),
    //    newest-first within that, and limits for index efficiency; selectDrainBatch
    //    then filters backoff/terminal rows (and re-applies the covered guard) and
    //    re-orders newest-first as the tested contract. ──
    const { data: rows } = await db
      .from("creatives")
      .select(CANDIDATE_SELECT)
      .eq("capture_status", "pending")
      .or(NOT_OWNED_VIDEO)
      .or(NOT_OWNED_STATIC)
      .order("capture_last_attempt_at", { ascending: true, nullsFirst: true })
      .order("created_time", { ascending: false, nullsFirst: false })
      .limit(CANDIDATE_FETCH);
    const batch = selectDrainBatch((rows ?? []) as unknown as DrainCandidate[], batchSize, Date.now());

    if (batch.length === 0) {
      // INERT: nothing pending to capture.
      return json({ ok: true, no_work: true, status: "idle", chain_depth: chainDepth });
    }

    // ── Capture each ad in turn (sequential so a quota HALT stops promptly). ──
    const startedMs = Date.now();
    const results: Array<{ ad_id: string; status?: string; reason?: string }> = [];
    let quotaHalt = false;
    // Once the per-ad worker reports the Meta-quota breaker tripped, the REST of this
    // batch runs Tier-A-only (free public video plugin, zero Meta quota) — a quota
    // pause degrades to "Tier A only", never to "capture nothing". quotaHalt still
    // suppresses the self-chain so no NEW quota-spending burst starts this window.
    let tierAOnly = false;
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
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/preview-capture`, {
          method: "POST",
          headers: { Authorization: internalAuth, "Content-Type": "application/json" },
          body: JSON.stringify({ ad_id: cand.ad_id, tier_a_only: tierAOnly }),
        });
        const payload = await resp.json().catch(() => ({}));
        const status = String(payload?.status ?? `http_${resp.status}`);
        const reason = payload?.reason ? String(payload.reason) : undefined;
        results.push({ ad_id: cand.ad_id, status, reason });
        processed++;
        if (status === "captured") captured++;
        // The Meta-quota circuit breaker tripped for this ad's Tier B. Do NOT hard-stop
        // the batch: keep going Tier-A-only (free) so remaining video ads can still be
        // captured, and suppress the self-chain so no new metered burst starts.
        if (status === "quota_paused" || reason === "quota_paused") {
          quotaHalt = true;
          tierAOnly = true;
          continue;
        }
      } catch (e) {
        results.push({ ad_id: cand.ad_id, status: "error", reason: String((e as Error).message ?? e) });
        processed++;
      }
    }

    // ── Self-chain while pending rows remain, unless quota halted or dry-run.
    //    Bounded by MAX_CHAIN. ──
    const pending = await pendingCount(db);
    let chained = false;
    if (!dryRun && !quotaHalt && pending > 0 && chainDepth < MAX_CHAIN) {
      chained = true;
      fetch(`${SUPABASE_URL}/functions/v1/preview-capture-drain?chain=${chainDepth + 1}`, {
        method: "POST",
        headers: { Authorization: internalAuth, "Content-Type": "application/json" },
        body: JSON.stringify({ chain: chainDepth + 1 }),
      }).catch((e: Error) => console.error("preview-capture-drain self-chain error:", e.message));
    }

    console.log("preview-capture-drain:", JSON.stringify({
      chain_depth: chainDepth, processed, captured, quota_halt: quotaHalt, pending, chained,
    }));
    return json({
      ok: true,
      status: quotaHalt ? "quota_paused" : "completed",
      chain_depth: chainDepth,
      processed,
      captured,
      quota_halt: quotaHalt,
      pending,
      chained,
      results,
    });
  } finally {
    if (claimedLock) {
      try { await db.rpc("release_apify_drain_singleflight"); } catch { /* best effort */ }
    }
  }
}

// Guard the network bind so tests can import the handler without serving.
if (!Deno.env.get("PREVIEW_CAPTURE_DRAIN_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
