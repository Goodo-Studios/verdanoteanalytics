// US-003: One-time backfill of frame-retention curves for historical video creatives.
//
// US-002 wired `video_play_curve_actions` into the forward `sync` path, so every
// NEW sync now persists `play_curve` + `retention_p25/50/75/100`. This function
// closes the gap for creatives that were ingested BEFORE that change shipped: it
// re-pulls `video_play_curve_actions` from the Meta Graph API for video creatives
// that delivered in the last 90 days, across ALL connected accounts, and writes
// the derived curve through the same `bulk_update_creative_metrics` RPC the sync
// uses (US-001's persistence path).
//
// PARSE REUSE: extraction + normalization + quartile derivation is the canonical
// `parsePlayCurve` (../_shared/play-curve.ts, US-002). It is IMPORTED, never
// re-implemented here — there is exactly one curve parser in the codebase.
//
// IDEMPOTENT + CHEAP RE-RUNS: the row gate selects only video creatives
//   video_views > 0 AND play_curve IS NULL AND updated_at >= now()-90d
// — i.e. delivered-recently rows that have not yet been backfilled. A row leaves
// the gate the instant a non-null curve is written, so a re-run only touches what
// is still missing. Non-video / curve-less rows yield a null curve from the
// parser and are skipped (NEVER written), so they re-cost a Graph read but never
// thrash the table; they fall out of the gate naturally once their account is
// fully drained or they age past 90 days.
//
// PACED + RESUMABLE: a per-invocation wall budget (DEADLINE_MS) bounds work and
// the response carries { drained }. A caller re-invokes until drained === true.
// Accounts are processed in order; an account only counts as touched once its
// gate set is fetched, so resuming re-scans cheaply (the gate already excludes
// everything written on prior runs — no cursor state to persist).
//
// RATE-LIMIT BACKOFF: Meta's app-wide throttle (Graph error #4, plus the other
// throttle codes the sync recognizes) triggers interruptible exponential backoff
// (30s/60s/120s/240s/300s, capped 5 min). The wait is checked against the budget
// each second so a backoff can never overrun the wall clock; if the budget is hit
// mid-backoff the account is left for the next invocation ({ drained:false }).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { parsePlayCurve } from "../_shared/play-curve.ts";

const META_API_VERSION = "v22.0";

// Lookback window: video creatives that delivered in the last 90 days.
export const LOOKBACK_DAYS = 90;

// Per-invocation wall budget (edge fn hard wall ~60s here; leave margin to flush
// the final RPC + serialize the response).
export const DEADLINE_MS = 50_000;

// Graph insights page size (ads per page) and DB write batch size.
export const META_PAGE = 200;
export const WRITE_BATCH = 500;

// Max consecutive rate-limit backoffs before giving up on the current URL.
export const MAX_RATE_LIMIT_RETRIES = 5;

// Only `ad_id` + the curve field are needed — keep the insights payload minimal.
export const INSIGHTS_FIELDS = "ad_id,video_play_curve_actions";

/**
 * App-wide / throttle error detection — mirrors the sync function's `metaFetch`
 * exactly so the two paths agree on what "rate limited" means. Graph error #4 is
 * the app-level rate limit; the rest are user/page throttles and the textual
 * fallbacks Meta sometimes returns without a numeric code.
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

/**
 * Exponential backoff in ms for the Nth (1-based) rate-limit retry:
 * 30s, 60s, 120s, 240s, 300s — capped at 5 minutes. Matches the sync formula.
 */
export function backoffMs(retry: number): number {
  return Math.min(300, 30 * Math.pow(2, Math.max(0, retry - 1))) * 1000;
}

/** ISO date (YYYY-MM-DD) `days` before `now`, for the Graph `time_range.since`. */
export function sinceDate(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().split("T")[0];
}

/** ISO timestamp `days` before `now`, for the `updated_at` row gate. */
export function lookbackTimestamp(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Build the Graph insights URL for one account over the lookback window. Pulls
 * `ad_id,video_play_curve_actions` at ad level; `limit` paginates via paging.next.
 */
export function insightsUrl(accountId: string, now: Date, metaToken: string): string {
  const timeRange = JSON.stringify({
    since: sinceDate(now, LOOKBACK_DAYS),
    until: now.toISOString().split("T")[0],
  });
  return (
    `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights?` +
    `time_range=${encodeURIComponent(timeRange)}&level=ad` +
    `&fields=${INSIGHTS_FIELDS}` +
    `&limit=${META_PAGE}&access_token=${encodeURIComponent(metaToken)}`
  );
}

/**
 * Map raw Graph insights rows -> bulk_update_creative_metrics payload rows.
 *
 * Each row is run through the canonical `parsePlayCurve`. Rows whose curve comes
 * back null (non-video, missing/empty/malformed `video_play_curve_actions`) are
 * DROPPED — we never write a null curve (that would re-cost the row on every run
 * and, worse, COALESCE-overwrite nothing while still counting as work). Only rows
 * that actually yielded a curve are returned, and only for ad_ids in `gateIds`
 * (the NULL-play_curve gate), so Graph rows for already-backfilled ads are ignored.
 */
// deno-lint-ignore no-explicit-any
export function buildMetricsPayload(rows: any[], gateIds: Set<string>): Array<{
  ad_id: string;
  play_curve: number[];
  retention_p25: number | null;
  retention_p50: number | null;
  retention_p75: number | null;
  retention_p100: number | null;
}> {
  const out: Array<{
    ad_id: string;
    play_curve: number[];
    retention_p25: number | null;
    retention_p50: number | null;
    retention_p75: number | null;
    retention_p100: number | null;
  }> = [];
  for (const row of rows || []) {
    const adId = row?.ad_id;
    if (!adId || !gateIds.has(adId)) continue;
    const parsed = parsePlayCurve(row.video_play_curve_actions);
    if (parsed.play_curve === null) continue; // never write a null curve
    out.push({
      ad_id: adId,
      play_curve: parsed.play_curve,
      retention_p25: parsed.retention_p25,
      retention_p50: parsed.retention_p50,
      retention_p75: parsed.retention_p75,
      retention_p100: parsed.retention_p100,
    });
  }
  return out;
}

interface Counters {
  gated: number; // rows in the NULL-play_curve gate for this account
  fetched: number; // Graph rows returned
  updated: number; // rows written with a real curve
  no_curve: number; // gated rows Graph returned but with no usable curve
  errors: number;
}
function newCounters(): Counters {
  return { gated: 0, fetched: 0, updated: 0, no_curve: 0, errors: 0 };
}

// deno-lint-ignore no-explicit-any
interface MetaFetchResult { data: any[] | null; next: string | null; error: any | null; rateLimited: boolean; }
// deno-lint-ignore no-explicit-any
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
 * @param req               the inbound request ({ account_id?, dry_run? } body)
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

  // Only treat the override as a client if it looks like one (serve() passes
  // connInfo as the second arg — it must never shadow the real client).
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

    // Resolve accounts: explicit account_id, else every active account.
    let accountIds: string[];
    if (body.account_id) {
      accountIds = [body.account_id];
    } else {
      const { data: accounts, error } = await supabase
        .from("ad_accounts").select("id").eq("is_active", true);
      if (error) throw error;
      // deno-lint-ignore no-explicit-any
      accountIds = (accounts || []).map((a: any) => a.id);
    }

    const lookbackTs = lookbackTimestamp(now, LOOKBACK_DAYS);
    const perAccount = new Map<string, Counters>();
    let drained = true; // false if the budget cut work short

    for (const accountId of accountIds) {
      if (timedOut()) { drained = false; break; }

      const counters = newCounters();
      perAccount.set(accountId, counters);

      // ── Gate set: video creatives, recently delivered, NOT yet backfilled.
      // Page the gate so a huge account doesn't blow memory; the gate shrinks
      // every run because written rows leave it (play_curve IS NULL → NOT NULL).
      const gateIds = new Set<string>();
      let offset = 0;
      let gateDrained = true;
      // deno-lint-ignore no-constant-condition
      while (true) {
        if (timedOut()) { drained = false; gateDrained = false; break; }
        const { data: rows, error: gateErr } = await supabase
          .from("creatives")
          .select("ad_id")
          .eq("account_id", accountId)
          .is("play_curve", null)
          .gt("video_views", 0)
          .gte("updated_at", lookbackTs)
          .order("ad_id", { ascending: true })
          .range(offset, offset + WRITE_BATCH - 1);
        if (gateErr) throw gateErr;
        const batch = rows || [];
        // deno-lint-ignore no-explicit-any
        for (const r of batch) gateIds.add((r as any).ad_id);
        if (batch.length < WRITE_BATCH) break;
        offset += WRITE_BATCH;
      }
      counters.gated = gateIds.size;
      if (gateIds.size === 0) continue; // nothing missing for this account

      // ── Re-pull the curve from Meta over the lookback window, page by page,
      // writing only the gated rows that come back with a usable curve.
      let nextUrl: string | null = insightsUrl(accountId, now, metaToken);
      let rateLimitRetries = 0;
      let accountDrained = gateDrained;

      while (nextUrl) {
        if (timedOut()) { drained = false; accountDrained = false; break; }

        const result = await metaFetch(nextUrl);

        if (result.error) {
          if (result.rateLimited && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
            rateLimitRetries++;
            // Interruptible backoff: re-check the wall budget every second so a
            // long backoff cannot overrun the invocation (resume next run).
            const waitUntil = Date.now() + backoffMs(rateLimitRetries);
            let bailed = false;
            while (Date.now() < waitUntil) {
              await new Promise((r) => setTimeout(r, 1000));
              if (timedOut()) { drained = false; accountDrained = false; bailed = true; break; }
            }
            if (bailed) break;
            continue; // same URL, post-backoff
          }
          // Non-retriable (or retries exhausted): record + stop this account.
          counters.errors++;
          accountDrained = false;
          break;
        }
        rateLimitRetries = 0; // reset after any clean page

        const pageRows = result.data || [];
        counters.fetched += pageRows.length;

        const payload = buildMetricsPayload(pageRows, gateIds);
        // Rows Graph returned that were gated but produced no usable curve.
        const gatedReturned = pageRows.filter(
          // deno-lint-ignore no-explicit-any
          (r: any) => r?.ad_id && gateIds.has(r.ad_id),
        ).length;
        counters.no_curve += gatedReturned - payload.length;

        if (payload.length > 0 && !dryRun) {
          for (let i = 0; i < payload.length; i += WRITE_BATCH) {
            const chunk = payload.slice(i, i + WRITE_BATCH);
            const { error: rpcErr } = await supabase
              .rpc("bulk_update_creative_metrics", { payload: chunk });
            if (rpcErr) counters.errors += chunk.length;
            else counters.updated += chunk.length;
            if (timedOut()) { drained = false; accountDrained = false; break; }
          }
        } else if (dryRun) {
          counters.updated += payload.length; // would-update count
        }

        nextUrl = result.next;
      }

      if (!accountDrained) { drained = false; }
    }

    const totals = [...perAccount.values()].reduce(
      (acc, c) => ({
        gated: acc.gated + c.gated,
        fetched: acc.fetched + c.fetched,
        updated: acc.updated + c.updated,
        no_curve: acc.no_curve + c.no_curve,
        errors: acc.errors + c.errors,
      }),
      newCounters(),
    );

    const summary = {
      success: true,
      dry_run: dryRun,
      drained,
      accounts_processed: perAccount.size,
      totals,
      per_account: Object.fromEntries([...perAccount.entries()]),
    };
    console.log("backfill-play-curves:", JSON.stringify({ ...summary, per_account: undefined }));
    return new Response(JSON.stringify(summary), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("backfill-play-curves error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Guard the network bind so tests can import the module without serving.
if (!Deno.env.get("BACKFILL_PLAY_CURVES_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
