import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

// Tag parsing removed from sync — tagging is managed via manual edits or CSV uploads only.

// ─── Meta API Helper ─────────────────────────────────────────────────────────

const META_API_VERSION = "v22.0";
const MAX_RATE_LIMIT_RETRIES = 5; // Up from 3 — handles large account rate pressure

async function metaFetch(
  url: string,
  ctx: { metaApiCalls: number; apiErrors: { timestamp: string; message: string }[]; isTimedOut: () => boolean }
): Promise<{ data: any[] | null; next: string | null; error: boolean; rateLimited: boolean }> {
  if (ctx.isTimedOut()) return { data: null, next: null, error: false, rateLimited: false };

  let rateLimitRetries = 0;
  while (true) {
    ctx.metaApiCalls++;
    try {
      const resp = await fetch(url);
      const json = await resp.json();

      if (json.error) {
        const isRateLimitError = json.error.code === 80004 || json.error.code === 80000 || json.error.error_subcode === 2446079
          || json.error.code === 4 || json.error.code === 17 || json.error.code === 32
          || (typeof json.error.message === "string" && (
            json.error.message.includes("request limit") || json.error.message.includes("rate limit") || json.error.message.includes("too many calls")
          ));
        if (isRateLimitError && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
          rateLimitRetries++;
          // Exponential backoff: 30s, 60s, 120s, 180s, 300s — capped at 5 min
          const waitSec = Math.min(300, 30 * Math.pow(2, rateLimitRetries - 1));
          console.log(`Rate limited, waiting ${waitSec}s (retry ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})...`);
          ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Rate limited, backing off ${waitSec}s` });
          // Interruptible wait: check timeout every second instead of sleeping the full duration.
          // This prevents rate-limit backoffs from overrunning the phase budget and causing
          // Supabase's hard wall-clock limit to kill the function before state can be saved.
          const waitUntil = Date.now() + waitSec * 1000;
          while (Date.now() < waitUntil) {
            await new Promise(r => setTimeout(r, 1000));
            if (ctx.isTimedOut()) return { data: null, next: null, error: false, rateLimited: true };
          }
          continue;
        }
        if (json.error.message?.includes("reduce the amount of data")) {
          // Meta wants smaller pages — retry with progressively halved limits until we get data or hit minimum
          console.log("Meta asked to reduce data volume — retrying with smaller page size");
          ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: "Reduce data request — retrying with smaller page" });
          let currentLimit = parseInt((url.match(/limit=(\d+)/) || [])[1] || "200");
          let reducedUrl = url;
          for (let attempt = 0; attempt < 4; attempt++) {
            currentLimit = Math.max(10, Math.floor(currentLimit / 2));
            reducedUrl = url.replace(/limit=\d+/, `limit=${currentLimit}`);
            console.log(`  Reduce attempt ${attempt + 1}: limit=${currentLimit}`);
            ctx.metaApiCalls++;
            await new Promise(r => setTimeout(r, 500));
            const retryResp = await fetch(reducedUrl);
            const retryJson = await retryResp.json();
            if (!retryJson.error) {
              return { data: retryJson.data || [], next: retryJson.paging?.next || null, error: false, rateLimited: false };
            }
            if (!retryJson.error?.message?.includes("reduce the amount of data")) {
              // Different error — stop retrying
              break;
            }
          }
          return { data: null, next: null, error: true, rateLimited: false };
        }
        // Log full error details for debugging (especially useful for NDC "unknown error")
        const fullErrMsg = `Meta API error — code: ${json.error.code ?? "?"}, subcode: ${json.error.error_subcode ?? "?"}, type: ${json.error.type ?? "?"}, msg: ${json.error.message ?? "?"}`;
        console.error(fullErrMsg, JSON.stringify(json.error));
        ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: fullErrMsg });
        return { data: null, next: null, error: true, rateLimited: isRateLimitError };
      }

      return { data: json.data || [], next: json.paging?.next || null, error: false, rateLimited: false };
    } catch (fetchErr) {
      console.error("Fetch error:", fetchErr);
      ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Network error: ${String(fetchErr)}` });
      return { data: null, next: null, error: true, rateLimited: false };
    }
  }
}

// ─── Metrics Parsing Helper ──────────────────────────────────────────────────

function parseInsightsRow(row: any) {
  const spend = parseFloat(row.spend || "0");
  const roas = row.purchase_roas?.[0]?.value ? parseFloat(row.purchase_roas[0].value) : 0;
  const ctr = parseFloat(row.ctr || "0");
  const clicks = parseInt(row.clicks || "0");
  const impressions = parseInt(row.impressions || "0");
  const cpm = parseFloat(row.cpm || "0");
  const cpc = parseFloat(row.cpc || "0");
  const frequency = parseFloat(row.frequency || "0");

  let purchases = 0, purchaseValue = 0, cpa = 0;
  let addsToCart = 0, costPerAtc = 0;
  let videoViews = 0, thruPlays = 0;

  if (row.actions) {
    const purchaseTypes = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
    const pa = row.actions.find((a: any) => purchaseTypes.includes(a.action_type));
    if (pa) purchases = parseInt(pa.value || "0");
    const atcTypes = ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart", "omni_add_to_cart"];
    const atc = row.actions.find((a: any) => atcTypes.includes(a.action_type));
    if (atc) addsToCart = parseInt(atc.value || "0");
    const vv = row.actions.find((a: any) => a.action_type === "video_view");
    if (vv) videoViews = parseInt(vv.value || "0");
  }
  if (row.video_thruplay_watched_actions) {
    const tp = row.video_thruplay_watched_actions.find((a: any) => a.action_type === "video_view");
    if (tp) thruPlays = parseInt(tp.value || "0");
  }
  if (row.action_values) {
    const purchaseTypes = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
    const pv = row.action_values.find((a: any) => purchaseTypes.includes(a.action_type));
    if (pv) purchaseValue = parseFloat(pv.value || "0");
  }
  if (row.cost_per_action_type) {
    const purchaseTypes = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
    const cp = row.cost_per_action_type.find((a: any) => purchaseTypes.includes(a.action_type));
    if (cp) cpa = parseFloat(cp.value || "0");
    const atcTypes = ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart", "omni_add_to_cart"];
    const cpatc = row.cost_per_action_type.find((a: any) => atcTypes.includes(a.action_type));
    if (cpatc) costPerAtc = parseFloat(cpatc.value || "0");
  }

  const thumbStopRate = impressions > 0 && videoViews > 0 ? (videoViews / impressions) * 100 : 0;
  const holdRate = videoViews > 0 && thruPlays > 0 ? (thruPlays / videoViews) * 100 : 0;

  let videoAvgPlayTime = 0;
  if (row.video_avg_time_watched_actions) {
    const vat = row.video_avg_time_watched_actions.find((a: any) => a.action_type === "video_view");
    if (vat) videoAvgPlayTime = parseFloat(vat.value || "0");
  }

  return { spend, roas, cpa, ctr, clicks, impressions, cpm, cpc, frequency, purchases, purchase_value: purchaseValue, thumb_stop_rate: thumbStopRate, hold_rate: holdRate, video_avg_play_time: videoAvgPlayTime, adds_to_cart: addsToCart, cost_per_add_to_cart: costPerAtc, video_views: videoViews };
}

// ─── Phase Budget ────────────────────────────────────────────────────────────
// Phase budget: 4 minutes (240s). Requires Supabase function timeout >= 300s (Pro plan).
// 110s budget -- leaves ~40s margin within Supabase's 150s hard wall to save cursor state.
// Large accounts resume from cursor on next trigger; the sync manager re-triggers automatically.
// Do NOT set above 110s unless Supabase function timeout is confirmed > 150s.
// NOTE: Phase 1 (metadata fetch) uses PHASE_1_BUDGET_MS for large account safety
const PHASE_BUDGET_MS = 110 * 1000;
const PHASE_1_BUDGET_MS = 240 * 1000; // Extended budget for Phase 1 to handle large accounts
const HEARTBEAT_INTERVAL_MS = 20 * 1000;

// ─── Promote Next Queued Sync ────────────────────────────────────────────────
async function promoteNextQueued(supabase: any) {
  // Check for configurable cooldown between sequential account syncs
  const { data: cooldownRow } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "sync_cooldown_minutes")
    .single();
  const cooldownMinutes = parseFloat(cooldownRow?.value || "0");

  if (cooldownMinutes > 0) {
    // Find the most recently completed sync
    const { data: lastCompleted } = await supabase
      .from("sync_logs")
      .select("completed_at")
      .in("status", ["completed", "completed_with_errors", "failed", "cancelled"])
      .order("completed_at", { ascending: false })
      .limit(1);

    if (lastCompleted?.length && lastCompleted[0].completed_at) {
      const completedAt = new Date(lastCompleted[0].completed_at).getTime();
      const cooldownMs = cooldownMinutes * 60 * 1000;
      const elapsed = Date.now() - completedAt;
      if (elapsed < cooldownMs) {
        const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
        console.log(`Cooldown active — next sync will start in ~${remainingSec}s`);
        return; // cron will retry in ~1 minute
      }
    }
  }

  const { data: next } = await supabase.from("sync_logs")
    .select("id, sync_state")
    .eq("status", "queued")
    .order("started_at", { ascending: true })
    .limit(1);
  if (next?.length) {
    await supabase.from("sync_logs").update({
      status: "running",
      sync_state: { ...(next[0].sync_state || {}), last_activity: new Date().toISOString() },
    }).eq("id", next[0].id);
    console.log(`Promoted queued sync ${next[0].id} to running`);
  }
}

// ─── Sync Worker: Resumable Phase Execution ──────────────────────────────────
// Phases:
//   1 = Fetch ads metadata (lightweight — no media)
//   2 = Fetch aggregated insights (batch upsert)
//   3 = Cleanup zero-spend + count
//   4 = Daily metric breakdowns (batch upsert, chunked)
//   5 = Finalize

async function runSyncPhase(supabase: any, syncLog: any, metaToken: string) {
  const startMs = Date.now();
  const phase = syncLog.current_phase || 1;
  // Use extended budget for Phase 1 (metadata fetch) to handle large accounts
  const phaseBudget = phase === 1 ? PHASE_1_BUDGET_MS : PHASE_BUDGET_MS;
  const isTimedOut = () => (Date.now() - startMs) > phaseBudget;
  const ctx = { metaApiCalls: 0, apiErrors: [] as { timestamp: string; message: string }[], isTimedOut };

  // Lightweight heartbeat
  let lastHeartbeat = Date.now();
  const heartbeat = async () => {
    if (Date.now() - lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeat = Date.now();
    try {
      const { data: current } = await supabase.from("sync_logs").select("sync_state").eq("id", syncLog.id).single();
      const currentState = current?.sync_state || {};
      await supabase.from("sync_logs").update({
        sync_state: { ...currentState, last_activity: new Date().toISOString() },
      }).eq("id", syncLog.id);
    } catch (_) { /* best effort */ }
  };

  const accountId = syncLog.account_id;
  const { data: account } = await supabase.from("ad_accounts").select("*").eq("id", accountId).single();
  if (!account) {
    await supabase.from("sync_logs").update({ status: "failed", api_errors: JSON.stringify([{ timestamp: new Date().toISOString(), message: "Account not found" }]), completed_at: new Date().toISOString() }).eq("id", syncLog.id);
    await promoteNextQueued(supabase);
    return;
  }

  const state = syncLog.sync_state || {};
  const syncType = syncLog.sync_type || "manual";
  const syncScope = state.sync_scope || "full";
  const dateRangeDays = syncType === "initial" ? 90 : (account.date_range_days || 14);

  // ── CHANGE 2: Incremental sync — determine date window ──────────────────
  // If the account has a last_data_sync timestamp and this is NOT an initial sync,
  // use that as the `since` date for insights queries so we only pull new/changed data.
  // If no last_data_sync exists (first run), fall back to the full dateRangeDays window.
  const lastDataSync: string | null = account.last_data_sync || null;
  const isInitialSync = syncType === "initial" || !lastDataSync;

  // Compute the effective start date for insights queries
  let incrementalSinceDate: string | null = null;
  if (!isInitialSync && lastDataSync) {
    // Use last sync date as `since`, but clamp to a minimum of 2 days ago
    // to catch any delayed data from Meta's attribution windows.
    const lastSyncMs = new Date(lastDataSync).getTime();
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const effectiveSince = Math.min(lastSyncMs, twoDaysAgo);
    incrementalSinceDate = new Date(effectiveSince).toISOString().split("T")[0];
    console.log(
      `Incremental sync for ${account.name}: fetching data since ${incrementalSinceDate} ` +
      `(last_data_sync: ${lastDataSync})`
    );
  } else {
    console.log(
      `Initial/full sync for ${account.name}: fetching last ${dateRangeDays} days`
    );
  }
  // ────────────────────────────────────────────────────────────────────────

  // Determine which phases to run based on sync_scope
  const scopePhases: Record<string, number[]> = {
    full: [1, 2, 3, 4, 5],
    metadata: [1, 5],
    insights: [2, 3, 5],
    daily: [4, 5],
    lite: [1, 2, 3, 5],
  };
  const allowedPhases = scopePhases[syncScope] || scopePhases.full;


  // Adaptive settings for large accounts (>3k creatives) — gentler on Meta API
  const isLargeAccount = (account.creative_count || 0) > 3000;
  const insightsPageSize = isLargeAccount ? 200 : 500;  // Reduce payload size for large accounts
  const interRequestDelayMs = isLargeAccount ? 300 : 150; // Slower paging to avoid rate limits
  console.log(`Account size: ${account.creative_count} creatives — using page_size=${insightsPageSize}, delay=${interRequestDelayMs}ms`);

  console.log(`\n━━━ Phase ${phase} for ${account.name} (${accountId}) ━━━`);

  // Check cancellation
  const { data: statusCheck } = await supabase.from("sync_logs").select("status").eq("id", syncLog.id).single();
  if (statusCheck?.status === "cancelled") {
    await promoteNextQueued(supabase);
    return;
  }

  const saveState = async (nextPhase: number, newState: any, status = "running") => {
    // Exclude non-serializable fields (Set objects) from persisted state
    const { _validAdCache, ...serializableState } = state;
    const merged = { ...serializableState, ...newState, last_activity: new Date().toISOString() };
    try {
      await supabase.from("sync_logs").update({
        current_phase: nextPhase,
        sync_state: merged,
        status,
        creatives_fetched: merged.creatives_fetched ?? syncLog.creatives_fetched ?? 0,
        creatives_upserted: merged.creatives_upserted ?? syncLog.creatives_upserted ?? 0,
        tags_parsed: merged.tags_parsed ?? syncLog.tags_parsed ?? 0,
        tags_csv_matched: merged.tags_csv_matched ?? syncLog.tags_csv_matched ?? 0,
        tags_manual_preserved: merged.tags_manual_preserved ?? syncLog.tags_manual_preserved ?? 0,
        tags_untagged: merged.tags_untagged ?? syncLog.tags_untagged ?? 0,
        meta_api_calls: (syncLog.meta_api_calls || 0) + ctx.metaApiCalls,
        api_errors: JSON.stringify([...JSON.parse(syncLog.api_errors || "[]"), ...ctx.apiErrors]),
        duration_ms: (syncLog.duration_ms || 0) + (Date.now() - startMs),
        ...(status !== "running" ? { completed_at: new Date().toISOString() } : {}),
      }).eq("id", syncLog.id);
    } catch (saveErr) {
      console.error("saveState failed:", saveErr);
      try {
        await supabase.from("sync_logs").update({
          sync_state: { ...state, last_activity: new Date().toISOString(), save_error: String(saveErr) },
        }).eq("id", syncLog.id);
      } catch (_) { /* truly lost */ }
    }

    if (status !== "running") {
      await promoteNextQueued(supabase);
    }
  };

  // Check sync_scope — skip phases not in scope
  if (!allowedPhases.includes(phase)) {
    const nextAllowed = allowedPhases.find((p: number) => p > phase);
    if (nextAllowed) {
      console.log(`Scope "${syncScope}": skipping phase ${phase}, jumping to phase ${nextAllowed}`);
      await saveState(nextAllowed, {});
      return;
    } else {
      const finalStatus = (JSON.parse(syncLog.api_errors || "[]")).length > 0 ? "completed_with_errors" : "completed";
      await saveState(5, {}, finalStatus);
      return;
    }
  }

  try {
    // ═══════════════════════════════════════════════════════════════════
    // PHASE 1: Fetch ads metadata — CAMPAIGN-BY-CAMPAIGN (large account safe)
    //   For large accounts (NDC has 18k+ ads), fetching all ads in one
    //   account-level sweep causes Meta to error mid-stream. Instead:
    //   1. Fetch all campaigns first (lightweight, rarely errors)
    //   2. For each campaign, fetch its ads — errors only lose one campaign
    //   3. Resume from exactly where we left off (campaign index + cursor)
    //   Small accounts fall through to the flat sweep as before.
    // ═══════════════════════════════════════════════════════════════════
    if (phase === 1) {
      // Get manual/csv-tagged ad IDs to preserve their tags (only update metadata)
      const { data: taggedAds } = await supabase.from("creatives").select("ad_id")
        .eq("account_id", accountId).in("tag_source", ["manual", "csv"]);
      const taggedAdIds = new Set((taggedAds || []).map((a: any) => a.ad_id));

      let fetchedCount = state.creatives_fetched || 0;

      // Helper: upsert a batch of ads to the DB
      const upsertAds = async (ads: any[]) => {
        const upsertBatch: any[] = [];
        const metadataBatch: { ad_id: string; data: any }[] = [];
        for (const ad of ads) {
          // Build post URL from effective_object_story_id (format: {page_id}_{post_id})
          let adPostUrl: string | null = null;
          const storyId = ad.creative?.effective_object_story_id;
          if (storyId && storyId.includes("_")) {
            const [pageId, postId] = storyId.split("_", 2);
            if (pageId && postId) {
              adPostUrl = `https://www.facebook.com/${pageId}/posts/${postId}/`;
            }
          }

          const metadata = {
            ad_name: ad.name,
            ad_status: ad.status || "UNKNOWN",
            campaign_name: ad.campaign?.name || null,
            adset_name: ad.adset?.name || null,
            ad_post_url: adPostUrl,
          };
          if (taggedAdIds.has(ad.id)) {
            metadataBatch.push({ ad_id: ad.id, data: metadata });
          } else {
            upsertBatch.push({
              ad_id: ad.id,
              account_id: accountId,
              platform: "meta",
              unique_code: ad.name.split("_")[0],
              ...metadata,
            });
          }
        }
        if (upsertBatch.length > 0) {
          const { error } = await supabase.from("creatives").upsert(upsertBatch, { onConflict: "ad_id" });
          if (error) console.error("Phase 1 upsert error:", error.message);
        }
        if (metadataBatch.length > 0) {
          const rpcPayload = metadataBatch.map(({ ad_id, data }) => ({ ad_id, ...data }));
          const { error } = await supabase.rpc("bulk_update_creative_metadata", { payload: JSON.stringify(rpcPayload) });
          if (error) console.error("Phase 1 metadata RPC error:", error.message);
        }
      };

      const deliveredFilter = encodeURIComponent(JSON.stringify([
        { field: "impressions", operator: "GREATER_THAN", value: "0" }
      ]));

      // ── Large account path: campaign-by-campaign ─────────────────────
      if (isLargeAccount) {
        // Step 1: fetch all campaigns (or resume from saved list)
        let campaigns: { id: string; name: string }[] = state.campaigns || [];

        if (campaigns.length === 0) {
          console.log("Phase 1 (large): fetching campaign list...");
          let campUrl: string | null =
            `https://graph.facebook.com/${META_API_VERSION}/${accountId}/campaigns?` +
            `fields=id,name&limit=200&access_token=${encodeURIComponent(metaToken)}`;
          while (campUrl && !isTimedOut()) {
            const result = await metaFetch(campUrl, ctx);
            if (result.error) {
              console.error("Failed to fetch campaigns — will retry next continue");
              await saveState(1, { campaigns: [], creatives_fetched: fetchedCount });
              return;
            }
            campaigns.push(...(result.data || []).map((c: any) => ({ id: c.id, name: c.name })));
            campUrl = result.next;
            if (campUrl) await new Promise(r => setTimeout(r, interRequestDelayMs));
          }
          console.log(`  Found ${campaigns.length} campaigns`);
        }

        // Step 2: iterate campaigns, resuming from saved index
        let campIdx = state.campaign_index || 0;
        let campCursor: string | null = state.campaign_cursor || null;

        while (campIdx < campaigns.length && !isTimedOut()) {
          await heartbeat();
          const campaign = campaigns[campIdx];

          // Check cancellation per campaign
          const { data: sc } = await supabase.from("sync_logs").select("status").eq("id", syncLog.id).single();
          if (sc?.status === "cancelled") return;

          // Fetch ads for this campaign
          let nextUrl: string | null = campCursor || (
            `https://graph.facebook.com/${META_API_VERSION}/${campaign.id}/ads?` +
            `fields=id,name,status,campaign{name},adset{name},creative{effective_object_story_id}` +
            `&filtering=${deliveredFilter}` +
            `&limit=200&access_token=${encodeURIComponent(metaToken)}`
          );
          campCursor = null; // reset for next campaign

          let campFetched = 0;
          let campError = false;

          while (nextUrl && !isTimedOut()) {
            const result = await metaFetch(nextUrl, ctx);
            if (result.error) {
              // Error on this campaign — log it, skip to next campaign
              // (don't abort the whole phase — other campaigns are independent)
              ctx.apiErrors.push({
                timestamp: new Date().toISOString(),
                message: `Ad fetch failed for campaign ${campaign.id} (${campaign.name}) — skipping`,
              });
              console.warn(`  Campaign ${campaign.name} errored — skipping`);
              campError = true;
              break;
            }
            if (result.data && result.data.length > 0) {
              await upsertAds(result.data);
              campFetched += result.data.length;
              fetchedCount += result.data.length;
            }
            nextUrl = result.next;
            if (nextUrl) await new Promise(r => setTimeout(r, interRequestDelayMs));
          }

          if (nextUrl && isTimedOut()) {
            // Timed out mid-campaign — save cursor and resume this campaign next invocation
            console.log(`Phase 1 paused mid-campaign ${campIdx + 1}/${campaigns.length} at ${fetchedCount} total ads`);
            await saveState(1, {
              campaigns,
              campaign_index: campIdx,
              campaign_cursor: nextUrl,
              creatives_fetched: fetchedCount,
            });
            return;
          }

          if (!campError) {
            console.log(`  Campaign ${campIdx + 1}/${campaigns.length} (${campaign.name}): ${campFetched} ads`);
          }

          campIdx++;
        }

        if (campIdx >= campaigns.length) {
          console.log(`Phase 1 complete (campaign-by-campaign): ${fetchedCount} ads across ${campaigns.length} campaigns`);
          await saveState(2, { campaigns: null, campaign_index: null, campaign_cursor: null, ads_cursor: null, creatives_fetched: fetchedCount });
        } else {
          // Timed out between campaigns
          console.log(`Phase 1 paused between campaigns at index ${campIdx}`);
          await saveState(1, { campaigns, campaign_index: campIdx, campaign_cursor: null, creatives_fetched: fetchedCount });
        }
        return;
      }

      // ── Standard path: flat account-level sweep (small accounts) ─────
      let nextUrl: string | null = state.ads_cursor || (
        `https://graph.facebook.com/${META_API_VERSION}/${accountId}/ads?` +
        `fields=id,name,status,campaign{name},adset{name}` +
        `&filtering=${deliveredFilter}` +
        `&limit=200&access_token=${encodeURIComponent(metaToken)}`
      );

      let phase1HasError = false;
      while (nextUrl && !isTimedOut()) {
        await heartbeat();
        const result = await metaFetch(nextUrl, ctx);
        if (result.error) {
          ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: "Ad fetch failed, unknown error" });
          phase1HasError = true;
          break;
        }
        if (result.data && result.data.length > 0) {
          await upsertAds(result.data);
          fetchedCount += result.data.length;
          console.log(`  Ads fetched & upserted: ${fetchedCount}`);
        }
        nextUrl = result.next;
        if (nextUrl) await new Promise(r => setTimeout(r, interRequestDelayMs));
      }

      if (nextUrl && isTimedOut()) {
        console.log(`Phase 1 paused at ${fetchedCount} ads — will resume`);
        await saveState(1, { ads_cursor: nextUrl, creatives_fetched: fetchedCount });
      } else if (phase1HasError) {
        const resumeCursor = nextUrl || null;
        console.log(`Phase 1 hit an error at ${fetchedCount} ads — will retry from ${resumeCursor ? "cursor" : "start"} next continue`);
        await saveState(1, { ads_cursor: resumeCursor, creatives_fetched: fetchedCount });
      } else {
        console.log(`Phase 1 complete: ${fetchedCount} ads`);
        await saveState(2, { ads_cursor: null, creatives_fetched: fetchedCount });
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 2: Fetch aggregated insights → BATCH upsert to creatives
    //   Groups metrics by ad_id and upserts in batches of 200
    //   instead of individual row updates.
    // ═══════════════════════════════════════════════════════════════════
    if (phase === 2) {
      const endDate = new Date();

      // ── CHANGE 2: Use incremental date range when available ──────────────
      // If we have a last_data_sync date, only fetch data since then.
      // Fall back to full dateRangeDays for initial syncs or missing timestamp.
      // On resume (cursor present), skip date recalculation and use saved URL directly.
      let phase2TimeRange: string;
      let phase2SinceDate: string;
      if (state.insights_cursor) {
        // Resuming — timeRange is embedded in the saved cursor URL, don't recalculate
        phase2TimeRange = state.insights_time_range || "";
        phase2SinceDate = state.insights_since_date || "";
        console.log(`Phase 2 resuming from cursor — time range: ${phase2TimeRange}`);
      } else if (incrementalSinceDate) {
        // Incremental: fetch only since last sync
        phase2SinceDate = incrementalSinceDate;
        phase2TimeRange = JSON.stringify({ since: phase2SinceDate, until: endDate.toISOString().split("T")[0] });
        console.log(`Phase 2 incremental: ${phase2SinceDate} → ${endDate.toISOString().split("T")[0]}`);
      } else {
        // Initial / full sync: use full date range
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - dateRangeDays);
        phase2SinceDate = startDate.toISOString().split("T")[0];
        phase2TimeRange = JSON.stringify({ since: phase2SinceDate, until: endDate.toISOString().split("T")[0] });
        console.log(`Phase 2 full: ${phase2SinceDate} → ${endDate.toISOString().split("T")[0]}`);
      }
      // ────────────────────────────────────────────────────────────────────

      const insightsFields = "ad_id,spend,purchase_roas,cost_per_action_type,ctr,clicks,impressions,cpm,cpc,frequency,actions,action_values,video_avg_time_watched_actions,video_thruplay_watched_actions";
      const cursor = state.insights_cursor || null;
      let insightsCount = state.insights_count || 0;
      // Track whether incremental query returned zero results (triggers fallback)
      let incrementalReturnedZero = false;

      let nextUrl = cursor || (
        `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights?` +
        `time_range=${encodeURIComponent(phase2TimeRange)}&level=ad` +
        `&fields=${insightsFields}` +
        `&limit=${insightsPageSize}&access_token=${encodeURIComponent(metaToken)}`
      );

      while (nextUrl && !isTimedOut()) {
        await heartbeat();
        const result = await metaFetch(nextUrl, ctx);
        if (result.error) break;
        if (result.data) {
          if (result.data.length === 0 && insightsCount === 0 && incrementalSinceDate && !state.insights_cursor) {
            // Incremental query returned nothing on first page — Meta may have limited history
            // Flag for fallback to full window
            incrementalReturnedZero = true;
            console.log(`Incremental query returned 0 results for ${account.name} — will fall back to full window`);
            break;
          }

          // Bulk update via DB function — single RPC call per batch instead of N individual updates
          const BATCH_SIZE = 500;
          const metricRows = result.data.map((row: any) => ({
            ad_id: row.ad_id,
            ...parseInsightsRow(row),
          }));

          for (let i = 0; i < metricRows.length; i += BATCH_SIZE) {
            const batch = metricRows.slice(i, i + BATCH_SIZE);
            const { error } = await supabase.rpc("bulk_update_creative_metrics", { payload: JSON.stringify(batch) });
            if (error) console.error("Phase 2 bulk RPC error:", error.message);
            if (isTimedOut()) break;
          }
          insightsCount += result.data.length;
          console.log(`  Insights bulk-upserted: ${insightsCount}`);
        }
        nextUrl = result.next;
        if (nextUrl) await new Promise(r => setTimeout(r, interRequestDelayMs));
      }

      // ── CHANGE 2: Fallback to full window if incremental returned nothing ──
      if (incrementalReturnedZero && !isTimedOut()) {
        console.log(`Falling back to full ${dateRangeDays}-day window for ${account.name}...`);
        const fallbackStart = new Date();
        fallbackStart.setDate(fallbackStart.getDate() - dateRangeDays);
        const fallbackTimeRange = JSON.stringify({
          since: fallbackStart.toISOString().split("T")[0],
          until: endDate.toISOString().split("T")[0],
        });
        let fallbackUrl: string | null =
          `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights?` +
          `time_range=${encodeURIComponent(fallbackTimeRange)}&level=ad` +
          `&fields=${insightsFields}` +
          `&limit=${insightsPageSize}&access_token=${encodeURIComponent(metaToken)}`;

        while (fallbackUrl && !isTimedOut()) {
          await heartbeat();
          const result = await metaFetch(fallbackUrl, ctx);
          if (result.error) break;
          if (result.data && result.data.length > 0) {
            const BATCH_SIZE = 500;
            const metricRows = result.data.map((row: any) => ({ ad_id: row.ad_id, ...parseInsightsRow(row) }));
            for (let i = 0; i < metricRows.length; i += BATCH_SIZE) {
              const batch = metricRows.slice(i, i + BATCH_SIZE);
              const { error } = await supabase.rpc("bulk_update_creative_metrics", { payload: JSON.stringify(batch) });
              if (error) console.error("Phase 2 fallback RPC error:", error.message);
              if (isTimedOut()) break;
            }
            insightsCount += result.data.length;
            console.log(`  Fallback insights upserted: ${insightsCount}`);
          }
          fallbackUrl = result.next;
          if (fallbackUrl) await new Promise(r => setTimeout(r, interRequestDelayMs));
        }
        if (fallbackUrl && isTimedOut()) {
          console.log(`Phase 2 fallback paused at ${insightsCount} insights`);
          await saveState(2, { insights_cursor: fallbackUrl, insights_count: insightsCount, insights_time_range: fallbackTimeRange, insights_since_date: fallbackStart.toISOString().split("T")[0] });
          return;
        }
      }
      // ────────────────────────────────────────────────────────────────────

      if (nextUrl && isTimedOut()) {
        console.log(`Phase 2 paused at ${insightsCount} insights`);
        await saveState(2, { insights_cursor: nextUrl, insights_count: insightsCount, insights_time_range: phase2TimeRange, insights_since_date: phase2SinceDate });
      } else {
        console.log(`Phase 2 complete: ${insightsCount} insights`);

        // ── Threshold check + Slack notification ──────────────────────────
        try {
          const slackUrl = Deno.env.get("SLACK_WEBHOOK_URL");
          if (slackUrl) {
            const spendThreshold = account.iteration_spend_threshold || 50;
            const scaleThreshold = account.scale_threshold || 2.0;
            const killThreshold = account.kill_threshold || 1.0;

            // Fetch creatives with meaningful spend for this account
            const { data: candidates } = await supabase
              .from("creatives")
              .select("ad_id, ad_name, roas, prior_roas, spend")
              .eq("account_id", accountId)
              .gt("spend", spendThreshold);

            const newWinners: { ad_name: string; roas: number; spend: number }[] = [];
            const newConcerns: { ad_name: string; roas: number; prior_roas: number }[] = [];

            for (const c of (candidates || [])) {
              const roas = Number(c.roas) || 0;
              const priorRoas = c.prior_roas != null ? Number(c.prior_roas) : null;

              // NEW WINNER: now above scale, wasn't before (or first sync)
              if (roas >= scaleThreshold && (priorRoas === null || priorRoas < scaleThreshold)) {
                newWinners.push({ ad_name: c.ad_name, roas, spend: Number(c.spend) || 0 });
              }
              // NEW CONCERN: now below kill, was above before
              if (roas < killThreshold && priorRoas !== null && priorRoas >= killThreshold) {
                newConcerns.push({ ad_name: c.ad_name, roas, prior_roas: priorRoas });
              }
            }

            if (newWinners.length > 0 || newConcerns.length > 0) {
              const blocks: string[] = [];

              if (newWinners.length > 0) {
                blocks.push(`*🟢 New winners — ${account.name}*`);
                for (const w of newWinners.slice(0, 10)) {
                  blocks.push(`• ${w.ad_name} — ${w.roas.toFixed(2)}x ROAS, $${w.spend.toLocaleString("en-US", { maximumFractionDigits: 0 })} spend`);
                }
                if (newWinners.length > 10) blocks.push(`  _…and ${newWinners.length - 10} more_`);
              }

              if (newConcerns.length > 0) {
                if (blocks.length > 0) blocks.push("");
                blocks.push(`*🔴 New concerns — ${account.name}*`);
                for (const c of newConcerns.slice(0, 10)) {
                  blocks.push(`• ${c.ad_name} — ${c.roas.toFixed(2)}x ROAS (was ${c.prior_roas.toFixed(2)}x)`);
                }
                if (newConcerns.length > 10) blocks.push(`  _…and ${newConcerns.length - 10} more_`);
              }

              const text = blocks.join("\n");
              console.log(`Sending Slack alert: ${newWinners.length} winners, ${newConcerns.length} concerns`);

              await fetch(slackUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
              });
            }
          }
        } catch (slackErr) {
          console.error("Slack notification error (non-fatal):", slackErr);
        }

        // ── CHANGE 2: Record last_data_sync timestamp after successful Phase 2 ──
        // This is the key timestamp that enables incremental sync on next run.
        // We set it to the start of the sync's effective date window so next run
        // only fetches data after this point.
        try {
          await supabase
            .from("ad_accounts")
            .update({ last_data_sync: new Date().toISOString() })
            .eq("id", accountId);
          console.log(`  Updated last_data_sync for ${account.name}`);
        } catch (syncTimestampErr) {
          console.error("Failed to update last_data_sync (non-fatal):", syncTimestampErr);
        }
        // ────────────────────────────────────────────────────────────────

        await saveState(3, { insights_cursor: null, insights_count: insightsCount, insights_time_range: null, insights_since_date: null });
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 3: Cleanup zero-spend creatives + count
    // ═══════════════════════════════════════════════════════════════════
    if (phase === 3) {
      console.log("Phase 3: Cleanup zero-spend creatives...");

      // Single delete call — no need to count first then delete separately
      const { count: zeroSpendCount } = await supabase.from("creatives")
        .delete({ count: "exact" })
        .eq("account_id", accountId).lte("spend", 0).not("tag_source", "in", '("manual","csv")');
      if (zeroSpendCount && zeroSpendCount > 0) {
        console.log(`  Cleaned up ${zeroSpendCount} zero-spend creatives`);
      }

      // Count remaining
      const { count: remaining } = await supabase.from("creatives")
        .select("*", { count: "exact", head: true }).eq("account_id", accountId);
      const creativesUpserted = remaining || 0;

      console.log(`Phase 3 complete: ${creativesUpserted} creatives remain`);
      await saveState(4, { creatives_upserted: creativesUpserted });
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 4: Daily metric breakdowns (chunked, resumable, batch upsert)
    //   Upserts incrementally per page instead of accumulating in memory
    // ═══════════════════════════════════════════════════════════════════
    if (phase === 4) {
      const { count: existingCount } = await supabase.from("creatives")
        .select("*", { count: "exact", head: true }).eq("account_id", accountId);
      const hasExistingAds = (existingCount || 0) > 0;

      // ── CHANGE 2: Incremental daily breakdowns ───────────────────────────
      // Use incremental date range for daily breakdowns too.
      // For initial syncs: full dateRangeDays (capped at 30 for daily detail).
      // For incremental syncs: only since last data sync (min 2 days for attribution).
      let dailyDays: number;
      let dailySinceDate: string;
      const CHUNK_DAYS = 15;
      const endDate = new Date();

      if (!state.daily_chunk_offset && incrementalSinceDate) {
        // Incremental: compute days since last sync
        const sinceMs = new Date(incrementalSinceDate).getTime();
        const daysSinceSync = Math.ceil((Date.now() - sinceMs) / (1000 * 60 * 60 * 24));
        // Add 2 days buffer for attribution window, cap at dateRangeDays
        dailyDays = Math.min(daysSinceSync + 2, dateRangeDays);
        dailySinceDate = incrementalSinceDate;
        console.log(`Phase 4 incremental: ${dailyDays} days of daily data (since ${dailySinceDate})`);
      } else if (!state.daily_chunk_offset) {
        // Initial/full: use the entire date_range_days window so daily metrics
        // cover the same period as the aggregated insights (Phase 2).
        dailyDays = dateRangeDays;
        const fullStart = new Date();
        fullStart.setDate(fullStart.getDate() - dailyDays);
        dailySinceDate = fullStart.toISOString().split("T")[0];
        console.log(`Phase 4 full: ${dailyDays} days of daily data`);
      } else {
        // Resuming — use saved values
        dailyDays = state.daily_days || dateRangeDays;
        dailySinceDate = state.daily_since_date || (() => {
          const d = new Date(); d.setDate(d.getDate() - dailyDays); return d.toISOString().split("T")[0];
        })();
      }
      // ────────────────────────────────────────────────────────────────────

      const fullStartDate = new Date(dailySinceDate + "T00:00:00Z");

      const chunkOffset = state.daily_chunk_offset || 0;
      const dailyCursor = state.daily_cursor || null;
      const totalChunks = Math.ceil(dailyDays / CHUNK_DAYS);

      console.log(`Phase 4: Daily breakdowns (${dailyDays} days, chunk ${chunkOffset + 1}/${totalChunks})...`);

      let currentChunk = chunkOffset;
      let paginationCursor = dailyCursor;

      while (currentChunk < totalChunks && !isTimedOut()) {
        const { data: sc } = await supabase.from("sync_logs").select("status").eq("id", syncLog.id).single();
        if (sc?.status === "cancelled") return;

        const chunkStart = new Date(fullStartDate);
        chunkStart.setDate(chunkStart.getDate() + currentChunk * CHUNK_DAYS);
        const chunkEnd = new Date(chunkStart);
        chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS - 1);
        if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());

        const chunkSince = chunkStart.toISOString().split("T")[0];
        const chunkUntil = chunkEnd.toISOString().split("T")[0];
        const chunkRange = JSON.stringify({ since: chunkSince, until: chunkUntil });

        console.log(`  Chunk ${currentChunk + 1}/${totalChunks}: ${chunkSince} → ${chunkUntil}`);

        const insightsFields = "ad_id,spend,purchase_roas,cost_per_action_type,ctr,clicks,impressions,cpm,cpc,frequency,actions,action_values,video_avg_time_watched_actions,video_thruplay_watched_actions";

        let nextUrl = paginationCursor || (
          `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights?` +
          `time_range=${encodeURIComponent(chunkRange)}&time_increment=1&level=ad` +
          `&fields=${insightsFields}` +
          `&limit=${insightsPageSize}&access_token=${encodeURIComponent(metaToken)}`
        );

        while (nextUrl && !isTimedOut()) {
          await heartbeat();
          const result = await metaFetch(nextUrl, ctx);
          if (result.error) { nextUrl = null; break; }
          if (result.data && result.data.length > 0) {
            // For large accounts (NDC has 18k+ creatives), loading all ad_ids into memory
            // is slow and the Set can't survive JSON serialization across resumes.
            // Instead: cross-check the batch of ad_ids from Meta against the DB directly.
            // This is a small IN query (≤500 ids) — fast and correct on any account size.
            const batchAdIds = result.data.map((row: any) => row.ad_id);
            const { data: existingAds } = await supabase
              .from("creatives")
              .select("ad_id")
              .eq("account_id", accountId)
              .in("ad_id", batchAdIds);
            const validAdIds = new Set<string>((existingAds || []).map((e: any) => e.ad_id));

            const rows = result.data
              .filter((row: any) => validAdIds.has(row.ad_id))
              .map((row: any) => ({
                ad_id: row.ad_id,
                account_id: accountId,
                date: row.date_start,
                ...parseInsightsRow(row),
              }));
            // Upsert in one call (up to 500 rows, matching Meta page size)
            if (rows.length > 0) {
              const { error } = await supabase.from("creative_daily_metrics").upsert(rows, { onConflict: "ad_id,date" });
              if (error) {
                console.error("Daily upsert error:", error.message);
                ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: `Daily upsert failed: ${error.message}` });
              }
            }
            console.log(`    Upserted ${rows.length} daily rows (filtered from ${result.data.length}, ${batchAdIds.length - validAdIds.size} not in DB)`);
          }
          nextUrl = result.next;
          if (nextUrl) await new Promise(r => setTimeout(r, interRequestDelayMs));
        }

        if (nextUrl && isTimedOut()) {
          console.log(`Phase 4 paused mid-chunk ${currentChunk + 1}`);
          await saveState(4, { daily_chunk_offset: currentChunk, daily_cursor: nextUrl, daily_days: dailyDays, daily_since_date: dailySinceDate });
          return;
        }

        paginationCursor = null;
        currentChunk++;
      }

      if (currentChunk >= totalChunks) {
        console.log("Phase 4 complete — moving to finalize");
        await saveState(5, { daily_chunk_offset: null, daily_cursor: null, daily_days: null, daily_since_date: null });
      } else {
        console.log(`Phase 4 paused after chunk ${currentChunk}`);
        await saveState(4, { daily_chunk_offset: currentChunk, daily_cursor: null, daily_days: dailyDays, daily_since_date: dailySinceDate });
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 5: Finalize
    // ═══════════════════════════════════════════════════════════════════
    if (phase === 5) {
      console.log("Phase 5: Finalizing...");

      // ── Auto-tag untagged creatives from ad names (BATCHED) ──
      try {
        const FORMAT_PATTERNS: [RegExp, string][] = [
          [/\bugc\b/i, "UGC"], [/\bgfx\b|graphic/i, "Graphic"],
          [/\bstatic\b|\bimg\b|\bimage\b/i, "Static Image"], [/\bvid\b|\bvideo\b/i, "Video"],
          [/carousel/i, "Carousel"], [/\bdpa\b/i, "DPA"],
        ];
        const HOOK_PATTERNS: [RegExp, string][] = [
          [/testimonial|review/i, "Testimonial"], [/unboxing/i, "Unboxing"],
          [/comparison|\bvs\b|competitor/i, "Competitor Comparison"],
          [/problem|pain/i, "Problem/Solution"], [/educational|\bedu\b|how\s*to/i, "Educational"],
          [/founder|behind/i, "Founder Story"],
        ];
        const ANGLE_PATTERNS: [RegExp, string][] = [
          [/sale|discount|%|\boff\b/i, "Offer/Discount"], [/\bfree\b/i, "Free Gift/Trial"],
          [/too expensive|objection/i, "Objection Handling"],
          [/social proof|reviews/i, "Social Proof"], [/benefit|results/i, "Benefits"],
        ];

        const { data: untagged } = await supabase
          .from("creatives")
          .select("ad_id, ad_name")
          .eq("account_id", accountId)
          .eq("tag_source", "untagged");

        // Batch: collect all updates, then upsert in chunks instead of one-by-one
        const tagUpdates: { ad_id: string; ad_type?: string; hook?: string; theme?: string; tag_source: string }[] = [];
        for (const c of (untagged || [])) {
          const tags: Record<string, string | null> = { ad_type: null, hook: null, theme: null };
          for (const [re, val] of FORMAT_PATTERNS) { if (re.test(c.ad_name)) { tags.ad_type = val; break; } }
          for (const [re, val] of HOOK_PATTERNS) { if (re.test(c.ad_name)) { tags.hook = val; break; } }
          if (!tags.hook && /\bugc\b/i.test(c.ad_name)) tags.hook = "Social Proof";
          for (const [re, val] of ANGLE_PATTERNS) { if (re.test(c.ad_name)) { tags.theme = val; break; } }
          if (tags.ad_type || tags.hook || tags.theme) {
            const row: any = { ad_id: c.ad_id, tag_source: "inferred" };
            if (tags.ad_type) row.ad_type = tags.ad_type;
            if (tags.hook) row.hook = tags.hook;
            if (tags.theme) row.theme = tags.theme;
            tagUpdates.push(row);
          }
        }
        // Batch update in chunks of 200
        for (let i = 0; i < tagUpdates.length; i += 200) {
          const chunk = tagUpdates.slice(i, i + 200);
          // Use individual updates grouped — Supabase doesn't support partial upsert on non-PK columns
          // But we can use Promise.all for parallelism within chunk
          await Promise.all(chunk.map(row => {
            const { ad_id, ...fields } = row;
            return supabase.from("creatives").update(fields).eq("ad_id", ad_id);
          }));
        }
        if (tagUpdates.length > 0) console.log(`  Auto-tagged ${tagUpdates.length} creatives from ad names`);
      } catch (autoErr) {
        console.error("Auto-tag error (non-fatal):", autoErr);
      }

      // Run both counts in parallel
      const [totalResult, untaggedResult] = await Promise.all([
        supabase.from("creatives").select("*", { count: "exact", head: true }).eq("account_id", accountId),
        supabase.from("creatives").select("*", { count: "exact", head: true }).eq("account_id", accountId).eq("tag_source", "untagged"),
      ]);

      await supabase.from("ad_accounts").update({
        creative_count: totalResult.count || 0, untagged_count: untaggedResult.count || 0,
        last_synced_at: new Date().toISOString(),
      }).eq("id", accountId);

      // Snapshot current ROAS → prior_roas for next sync's threshold comparison
      try {
        const { data: snapCount, error: snapErr } = await supabase.rpc("snapshot_prior_roas", { _account_id: accountId });
        if (snapErr) throw snapErr;
        console.log(`  Snapshotted prior_roas for ${snapCount} creatives`);
      } catch (priorErr) {
        console.error("prior_roas snapshot error (non-fatal):", priorErr);
      }

      // ── Record Creative Score snapshots (skip if running low on time) ──
      if (!isTimedOut()) {
        try {
          const { data: activeCreatives } = await supabase
            .from("creatives")
            .select("ad_id, roas, ctr, thumb_stop_rate, cpa, spend, ad_status")
            .eq("account_id", accountId)
            .gt("spend", 0)
            .gt("impressions", 0);

          if (activeCreatives && activeCreatives.length > 0) {
            const scaleThreshold = account.scale_threshold || 2.0;
            const ctrBenchmark = 3.0;
            const hookRateBenchmark = 25.0;

            const withCpa = activeCreatives.filter((c: any) => (Number(c.cpa) || 0) > 0);
            const avgCpa = withCpa.length > 0
              ? withCpa.reduce((s: number, c: any) => s + (Number(c.cpa) || 0), 0) / withCpa.length
              : 0;

            const scoreRows: any[] = [];
            for (const c of activeCreatives) {
              if (c.ad_status === "PAUSED") continue;
              const roas = Number(c.roas) || 0;
              const ctr = Number(c.ctr) || 0;
              const hookRate = Number(c.thumb_stop_rate) || 0;
              const cpa = Number(c.cpa) || 0;
              const roasComp = Math.round(Math.min(1, roas / scaleThreshold) * 35);
              const ctrComp = Math.round(Math.min(1, ctr / ctrBenchmark) * 20);
              const hookComp = Math.round(Math.min(1, hookRate / hookRateBenchmark) * 15);
              let cpaComp = 0;
              if (avgCpa > 0 && cpa > 0) {
                const ratio = cpa / avgCpa;
                if (ratio <= 1) cpaComp = 10;
                else if (ratio < 2) cpaComp = Math.round(10 * (1 - (ratio - 1)));
              }
              const momentumComp = 5;
              const fatigueComp = 0;
              const total = Math.max(0, Math.min(100, roasComp + ctrComp + hookComp + cpaComp + momentumComp + fatigueComp));
              scoreRows.push({
                ad_id: c.ad_id, account_id: accountId, score: total,
                roas_component: roasComp, ctr_component: ctrComp, hook_rate_component: hookComp,
                spend_efficiency_component: cpaComp, momentum_component: momentumComp, fatigue_component: fatigueComp,
              });
            }

            for (let i = 0; i < scoreRows.length; i += 500) {
              if (isTimedOut()) { console.log("  Score snapshots paused — budget exceeded"); break; }
              const chunk = scoreRows.slice(i, i + 500);
              const { error: scoreErr } = await supabase.from("score_history").insert(chunk);
              if (scoreErr) console.error("Score history insert error (non-fatal):", scoreErr.message);
            }
            console.log(`  Recorded score snapshots for ${scoreRows.length} creatives`);
          }
        } catch (scoreHistoryErr) {
          console.error("Score history error (non-fatal):", scoreHistoryErr);
        }
      } else {
        console.log("  Skipping score snapshots — budget exceeded");
      }

      // ── Auto-log changelog + notifications (consolidated single query) ──
      try {
        const scaleThreshold = account.scale_threshold || 2.0;
        const killThreshold = account.kill_threshold || 1.0;

        // Single query for all creatives with prior_roas — used by changelog AND notifications
        const { data: allCreatives } = await supabase
          .from("creatives")
          .select("ad_id, ad_name, roas, prior_roas, spend, ad_status")
          .eq("account_id", accountId)
          .gt("impressions", 0);

        // Get users linked to this account (for notifications)
        const { data: userLinks } = await supabase.from("user_accounts").select("user_id").eq("account_id", accountId);
        const userIds = (userLinks || []).map((l: any) => l.user_id);

        const changelogEntries: any[] = [];
        const notifications: any[] = [];

        for (const c of (allCreatives || [])) {
          const currentRoas = Number(c.roas) || 0;
          const priorRoas = Number(c.prior_roas) || 0;
          const spend = Number(c.spend) || 0;

          // New creative with spend detected
          if (spend > 0 && c.prior_roas === null) {
            changelogEntries.push({
              account_id: accountId, ad_id: c.ad_id, event_type: "new_creative",
              description: `New creative detected: ${c.ad_name}`,
              metadata: { ad_name: c.ad_name, spend, roas: currentRoas },
            });
          }

          // ROAS changed by >20%
          if (priorRoas > 0 && currentRoas > 0) {
            const pctChange = ((currentRoas - priorRoas) / priorRoas) * 100;
            if (Math.abs(pctChange) > 20) {
              changelogEntries.push({
                account_id: accountId, ad_id: c.ad_id, event_type: "roas_change",
                description: `${c.ad_name} ROAS ${pctChange > 0 ? "increased" : "decreased"} by ${Math.abs(pctChange).toFixed(0)}%`,
                old_value: priorRoas, new_value: currentRoas,
                metadata: { pct_change: pctChange, ad_name: c.ad_name },
              });
            }
          }

          // Crossed scale threshold
          if (priorRoas > 0 && currentRoas >= scaleThreshold && priorRoas < scaleThreshold) {
            changelogEntries.push({
              account_id: accountId, ad_id: c.ad_id, event_type: "threshold_crossed",
              description: `${c.ad_name} crossed scale threshold (${scaleThreshold}x ROAS)`,
              old_value: priorRoas, new_value: currentRoas,
              metadata: { threshold: "scale", threshold_value: scaleThreshold },
            });
            // Winner notification
            for (const uid of userIds) {
              notifications.push({
                user_id: uid, account_id: accountId, type: "winner",
                title: `🏆 New winner: ${c.ad_name}`,
                body: `ROAS hit ${currentRoas.toFixed(1)}x, crossing the ${scaleThreshold}x scale threshold.`,
              });
            }
          }

          // Dropped below kill threshold
          if (priorRoas > 0 && currentRoas < killThreshold && priorRoas >= killThreshold && spend > 0) {
            changelogEntries.push({
              account_id: accountId, ad_id: c.ad_id, event_type: "threshold_crossed",
              description: `${c.ad_name} dropped below kill threshold (${killThreshold}x ROAS)`,
              old_value: priorRoas, new_value: currentRoas,
              metadata: { threshold: "kill", threshold_value: killThreshold },
            });
            // Concern notification
            for (const uid of userIds) {
              notifications.push({
                user_id: uid, account_id: accountId, type: "concern",
                title: `⚠️ Underperformer: ${c.ad_name}`,
                body: `ROAS dropped to ${currentRoas.toFixed(1)}x, below the ${killThreshold}x kill threshold.`,
              });
            }
          }
        }

        // Check paused creatives (zero spend with prior data)
        const { data: pausedCreatives } = await supabase
          .from("creatives")
          .select("ad_id, ad_name, prior_roas")
          .eq("account_id", accountId)
          .eq("spend", 0)
          .not("prior_roas", "is", null)
          .gt("prior_roas", 0);

        for (const c of (pausedCreatives || [])) {
          changelogEntries.push({
            account_id: accountId, ad_id: c.ad_id, event_type: "creative_paused",
            description: `${c.ad_name} has no spend (was ${Number(c.prior_roas).toFixed(1)}x ROAS)`,
            metadata: { prior_roas: c.prior_roas },
          });
        }

        // Sync complete notification
        for (const uid of userIds) {
          notifications.push({
            user_id: uid, account_id: accountId, type: "sync",
            title: `Sync complete: ${account.name}`,
            body: `${totalResult.count || 0} creatives synced.`,
          });
        }

        // Batch insert changelog (limit 50)
        if (changelogEntries.length > 0) {
          const batch = changelogEntries.slice(0, 50);
          const { error: clErr } = await supabase.from("performance_changelog").insert(batch);
          if (clErr) console.error("Changelog insert error (non-fatal):", clErr.message);
          else console.log(`  Logged ${batch.length} changelog entries`);
        }

        // Batch insert notifications (limit 50)
        if (notifications.length > 0) {
          const batch = notifications.slice(0, 50);
          await supabase.from("notifications").insert(batch);
          console.log(`  Created ${batch.length} notifications`);
        }
      } catch (changelogNotifErr) {
        console.error("Changelog/notification error (non-fatal):", changelogNotifErr);
      }

      const finalStatus = (JSON.parse(syncLog.api_errors || "[]")).length > 0 ? "completed_with_errors" : "completed";
      await saveState(5, {}, finalStatus);
      console.log(`\n✅ Sync complete for ${account.name}: ${finalStatus}`);
      return;
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`Phase ${phase} error:`, errMsg);
    ctx.apiErrors.push({ timestamp: new Date().toISOString(), message: errMsg });
    try {
      await supabase.from("sync_logs").update({
        status: "failed",
        api_errors: JSON.stringify([...JSON.parse(syncLog.api_errors || "[]"), ...ctx.apiErrors]),
        completed_at: new Date().toISOString(),
        duration_ms: (syncLog.duration_ms || 0) + (Date.now() - startMs),
      }).eq("id", syncLog.id);
    } catch (_) { /* can't save error status */ }
    await promoteNextQueued(supabase);
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/sync\/?/, "").replace(/\/$/, "");

  // Auth: validate user token or cron anon key
  // The Supabase gateway validates the JWT/apikey before the function runs.
  // For user-initiated actions (sync start, cancel), we additionally verify role.
  // For cron paths (continue, history), gateway auth is sufficient.
  const isCronSafePath = path === "continue" || path.startsWith("history");
  if (!isCronSafePath) {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const authToken = authHeader.replace("Bearer ", "");

    // Check if this is a cron/anon-key call: the Supabase gateway already validates the JWT,
    // so if the token decodes to role=anon, it's a valid cron call.
    let isAnonKey = false;
    try {
      const payload = JSON.parse(atob(authToken.split(".")[1]));
      isAnonKey = payload.role === "anon";
    } catch (_) { /* not a JWT */ }

    if (!isAnonKey) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(authToken);
      if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: userRole } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
      if (!userRole || !["builder", "employee"].includes(userRole.role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
  }

  try {
    // ─── GET /sync/history ─────────────────────────────────────────────
    if (req.method === "GET" && path.startsWith("history")) {
      const historyId = path.replace("history/", "").replace("history", "");
      if (historyId && historyId !== "") {
        const { data, error } = await supabase.from("sync_logs").select("*").eq("id", historyId).single();
        if (error) throw error;
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const accountId = url.searchParams.get("account_id");
      const limit = parseInt(url.searchParams.get("limit") || "20");
      let query = supabase.from("sync_logs").select("*").order("started_at", { ascending: false }).limit(limit);
      if (accountId) query = query.eq("account_id", accountId);
      const { data, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── POST /sync/cancel ─────────────────────────────────────────────
    if (req.method === "POST" && path === "cancel") {
      const { data: activeSyncs } = await supabase.from("sync_logs").select("id, started_at").in("status", ["running", "queued"]);
      if (!activeSyncs?.length) {
        return new Response(JSON.stringify({ message: "No running sync to cancel" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const now = new Date().toISOString();
      await supabase.from("sync_logs").update({
        status: "cancelled",
        api_errors: JSON.stringify([{ timestamp: now, message: "Cancelled by user" }]),
        completed_at: now,
      }).in("id", activeSyncs.map((s: any) => s.id));
      return new Response(JSON.stringify({ cancelled: activeSyncs.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── POST /sync/continue ───────────────────────────────────────────
    if (req.method === "POST" && path === "continue") {
      const { data: runningSyncs } = await supabase.from("sync_logs")
        .select("*")
        .eq("status", "running")
        .order("started_at", { ascending: true });

      if (!runningSyncs?.length) {
        await promoteNextQueued(supabase);
        return new Response(JSON.stringify({ message: "No syncs to continue, promoted queued if any" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Enforce single-runner: if multiple are "running", demote all but the oldest back to queued
      if (runningSyncs.length > 1) {
        const extraIds = runningSyncs.slice(1).map((s: any) => s.id);
        await supabase.from("sync_logs")
          .update({ status: "queued" })
          .in("id", extraIds);
        console.log(`Demoted ${extraIds.length} extra running sync(s) back to queued: ${extraIds.join(", ")}`);
      }

      const syncLog = runningSyncs[0];

      let metaToken = Deno.env.get("META_ACCESS_TOKEN");
      if (!metaToken) {
        const { data: tokenRow } = await supabase.from("settings").select("value").eq("key", "meta_access_token").single();
        metaToken = tokenRow?.value || null;
      }
      if (!metaToken) {
        return new Response(JSON.stringify({ error: "No Meta token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      await supabase.from("sync_logs").update({
        sync_state: { ...syncLog.sync_state, last_activity: new Date().toISOString() },
      }).eq("id", syncLog.id);

      await runSyncPhase(supabase, syncLog, metaToken);

      return new Response(JSON.stringify({ continued: syncLog.id, phase: syncLog.current_phase }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── POST /sync ────────────────────────────────────────────────────
    if (req.method === "POST" && !path) {
      const body = await req.json();
      const { account_id, sync_type = "manual", sync_scope = "full" } = body;
      // sync_scope controls which phases run:
      //   "full"     = phases 1-5 (default)
      //   "metadata" = phase 1 only (ads metadata)
      //   "insights" = phases 2-3 (aggregated insights + cleanup)
      //   "daily"    = phase 4 only (daily breakdowns)
      //   "lite"     = phases 1-3 (skip daily breakdowns)

      // Check if requested accounts are already running/queued (allow queuing new ones)
      const { data: activeSyncs } = await supabase.from("sync_logs").select("id, account_id, status").in("status", ["running", "queued"]);
      const activeAccountIds = new Set((activeSyncs || []).map((s: any) => s.account_id));

      let metaToken = Deno.env.get("META_ACCESS_TOKEN");
      if (!metaToken) {
        const { data: tokenRow } = await supabase.from("settings").select("value").eq("key", "meta_access_token").single();
        metaToken = tokenRow?.value || null;
      }
      if (!metaToken) return new Response(JSON.stringify({ error: "No Meta access token configured" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      let accounts: any[] = [];
      if (account_id && account_id !== "all") {
        const { data } = await supabase.from("ad_accounts").select("*").eq("id", account_id).single();
        if (data) accounts = [data];
      } else {
        const { data } = await supabase.from("ad_accounts").select("*").eq("is_active", true);
        accounts = data || [];
      }
      if (!accounts.length) return new Response(JSON.stringify({ error: "No accounts to sync" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const created: any[] = [];

      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];

        // Skip accounts that already have an active sync
        if (activeAccountIds.has(account.id)) {
          console.log(`Skipping ${account.name} — already running/queued`);
          continue;
        }

        const dateRangeDays = sync_type === "initial" ? 90 : (account.date_range_days || 14);
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - dateRangeDays);

        // Always insert as "queued" — promotion happens after insert
        const { data: logEntry, error: logError } = await supabase.from("sync_logs").insert({
          account_id: account.id, sync_type,
          status: "queued",
          current_phase: 1,
          sync_state: { last_activity: new Date().toISOString(), sync_scope },
          date_range_start: startDate.toISOString().split("T")[0],
          date_range_end: endDate.toISOString().split("T")[0],
        }).select().single();

        if (logError) {
          console.error("Log create error:", logError);
          continue;
        }
        created.push({ id: logEntry.id, account_id: account.id, account_name: account.name });
      }

      if (!created.length) {
        return new Response(JSON.stringify({ message: "All requested accounts already syncing" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // After inserting, check if there's already a running sync.
      // If not, promote the oldest queued sync (which may be one we just created).
      const { data: currentRunning } = await supabase.from("sync_logs")
        .select("id")
        .eq("status", "running")
        .limit(1);

      if (!currentRunning?.length) {
        // No running sync — promote the oldest queued
        const { data: oldest } = await supabase.from("sync_logs")
          .select("*")
          .eq("status", "queued")
          .order("started_at", { ascending: true })
          .limit(1);

        if (oldest?.length) {
          // Atomically promote only if still queued (prevents race condition)
          const { data: promoted, error: promoteErr } = await supabase.from("sync_logs")
            .update({ status: "running", sync_state: { ...oldest[0].sync_state, last_activity: new Date().toISOString() } })
            .eq("id", oldest[0].id)
            .eq("status", "queued")  // only if still queued
            .select()
            .single();

          if (promoted && !promoteErr) {
            console.log(`Promoted sync ${promoted.id} for ${promoted.account_id}`);
            // Run first phase inline
            await runSyncPhase(supabase, promoted, metaToken);
          }
        }
      }

      // Dead code removed — created.length is guaranteed > 0 here (checked at line 1394)

      return new Response(JSON.stringify({ started: created }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Sync error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
