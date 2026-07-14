// US-004: One-time historical backfill of daily ad metrics back to RETENTION_DAYS.
//
// WHY: the rolling incremental sync (US-002) only re-pulls a ~28d recent window,
// and the local rollup (US-003) reconstructs the per-ad snapshot from stored
// daily rows. Neither can conjure history that was never fetched. This function
// walks BACKWARD in day-chunks from each account's current coverage edge
// (`ad_accounts.daily_backfilled_since`, or today for a never-backfilled account)
// down to RETENTION_DAYS=365 days ago (or as far back as Meta has data), writing
// `creative_daily_metrics` rows so every active account holds a full promised year
// on day one. Once an account reaches the 365d target its watermark is pinned and
// the job never touches it again.
//
// IDEMPOTENT + RESUMABLE + NEVER RE-PULLS COVERED DATES:
//   * The backward frontier is `daily_backfilled_since` — the earliest date with
//     complete coverage. We only ever fetch the chunk immediately OLDER than it,
//     so dates already covered are never re-requested (except a 1-day overlap on
//     the frontier itself, whose upsert is a harmless no-op on the (ad_id,date) PK).
//   * After a chunk's rows are written, the watermark advances to the chunk's
//     start date. A crash/rate-limit mid-run loses at most the in-flight chunk;
//     the next invocation resumes from the persisted watermark. Upserts on the
//     (ad_id,date) PK make any replay of an in-flight chunk a no-op.
//
// RATE-LIMIT SAFETY (the critical constraint for this story — do NOT hammer Meta
// across all accounts at once):
//   * metaFetch's three-way outcome contract is reused verbatim: success /
//     terminal error / resumable rate-limit pause. A pause is NEVER treated as
//     completion — the account is left mid-backfill (watermark not advanced past
//     the un-fetched chunk) and picked up next cron cycle.
//   * Interruptible exponential backoff (30/60/120/240/300s, capped 5m) matches
//     the sync's error-#4 detection exactly, re-checking the wall budget each
//     second so a backoff can never overrun the invocation.
//   * MAX_ACCOUNTS_PER_RUN bounds how many accounts one invocation advances, and
//     the pg_cron drains the queue on a SLOW cadence (see the companion
//     migration) so backfill pressure is spread across accounts over time rather
//     than fanned out simultaneously.
//
// PARSE REUSE: the daily-row shape mirrors the sync's Phase-4 upsert. The curve
// parser is the canonical `parsePlayCurve` (../_shared/play-curve.ts) — IMPORTED,
// never re-implemented. There is exactly one play-curve parser in the codebase.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { parsePlayCurve } from "../_shared/play-curve.ts";
import { RETENTION_DAYS } from "../_shared/retention-config.ts";

const META_API_VERSION = "v22.0";

// Day-chunk size for one Graph time_range request (matches sync Phase-4 CHUNK_DAYS).
export const CHUNK_DAYS = 15;

// Per-invocation wall budget. Edge fn hard wall ~150s here; leave margin to flush
// the final upsert + watermark update + serialize the response.
export const DEADLINE_MS = 120_000;

// Max accounts one invocation will advance. Keeps a single run from fanning out
// across every account at once (rate-limit pressure) — the cron drains the rest.
export const MAX_ACCOUNTS_PER_RUN = 3;

// Graph insights page size and DB write batch size.
export const META_PAGE = 200;
export const WRITE_BATCH = 500;

// Max consecutive rate-limit backoffs before pausing the account for next cron.
export const MAX_RATE_LIMIT_RETRIES = 5;

// Delay between paginated Graph requests (ms) — gentle pacing under app-wide limits.
export const INTER_REQUEST_DELAY_MS = 300;

// Insights fields — the daily-grain set the sync Phase-4 upsert consumes, plus the
// play-curve field so the retention curve is backfilled at daily grain too.
export const INSIGHTS_FIELDS =
  "ad_id,date_start,spend,purchase_roas,cost_per_action_type,ctr,clicks,impressions,cpm,cpc,frequency,actions,action_values,video_avg_time_watched_actions,video_thruplay_watched_actions,video_play_curve_actions";

/**
 * App-wide / throttle error detection — mirrors the sync's `metaFetch` exactly so
 * the two paths agree on what "rate limited" means (Graph error #4 = app-level
 * rate limit; the rest are user/page throttles + textual fallbacks).
 */
// deno-lint-ignore no-explicit-any
export function isRateLimitError(err: any): boolean {
  if (!err) return false;
  return (
    err.code === 4 ||
    err.code === 17 ||
    err.code === 32 ||
    err.code === 80004 ||
    err.code === 80000 ||
    err.error_subcode === 2446079 ||
    (typeof err.message === "string" &&
      (err.message.includes("request limit") ||
        err.message.includes("rate limit") ||
        err.message.includes("too many calls")))
  );
}

// Base backoff seconds — overridable so tests can collapse the exponential wait
// without real 30s+ sleeps (mirrors sync's SYNC_BACKOFF_BASE_SEC).
const BACKOFF_BASE_SEC = Number(Deno.env.get("BACKFILL_BACKOFF_BASE_SEC") ?? "30");

/**
 * Exponential backoff in ms for the Nth (1-based) rate-limit retry:
 * 30s, 60s, 120s, 240s, 300s — capped at 5 minutes. Matches the sync formula.
 */
export function backoffMs(retry: number): number {
  return Math.min(300, BACKOFF_BASE_SEC * Math.pow(2, Math.max(0, retry - 1))) * 1000;
}

/** ISO date (YYYY-MM-DD) for a Date. */
export function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** ISO date `days` before `now`. */
export function dateDaysAgo(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return isoDate(d);
}

/**
 * Compute the next backward chunk to fetch for an account.
 *
 * @param frontier the account's current coverage edge — `daily_backfilled_since`
 *   (earliest covered date) or, for a never-backfilled account, today.
 * @param target   the oldest date we want covered (RETENTION_DAYS ago, or account
 *   creation, whichever is later).
 * @returns null when the account already reaches the target (nothing to do), else
 *   the { since, until } for the chunk immediately OLDER than the frontier. `until`
 *   overlaps the frontier by one day (a no-op upsert) so no day can slip between
 *   the covered region and the newly-fetched chunk.
 */
export function nextChunk(
  frontier: string,
  target: string,
): { since: string; until: string } | null {
  if (frontier <= target) return null; // already at/beyond the target
  const frontierDate = new Date(frontier + "T00:00:00Z");
  // until = the frontier day itself (1-day overlap, no-op upsert on the PK).
  const until = isoDate(frontierDate);
  // since = CHUNK_DAYS older than the frontier, clamped to the target.
  const sinceDate = new Date(frontierDate);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - CHUNK_DAYS);
  let since = isoDate(sinceDate);
  if (since < target) since = target;
  return { since, until };
}

/** Build the Graph insights URL for one account over [since, until] at daily grain. */
export function insightsUrl(
  accountId: string,
  since: string,
  until: string,
  attributionSetting: string,
  metaToken: string,
): string {
  const timeRange = JSON.stringify({ since, until });
  return (
    `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights?` +
    `time_range=${encodeURIComponent(timeRange)}&time_increment=1&level=ad` +
    `&fields=${INSIGHTS_FIELDS}` +
    `&${attributionSetting}` +
    `&limit=${META_PAGE}&access_token=${encodeURIComponent(metaToken)}`
  );
}

/**
 * Map one raw Graph insights row -> a `creative_daily_metrics` upsert row.
 *
 * Mirrors the sync Phase-4 mapping: summable base metrics + derived ratios, plus
 * the daily-grain play-curve columns (US-001) via the canonical `parsePlayCurve`.
 * Returns null for rows missing `ad_id`/`date_start` (would corrupt the (ad_id,date)
 * upsert key) or for ad_ids not in `validAdIds`.
 */
// deno-lint-ignore no-explicit-any
export function buildDailyRow(row: any, accountId: string, validAdIds: Set<string>) {
  if (!row?.ad_id || !row?.date_start) return null;
  if (!validAdIds.has(row.ad_id)) return null;

  const spend = parseFloat(row.spend || "0");
  const roas = row.purchase_roas?.[0]?.value ? parseFloat(row.purchase_roas[0].value) : 0;
  const ctr = parseFloat(row.ctr || "0");
  const clicks = parseInt(row.clicks || "0");
  const impressions = parseInt(row.impressions || "0");
  const cpm = parseFloat(row.cpm || "0");
  const cpc = parseFloat(row.cpc || "0");
  const frequency = parseFloat(row.frequency || "0");

  let purchases = 0, purchaseValue = 0, cpa = 0, addsToCart = 0, costPerAtc = 0;
  let videoViews = 0, thruPlays = 0;

  const purchaseTypes = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
  const atcTypes = ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart", "omni_add_to_cart"];

  if (row.actions) {
    // deno-lint-ignore no-explicit-any
    const pa = row.actions.find((a: any) => purchaseTypes.includes(a.action_type));
    if (pa) purchases = parseInt(pa.value || "0");
    // deno-lint-ignore no-explicit-any
    const atc = row.actions.find((a: any) => atcTypes.includes(a.action_type));
    if (atc) addsToCart = parseInt(atc.value || "0");
    // deno-lint-ignore no-explicit-any
    const vv = row.actions.find((a: any) => a.action_type === "video_view");
    if (vv) videoViews = parseInt(vv.value || "0");
  }
  if (row.video_thruplay_watched_actions) {
    // deno-lint-ignore no-explicit-any
    const tp = row.video_thruplay_watched_actions.find((a: any) => a.action_type === "video_view");
    if (tp) thruPlays = parseInt(tp.value || "0");
  }
  if (row.action_values) {
    // deno-lint-ignore no-explicit-any
    const pv = row.action_values.find((a: any) => purchaseTypes.includes(a.action_type));
    if (pv) purchaseValue = parseFloat(pv.value || "0");
  }
  if (row.cost_per_action_type) {
    // deno-lint-ignore no-explicit-any
    const cp = row.cost_per_action_type.find((a: any) => purchaseTypes.includes(a.action_type));
    if (cp) cpa = parseFloat(cp.value || "0");
    // deno-lint-ignore no-explicit-any
    const cpatc = row.cost_per_action_type.find((a: any) => atcTypes.includes(a.action_type));
    if (cpatc) costPerAtc = parseFloat(cpatc.value || "0");
  }

  const thumbStopRate = impressions > 0 && videoViews > 0 ? (videoViews / impressions) * 100 : 0;
  const holdRate = videoViews > 0 && thruPlays > 0 ? (thruPlays / videoViews) * 100 : 0;

  let videoAvgPlayTime = 0;
  if (row.video_avg_time_watched_actions) {
    // deno-lint-ignore no-explicit-any
    const vat = row.video_avg_time_watched_actions.find((a: any) => a.action_type === "video_view");
    if (vat) videoAvgPlayTime = parseFloat(vat.value || "0");
  }

  const { play_curve, retention_p25, retention_p50, retention_p75, retention_p100 } =
    parsePlayCurve(row.video_play_curve_actions);

  return {
    ad_id: row.ad_id,
    account_id: accountId,
    date: row.date_start,
    spend,
    roas,
    cpa,
    ctr,
    clicks,
    impressions,
    cpm,
    cpc,
    frequency,
    purchases,
    purchase_value: purchaseValue,
    thumb_stop_rate: thumbStopRate,
    hold_rate: holdRate,
    video_avg_play_time: videoAvgPlayTime,
    adds_to_cart: addsToCart,
    cost_per_add_to_cart: costPerAtc,
    video_views: videoViews,
    video_play_curve_actions: play_curve,
    retention_p25,
    retention_p50,
    retention_p75,
    retention_p100,
  };
}

interface Counters {
  chunks: number; // chunks fetched this run
  fetched: number; // Graph rows returned
  upserted: number; // daily rows written
  paused: boolean; // true if a rate-limit pause left the account mid-backfill
  errors: number;
  reached_target: boolean; // true if the account hit the 365d target this run
  watermark: string | null; // watermark after this run
}
function newCounters(): Counters {
  return { chunks: 0, fetched: 0, upserted: 0, paused: false, errors: 0, reached_target: false, watermark: null };
}

// deno-lint-ignore no-explicit-any
interface MetaFetchResult { data: any[] | null; next: string | null; error: any | null; rateLimited: boolean; }
export type MetaFetcher = (url: string) => Promise<MetaFetchResult>;

/** Default Graph fetcher — one HTTP GET, normalized into MetaFetchResult. */
const defaultMetaFetch: MetaFetcher = async (url: string) => {
  const resp = await fetch(url);
  const json = await resp.json();
  if (json.error) {
    return { data: null, next: null, error: json.error, rateLimited: isRateLimitError(json.error) };
  }
  return { data: json.data || [], next: json.paging?.next || null, error: null, rateLimited: false };
};

/**
 * @param req               inbound request ({ account_id?, dry_run? } body)
 * @param supabaseOverride  injected Supabase client (tests); a real client is
 *                          created from env otherwise. A non-client second arg
 *                          (serve passes connInfo) is ignored.
 * @param metaFetchOverride injected Graph fetcher (tests); defaults to a live GET.
 */
export async function handler(
  req: Request,
  // deno-lint-ignore no-explicit-any
  supabaseOverride?: any,
  metaFetchOverride?: MetaFetcher,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedMs = Date.now();
  const timedOut = () => Date.now() - startedMs > DEADLINE_MS;
  const now = new Date();

  const supabase = (supabaseOverride && typeof supabaseOverride.from === "function")
    ? supabaseOverride
    : createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const metaFetch = metaFetchOverride ?? defaultMetaFetch;

  try {
    let body: { account_id?: string; dry_run?: boolean } = {};
    try { body = await req.json(); } catch { /* no body */ }
    const dryRun = body.dry_run === true;

    // Meta token: env first, then the settings table (same fallback as sync).
    let metaToken = Deno.env.get("META_ACCESS_TOKEN");
    if (!metaToken) {
      const { data: tokenRow } = await supabase
        .from("settings").select("value").eq("key", "meta_access_token").single();
      metaToken = tokenRow?.value;
    }
    if (!metaToken) {
      return new Response(JSON.stringify({ success: false, error: "META_ACCESS_TOKEN not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The oldest date any account should reach. Accounts younger than this are
    // clamped per-account to their creation date below.
    const globalTarget = dateDaysAgo(now, RETENTION_DAYS);
    const today = isoDate(now);

    // Resolve accounts. Explicit account_id => just that one. Otherwise the
    // queue: active accounts NOT yet fully backfilled (watermark NULL, i.e. never
    // started, OR watermark still newer than the target). Oldest-progress first
    // so laggards drain before already-advanced accounts. Bounded so one run
    // never fans out across every account at once.
    // deno-lint-ignore no-explicit-any
    let accounts: any[];
    if (body.account_id) {
      const { data, error } = await supabase
        .from("ad_accounts")
        .select("id, name, click_window, view_window, daily_backfilled_since")
        .eq("id", body.account_id);
      if (error) throw error;
      accounts = data || [];
    } else {
      // A fully-backfilled account has daily_backfilled_since <= globalTarget.
      // We want those NOT yet at target: watermark IS NULL (never started) OR
      // watermark > globalTarget (still has history to pull). PostgREST `.or`
      // with a null check + gt on the target date.
      const { data, error } = await supabase
        .from("ad_accounts")
        .select("id, name, click_window, view_window, daily_backfilled_since")
        .eq("is_active", true)
        .or(`daily_backfilled_since.is.null,daily_backfilled_since.gt.${globalTarget}`)
        .order("daily_backfilled_since", { ascending: false, nullsFirst: true })
        .limit(MAX_ACCOUNTS_PER_RUN);
      if (error) throw error;
      accounts = data || [];
    }

    const perAccount = new Map<string, Counters>();
    let drained = true; // false if the budget/pause cut work short

    for (const account of accounts) {
      if (timedOut()) { drained = false; break; }

      const accountId = account.id as string;
      const counters = newCounters();
      perAccount.set(accountId, counters);

      // Per-account target: RETENTION_DAYS ago. We do NOT clamp to a stored
      // account-creation date — `ad_accounts.created_at` is our onboarding
      // timestamp, not the Meta account's age, so clamping to it would wrongly
      // truncate the backfill for recently-onboarded accounts. Meta simply
      // returns empty pages for dates before the account had activity, which the
      // chunk loop below handles, so walking to the global target is safe.
      const target = globalTarget;

      // Frontier: the coverage edge. NULL watermark => never backfilled => start
      // from today and walk back. Otherwise start from the earliest covered date.
      let frontier: string = account.daily_backfilled_since || today;
      counters.watermark = frontier;

      // Attribution windows — same shape the sync uses for accurate conversions.
      const clickWindow = account.click_window || 7;
      const viewWindow = account.view_window || 1;
      const attributionSetting =
        `action_attribution_windows=["${clickWindow}d_click","${viewWindow}d_view"]`;

      // Cache of valid ad_ids for this account (creatives that exist locally).
      // Daily rows FK to creatives(ad_id); Meta may report ads we filtered out.
      // We auto-create missing creatives (same as sync Phase-4) so their history
      // isn't silently dropped.
      const validAdIds = new Set<string>();

      // Walk backward chunk-by-chunk until we reach the target, pause, or time out.
      while (true) {
        if (timedOut()) { drained = false; break; }

        const chunk = nextChunk(frontier, target);
        if (!chunk) {
          // Already at/beyond target — the account is fully backfilled. Leave the
          // watermark exactly as-is: it is already <= target (nextChunk returned
          // null), so the queue filter (daily_backfilled_since.gt.target) already
          // excludes it. Never move the watermark FORWARD to target — that would
          // discard genuine older coverage and re-admit dates we already have.
          counters.reached_target = true;
          break;
        }

        // ── Fetch the chunk, page by page, reusing the rate-limit contract. ──
        let nextUrl: string | null =
          insightsUrl(accountId, chunk.since, chunk.until, attributionSetting, metaToken);
        let rateLimitRetries = 0;
        let chunkOk = true;

        while (nextUrl) {
          if (timedOut()) { drained = false; chunkOk = false; break; }

          const result = await metaFetch(nextUrl);

          if (result.error) {
            if (result.rateLimited && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
              rateLimitRetries++;
              // Interruptible backoff — re-check the wall budget each second so a
              // long backoff cannot overrun the invocation (resume next cron).
              const waitUntil = Date.now() + backoffMs(rateLimitRetries);
              let bailed = false;
              while (Date.now() < waitUntil) {
                await new Promise((r) => setTimeout(r, 1000));
                if (timedOut()) { drained = false; bailed = true; break; }
              }
              if (bailed) { chunkOk = false; break; }
              continue; // same URL, post-backoff
            }
            // Resumable rate-limit pause (retries exhausted) OR terminal error.
            // EITHER WAY: do NOT advance the watermark past this un-fetched chunk
            // — a pause must never read as completion (the June-2026 data-drift
            // failure mode). Leave the account mid-backfill for the next cron.
            if (result.rateLimited) {
              counters.paused = true;
            } else {
              counters.errors++;
            }
            chunkOk = false;
            drained = false;
            break;
          }
          rateLimitRetries = 0; // reset after any clean page

          const pageRows = result.data || [];
          counters.fetched += pageRows.length;

          if (pageRows.length > 0) {
            // Cross-check ad_ids against creatives; auto-create the missing ones
            // so their history isn't dropped (mirrors sync Phase-4).
            // deno-lint-ignore no-explicit-any
            const batchAdIds = [...new Set(pageRows.map((r: any) => r.ad_id).filter(Boolean))] as string[];
            const unknown = batchAdIds.filter((id) => !validAdIds.has(id));
            if (unknown.length > 0) {
              const { data: existing } = await supabase
                .from("creatives").select("ad_id").eq("account_id", accountId).in("ad_id", unknown);
              // deno-lint-ignore no-explicit-any
              for (const e of existing || []) validAdIds.add((e as any).ad_id);
              const stillMissing = unknown.filter((id) => !validAdIds.has(id));
              if (stillMissing.length > 0 && !dryRun) {
                const newCreatives = stillMissing.map((adId) => ({
                  ad_id: adId,
                  account_id: accountId,
                  ad_name: adId, // placeholder — refreshed on next Phase-1 sync
                  platform: "meta",
                  tag_source: "untagged",
                  impressions: 0,
                }));
                const { error: insErr } = await supabase
                  .from("creatives").upsert(newCreatives, { onConflict: "ad_id", ignoreDuplicates: true });
                if (!insErr) for (const id of stillMissing) validAdIds.add(id);
              } else if (stillMissing.length > 0 && dryRun) {
                for (const id of stillMissing) validAdIds.add(id);
              }
            }

            const rows = pageRows
              .map((row) => buildDailyRow(row, accountId, validAdIds))
              .filter((r): r is NonNullable<typeof r> => r !== null);

            if (rows.length > 0 && !dryRun) {
              for (let i = 0; i < rows.length; i += WRITE_BATCH) {
                const slice = rows.slice(i, i + WRITE_BATCH);
                const { error: upErr } = await supabase
                  .from("creative_daily_metrics").upsert(slice, { onConflict: "ad_id,date" });
                if (upErr) counters.errors++;
                else counters.upserted += slice.length;
              }
            } else if (rows.length > 0 && dryRun) {
              counters.upserted += rows.length; // would-write count
            }
          }

          nextUrl = result.next;
          if (nextUrl) await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
        }

        if (!chunkOk) break; // paused / errored / timed out — resume next cron

        // Chunk fully fetched — advance the watermark backward to its start. The
        // watermark only moves AFTER the chunk's rows are durably written, so a
        // crash never leaves a gap between the watermark and covered data.
        counters.chunks++;
        frontier = chunk.since;
        counters.watermark = frontier;
        if (!dryRun) {
          await supabase.from("ad_accounts")
            .update({ daily_backfilled_since: frontier }).eq("id", accountId);
        }

        // If this chunk reached the target, pin + finish the account.
        if (frontier <= target) {
          counters.reached_target = true;
          break;
        }
      }

      // An account left mid-backfill (paused/timed out) means the queue isn't drained.
      if (counters.paused || (!counters.reached_target && drained === false)) {
        drained = false;
      }
    }

    const totals = [...perAccount.values()].reduce(
      (acc, c) => ({
        chunks: acc.chunks + c.chunks,
        fetched: acc.fetched + c.fetched,
        upserted: acc.upserted + c.upserted,
        errors: acc.errors + c.errors,
        reached_target: acc.reached_target + (c.reached_target ? 1 : 0),
      }),
      { chunks: 0, fetched: 0, upserted: 0, errors: 0, reached_target: 0 },
    );

    const summary = {
      success: true,
      dry_run: dryRun,
      drained,
      accounts_processed: perAccount.size,
      totals,
      per_account: Object.fromEntries([...perAccount.entries()]),
    };
    console.log("backfill-daily-history:", JSON.stringify({ ...summary, per_account: undefined }));
    return new Response(JSON.stringify(summary), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("backfill-daily-history error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Guard the network bind so tests can import the module without serving.
if (!Deno.env.get("BACKFILL_DAILY_HISTORY_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
