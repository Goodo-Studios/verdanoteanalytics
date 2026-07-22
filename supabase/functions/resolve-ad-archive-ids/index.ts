// =============================================================================
// resolve-ad-archive-ids — US-001B: resolve + store creatives.ad_archive_id
// =============================================================================
// Per-ad Apify capture (US-002/US-004) is keyed on the Meta Ad Library
// `ad_archive_id`, which we do NOT store — `creatives.ad_id` is the Ads-Manager id
// and there is no direct conversion (US-000 finding). This function fills that gap.
//
// STRATEGY (per account, per page):
//   1. FREE PATH — the official Meta Ad Library Graph API (`/vXX/ads_archive`) is
//      free. Sweep each of the account's pages by `search_page_ids`, page through
//      results, and match each returned ad back to our creatives. Whether this
//      returns anything for a COMMERCIAL page depends on transparency rules
//      (EU/UK/BR mandate commercial-ad disclosure; US surfaces political/issue
//      ads only), so coverage is recorded PER PAGE.
//   2. APIFY FALLBACK (only when explicitly allowed + budget remains) — for pages
//      the free path can't cover, run the `apify~facebook-ads-scraper` page-scrape
//      ONCE per page (US-000: uncappable per run, ~$2.30-3.44), harvest
//      {adArchiveID, snapshot}, match back the same way, and opportunistically
//      cache harvested media through the same content-hash storage path the drain
//      uses (media_assets capture_source='apify') so the spend does double duty.
//
// Matching + normalization live in ../_shared/ad-archive-match.ts (pure, tested).
//
// WRITES: matched creatives → ad_archive_id + ad_archive_id_resolved_at +
//   status='resolved'. After a page is fully swept, creatives on that page that
//   stayed unmatched become 'unresolvable' — but ONLY when the page was actually
//   attended to (free path returned ads for it, OR the Apify fallback ran for it).
//   Creatives on an uncovered page with no fallback are LEFT NULL (unattempted /
//   deferred), never falsely marked terminal.
//
// SECURITY: verify_jwt=false; gated by an exact `role === 'service_role'` claim on
// the bearer JWT (same deviation apify-spike documented — the runtime service key
// is an sb_secret_ value that can't be presented as a bearer, and the edge gateway
// only routes genuine project JWTs, so a forged token never arrives). Starts PAID
// Apify runs, so no anon/user JWT is ever admitted.
//
// CRON MODE (empty body): free-path only (NEVER spends), single-flight (DB claim),
// processes the next account with unresolved creatives, self-chains while accounts
// remain, inert when the queue is empty. Registered in a companion migration.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import {
  buildCreativeIndex,
  type CreativeForMatch,
  type MatchResult,
  matchAd,
  normalizeApifyItem,
  normalizeGraphAd,
} from "../_shared/ad-archive-match.ts";
import {
  APP_USAGE_PAUSE_THRESHOLD,
  assetStoragePath,
  computeContentHash,
  derivePageId,
  fetchAppUsage,
  isOverAppBudget,
  isStorageUrl,
  looksLikeHtml,
  META_API_VERSION,
} from "../_shared/media-discovery.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const APIFY_BASE = "https://api.apify.com/v2";
const APIFY_ACTOR_ID = "apify~facebook-ads-scraper";
const THUMB_BUCKET = "ad-thumbnails";

// Default reached-countries for the free Ad Library sweep. EU + UK + US maximizes
// commercial-ad coverage (EU/UK mandate commercial transparency; US is included
// for political/issue ads that some brands run). Overridable via body.countries.
const DEFAULT_COUNTRIES = [
  "US", "GB", "DE", "FR", "IT", "ES", "NL", "IE", "SE", "PL", "BE", "AT",
  "DK", "FI", "PT", "GR", "CZ", "RO", "HU",
];

const GRAPH_PAGE_SIZE = 100;      // Ad Library page size
const MAX_GRAPH_PAGES = 40;       // hard cap on paging per page-id (safety)
const META_CALL_SPACING_MS = 350; // app-wide Meta rate-limit spacing
const MAX_CHAIN = 20;             // cron self-chain depth bound (≥ #accounts)
const DEFAULT_FALLBACK_BUDGET = 15;
const APIFY_WALL_BUDGET_MS = 110_000; // per page-run poll ceiling inside one invocation
const APIFY_DATASET_LIMIT = 2000;

// Columns needed for matching + page derivation.
const CREATIVE_SELECT =
  "ad_id, account_id, ad_name, campaign_name, effective_object_story_id, meta_video_ids, meta_image_hashes, destination_key, ad_post_url";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// PostgREST caps a single response at db.max_rows (1000 on this project), which a
// client-side `.limit()` can shrink but NEVER raise. The queue holds tens of
// thousands of rows, so every full-queue read MUST page through with .range().
const PG_PAGE = 1000;

/** Page through the unresolved-creatives queue for an account (defeats max_rows). */
async function loadAllUnresolved(
  db: SupabaseClient,
  accountId: string,
): Promise<CreativeForMatch[]> {
  const out: CreativeForMatch[] = [];
  for (let from = 0; ; from += PG_PAGE) {
    const { data, error } = await db
      .from("creatives")
      .select(CREATIVE_SELECT)
      .eq("account_id", accountId)
      .is("ad_archive_id_status", null)
      .order("ad_id", { ascending: true })
      .range(from, from + PG_PAGE - 1);
    if (error) break;
    const batch = (data ?? []) as CreativeForMatch[];
    out.push(...batch);
    if (batch.length < PG_PAGE) break;
  }
  return out;
}

/** Extract the `role` claim from a JWT bearer without verifying the signature. */
function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded));
    return typeof decoded?.role === "string" ? decoded.role : null;
  } catch {
    return null;
  }
}

async function getMetaToken(db: SupabaseClient): Promise<string | null> {
  const env = Deno.env.get("META_ACCESS_TOKEN");
  if (env) return env;
  const { data } = await db.from("settings").select("value").eq("key", "meta_access_token").maybeSingle();
  return data?.value ?? null;
}

// ── Free path: one page-id sweep ─────────────────────────────────────────────

interface PageSweepResult {
  pageId: string;
  adsSeen: number;
  covered: boolean; // Graph API returned ≥1 ad for this page
  error: string | null;
}

/**
 * Sweep a single page's Ad Library via the free Graph API, matching each returned
 * ad back into `index`. Accumulates ad_id → ad_archive_id into `resolved` (first
 * writer wins per creative). Returns coverage + counts. Never throws.
 */
async function sweepPageFree(
  metaToken: string,
  pageId: string,
  countries: string[],
  index: ReturnType<typeof buildCreativeIndex>,
  resolved: Map<string, { archiveId: string; tier: string }>,
): Promise<PageSweepResult> {
  let after: string | null = null;
  let adsSeen = 0;
  const fields =
    "id,ad_snapshot_url,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_creative_link_descriptions,page_id,page_name";

  for (let page = 0; page < MAX_GRAPH_PAGES; page++) {
    // App-wide Meta rate-limit circuit breaker (fail-open when header missing).
    const usage = await fetchAppUsage(metaToken);
    if (isOverAppBudget(usage, APP_USAGE_PAUSE_THRESHOLD)) {
      return { pageId, adsSeen, covered: adsSeen > 0, error: "meta_app_usage_paused" };
    }

    const params = new URLSearchParams({
      access_token: metaToken,
      ad_type: "ALL",
      ad_reached_countries: JSON.stringify(countries),
      search_page_ids: pageId,
      fields,
      limit: String(GRAPH_PAGE_SIZE),
    });
    if (after) params.set("after", after);

    let data: Record<string, unknown>;
    try {
      const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/ads_archive?${params.toString()}`);
      data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // deno-lint-ignore no-explicit-any
        const msg = (data as any)?.error?.message ?? `http_${res.status}`;
        return { pageId, adsSeen, covered: adsSeen > 0, error: String(msg) };
      }
    } catch (e) {
      return { pageId, adsSeen, covered: adsSeen > 0, error: String((e as Error).message ?? e) };
    }

    // deno-lint-ignore no-explicit-any
    const items: any[] = (data as any)?.data ?? [];
    adsSeen += items.length;
    for (const raw of items) {
      const norm = normalizeGraphAd(raw);
      if (!norm) continue;
      const m = matchAd(norm, index);
      if (m) recordMatch(resolved, norm.adArchiveId, m);
    }

    // deno-lint-ignore no-explicit-any
    after = (data as any)?.paging?.cursors?.after ?? null;
    // deno-lint-ignore no-explicit-any
    const hasNext = !!(data as any)?.paging?.next;
    if (!after || !hasNext) break;
    await sleep(META_CALL_SPACING_MS);
  }

  return { pageId, adsSeen, covered: adsSeen > 0, error: null };
}

function recordMatch(
  resolved: Map<string, { archiveId: string; tier: string }>,
  archiveId: string,
  m: MatchResult,
): void {
  for (const adId of m.adIds) {
    // First writer wins: exact-anchor tiers run first and are highest confidence.
    if (!resolved.has(adId)) resolved.set(adId, { archiveId, tier: m.tier });
  }
}

// ── Apify fallback: one page-run ─────────────────────────────────────────────

interface FallbackResult {
  pageId: string;
  runId: string | null;
  status: string | null;
  itemsSeen: number;
  spendUsd: number;
  mediaCached: number;
  error: string | null;
}

/**
 * Run the Apify page-scrape ONCE for a page (US-000: page-sized, uncappable run),
 * poll to terminal (bounded by the edge wall budget), harvest items, match them
 * back, and opportunistically cache media. Records spend via add_apify_spend.
 */
async function fallbackPageHarvest(
  db: SupabaseClient,
  apifyToken: string,
  pageId: string,
  countries: string[],
  index: ReturnType<typeof buildCreativeIndex>,
  resolved: Map<string, { archiveId: string; tier: string }>,
  accountId: string,
): Promise<FallbackResult> {
  const out: FallbackResult = {
    pageId, runId: null, status: null, itemsSeen: 0, spendUsd: 0, mediaCached: 0, error: null,
  };
  try {
    // Page-scrape URL: view_all_page_id (whole advertiser page). US-000 confirmed
    // this harvests {adArchiveID, snapshot} for the whole page.
    const country = countries[0] ?? "US";
    const libUrl =
      `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${country}&view_all_page_id=${pageId}`;
    const input = { startUrls: [{ url: libUrl }] };

    const startRes = await fetch(
      `${APIFY_BASE}/acts/${APIFY_ACTOR_ID}/runs?token=${apifyToken}&memory=2048&timeout=180`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    );
    const startData = await startRes.json().catch(() => ({}));
    const runId: string | null = startData?.data?.id ?? null;
    out.runId = runId;
    if (!runId) {
      out.error = `start_failed_http_${startRes.status}`;
      return out;
    }

    // Poll to terminal, bounded by the wall budget (waitForFinish caps at 60s).
    const deadline = Date.now() + APIFY_WALL_BUDGET_MS;
    let status = "RUNNING";
    let usageUsd = 0;
    while (Date.now() < deadline) {
      const wff = Math.min(55, Math.max(1, Math.floor((deadline - Date.now()) / 1000)));
      const pr = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${apifyToken}&waitForFinish=${wff}`);
      const pd = await pr.json().catch(() => ({}));
      status = pd?.data?.status ?? status;
      usageUsd = Number(pd?.data?.usageTotalUsd ?? pd?.data?.usageUsd ?? usageUsd);
      if (status !== "RUNNING" && status !== "READY") break;
    }
    out.status = status;

    // Record actual spend (even if we timed out waiting: the run is charging).
    if (usageUsd > 0) {
      out.spendUsd = usageUsd;
      const day = new Date().toISOString().slice(0, 10);
      await db.rpc("add_apify_spend", { p_day: day, p_usd: usageUsd });
    }

    // Fetch dataset items (whatever exists so far) and match back.
    const dsRes = await fetch(
      `${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${apifyToken}&clean=true&limit=${APIFY_DATASET_LIMIT}`,
    );
    // deno-lint-ignore no-explicit-any
    const items: any[] = await dsRes.json().catch(() => []);
    out.itemsSeen = Array.isArray(items) ? items.length : 0;
    for (const raw of Array.isArray(items) ? items : []) {
      const norm = normalizeApifyItem(raw);
      if (!norm) continue;
      const m = matchAd(norm, index);
      if (m) {
        recordMatch(resolved, norm.adArchiveId, m);
        // Opportunistic media cache for matched ads (double-duty spend).
        const cached = await cacheApifyMedia(db, raw, accountId);
        out.mediaCached += cached;
      }
    }
    return out;
  } catch (e) {
    out.error = String((e as Error).message ?? e);
    return out;
  }
}

/**
 * Cache the primary image from an Apify item's snapshot into storage via the same
 * content-hash path the drain uses, tagged capture_source='apify'. Best-effort
 * (image only — videos are large/streamed by the drain); returns count cached.
 */
// deno-lint-ignore no-explicit-any
async function cacheApifyMedia(db: SupabaseClient, item: any, accountId: string): Promise<number> {
  try {
    const snap = item?.snapshot ?? {};
    const imgUrl: string | null =
      snap?.images?.[0]?.originalImageUrl ?? snap?.images?.[0]?.original_image_url ??
      snap?.images?.[0]?.resizedImageUrl ?? snap?.images?.[0]?.url ?? null;
    if (!imgUrl || isStorageUrl(imgUrl)) return 0;

    const res = await fetch(imgUrl);
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return 0; }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) { await res.body?.cancel().catch(() => {}); return 0; }
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (looksLikeHtml(bytes)) return 0;

    const assetKey = await computeContentHash(buf);
    const { data: existing } = await db
      .from("media_assets").select("id").eq("account_id", accountId).eq("asset_key", assetKey).maybeSingle();
    if (existing?.id) return 0; // already cached

    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const path = assetStoragePath(accountId, assetKey, ext);
    const { error: upErr } = await db.storage.from(THUMB_BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (upErr) return 0;
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${THUMB_BUCKET}/${path}`;
    await db.from("media_assets").upsert({
      account_id: accountId,
      asset_key: assetKey,
      media_type: "image",
      bucket: THUMB_BUCKET,
      storage_path: path,
      public_url: publicUrl,
      byte_size: bytes.byteLength,
      content_type: contentType,
      capture_source: "apify",
      updated_at: new Date().toISOString(),
    }, { onConflict: "account_id,asset_key" });
    return 1;
  } catch {
    return 0;
  }
}

// ── Per-account resolution ───────────────────────────────────────────────────

interface AccountOutcome {
  accountId: string;
  unresolvedBefore: number;
  pageIds: string[];
  freeCoveredPages: string[];
  resolvedCount: number;
  unresolvableCount: number;
  deferredCount: number;
  fallbackRuns: number;
  fallbackSpendUsd: number;
  mediaCached: number;
  tiers: Record<string, number>;
  notes: string[];
}

interface ResolveOpts {
  countries: string[];
  allowFallback: boolean;
  remainingBudget: number; // mutated by reference via return value
  dryRun: boolean;
}

async function resolveAccount(
  db: SupabaseClient,
  metaToken: string,
  apifyToken: string | null,
  accountId: string,
  opts: ResolveOpts,
): Promise<{ outcome: AccountOutcome; budgetSpent: number }> {
  const outcome: AccountOutcome = {
    accountId, unresolvedBefore: 0, pageIds: [], freeCoveredPages: [],
    resolvedCount: 0, unresolvableCount: 0, deferredCount: 0,
    fallbackRuns: 0, fallbackSpendUsd: 0, mediaCached: 0, tiers: {}, notes: [],
  };
  let budgetSpent = 0;

  // Load the queue (status IS NULL) for this account — paged (defeats max_rows).
  const creatives = await loadAllUnresolved(db, accountId);
  outcome.unresolvedBefore = creatives.length;
  if (!creatives.length) {
    outcome.notes.push("no unresolved creatives");
    return { outcome, budgetSpent };
  }

  // Group creatives by derived page id.
  const byPage = new Map<string, CreativeForMatch[]>();
  const noPage: CreativeForMatch[] = [];
  for (const c of creatives) {
    const pid = derivePageId({
      effective_object_story_id: c.effective_object_story_id ?? null,
      object_story_spec: null,
    });
    if (pid) {
      const arr = byPage.get(pid) ?? [];
      arr.push(c);
      byPage.set(pid, arr);
    } else {
      noPage.push(c);
    }
  }
  outcome.pageIds = [...byPage.keys()];
  if (noPage.length) outcome.notes.push(`${noPage.length} creatives have no derivable page id (left NULL)`);

  const index = buildCreativeIndex(creatives);
  const resolved = new Map<string, { archiveId: string; tier: string }>();

  // ── FREE PATH per page ──
  const covered = new Set<string>();
  for (const pid of byPage.keys()) {
    const r = await sweepPageFree(metaToken, pid, opts.countries, index, resolved);
    if (r.covered) covered.add(pid);
    if (r.error) outcome.notes.push(`page ${pid}: free path ${r.error} (${r.adsSeen} ads seen)`);
    await sleep(META_CALL_SPACING_MS);
  }
  outcome.freeCoveredPages = [...covered];

  // Determine which creatives are still unresolved after the free path.
  const stillUnresolved = (list: CreativeForMatch[]) => list.filter((c) => !resolved.has(c.ad_id));

  // ── APIFY FALLBACK for uncovered pages (budget-gated) ──
  const fallbackRanPages = new Set<string>();
  if (opts.allowFallback && apifyToken) {
    for (const pid of byPage.keys()) {
      if (covered.has(pid)) continue; // free path covered it
      if (stillUnresolved(byPage.get(pid)!).length === 0) continue; // nothing left
      if (opts.remainingBudget - budgetSpent <= 0) {
        outcome.notes.push(`page ${pid}: fallback DEFERRED (budget exhausted)`);
        continue;
      }
      const fb = await fallbackPageHarvest(db, apifyToken, pid, opts.countries, index, resolved, accountId);
      outcome.fallbackRuns += 1;
      outcome.fallbackSpendUsd += fb.spendUsd;
      outcome.mediaCached += fb.mediaCached;
      budgetSpent += fb.spendUsd;
      fallbackRanPages.add(pid);
      if (fb.error) outcome.notes.push(`page ${pid}: fallback ${fb.error} (run ${fb.runId})`);
      else outcome.notes.push(`page ${pid}: fallback ${fb.status}, ${fb.itemsSeen} items, $${fb.spendUsd.toFixed(4)}`);
    }
  }

  // ── WRITE resolutions ──
  // Group by archive id → adIds for batched updates.
  const byArchive = new Map<string, string[]>();
  for (const [adId, v] of resolved) {
    outcome.tiers[v.tier] = (outcome.tiers[v.tier] ?? 0) + 1;
    const arr = byArchive.get(v.archiveId) ?? [];
    arr.push(adId);
    byArchive.set(v.archiveId, arr);
  }
  const nowIso = new Date().toISOString();
  if (!opts.dryRun) {
    for (const [archiveId, adIds] of byArchive) {
      const { error } = await db.from("creatives")
        .update({ ad_archive_id: archiveId, ad_archive_id_resolved_at: nowIso, ad_archive_id_status: "resolved" })
        .in("ad_id", adIds);
      if (error) outcome.notes.push(`update resolved (${archiveId}) error: ${error.message}`);
    }
  }
  outcome.resolvedCount = resolved.size;

  // ── Mark UNRESOLVABLE only for creatives whose page was attended to ──
  // Attended = free path covered the page OR the fallback ran for the page.
  // Uncovered pages with no fallback are left NULL (deferred). No-page creatives
  // are always left NULL (can't be attempted).
  const unresolvableIds: string[] = [];
  let deferred = 0;
  for (const [pid, list] of byPage) {
    const attended = covered.has(pid) || fallbackRanPages.has(pid);
    for (const c of list) {
      if (resolved.has(c.ad_id)) continue;
      if (attended) unresolvableIds.push(c.ad_id);
      else deferred++;
    }
  }
  deferred += noPage.length;
  outcome.deferredCount = deferred;

  if (!opts.dryRun && unresolvableIds.length) {
    // Batch in chunks to keep the .in() list bounded (pooler-friendly).
    for (let i = 0; i < unresolvableIds.length; i += 500) {
      const chunk = unresolvableIds.slice(i, i + 500);
      const { error } = await db.from("creatives")
        .update({ ad_archive_id_status: "unresolvable", ad_archive_id_resolved_at: nowIso })
        .in("ad_id", chunk);
      if (error) outcome.notes.push(`update unresolvable error: ${error.message}`);
    }
  }
  outcome.unresolvableCount = unresolvableIds.length;

  return { outcome, budgetSpent };
}

/**
 * Accounts (ids) that still have unresolved creatives, ordered stably. Enumerates
 * accounts from ad_accounts, then keeps those with ≥1 NULL-status creative — a
 * bounded set of cheap head-counts, immune to the PostgREST max_rows cap that a
 * `select account_id` over the tens-of-thousands-row queue would hit.
 */
async function accountsWithQueue(db: SupabaseClient): Promise<string[]> {
  const { data: accts } = await db.from("ad_accounts").select("id").order("id", { ascending: true });
  const out: string[] = [];
  for (const a of (accts ?? []) as { id: string }[]) {
    if (!a.id) continue;
    const { count } = await db
      .from("creatives")
      .select("ad_id", { count: "exact", head: true })
      .eq("account_id", a.id)
      .is("ad_archive_id_status", null);
    if ((count ?? 0) > 0) out.push(a.id);
  }
  return out;
}

// ── HTTP entry ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Gate: service_role JWT only.
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (jwtRole(bearer) !== "service_role") return json({ error: "Forbidden" }, 403);

  const db = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action ?? "resolve");
  const chainDepth = Number(body.chain ?? url.searchParams.get("chain") ?? 0);
  const isCronPoke = chainDepth === 0 && !body.account_id && action !== "validate";

  const metaToken = await getMetaToken(db);
  if (!metaToken) return json({ error: "No Meta access token configured" }, 400);

  const countries: string[] = Array.isArray(body.countries) && body.countries.length
    ? (body.countries as string[]) : DEFAULT_COUNTRIES;

  // ── SINGLE-FLIGHT for cron pokes (chain=0, empty body). Self-chain continuations
  //    (chain>0) ARE the running flight and skip the claim. ──
  let claimedLock = false;
  if (isCronPoke) {
    const { data: got } = await db.rpc("claim_resolver_singleflight", { p_stale_seconds: 900 });
    if (got !== true) return json({ ok: true, status: "skipped", reason: "singleflight-active" });
    claimedLock = true;
  }

  try {
    // ── VALIDATE: free-path coverage probe, no writes ──
    if (action === "validate") {
      const target = body.account_id && body.account_id !== "all" ? [String(body.account_id)] : await accountsWithQueue(db);
      const report: unknown[] = [];
      for (const accountId of target) {
        const creatives = await loadAllUnresolved(db, accountId);
        const pages = new Set<string>();
        for (const c of creatives) {
          const pid = derivePageId({ effective_object_story_id: c.effective_object_story_id ?? null, object_story_spec: null });
          if (pid) pages.add(pid);
        }
        const index = buildCreativeIndex(creatives);
        const perPage: unknown[] = [];
        for (const pid of pages) {
          const resolved = new Map<string, { archiveId: string; tier: string }>();
          const r = await sweepPageFree(metaToken, pid, countries, index, resolved);
          perPage.push({ page_id: pid, ads_seen: r.adsSeen, covered: r.covered, matched: resolved.size, error: r.error });
          await sleep(META_CALL_SPACING_MS);
        }
        report.push({ account_id: accountId, unresolved: creatives.length, pages: [...pages], per_page: perPage });
      }
      return json({ ok: true, action: "validate", countries, accounts: report });
    }

    // ── RESOLVE ──
    const allowFallback = body.allow_fallback === true && !isCronPoke; // cron never spends
    const fallbackBudget = Number(body.fallback_budget_usd ?? DEFAULT_FALLBACK_BUDGET);
    const dryRun = body.dry_run === true;
    const apifyToken = Deno.env.get("APIFY_TOKEN") ?? null;

    // Target accounts: explicit, or (cron/self-chain) the next account with a queue.
    let targets: string[];
    if (body.account_id && body.account_id !== "all") {
      targets = [String(body.account_id)];
    } else {
      const queued = await accountsWithQueue(db);
      if (queued.length === 0) {
        return json({ ok: true, no_work: true, reason: "no account with unresolved creatives" });
      }
      // Cron/self-chain: process ONE account per invocation, then chain.
      targets = isCronPoke || chainDepth > 0 ? [queued[0]] : queued;
    }

    let remainingBudget = fallbackBudget;
    const outcomes: AccountOutcome[] = [];
    for (const accountId of targets) {
      const { outcome, budgetSpent } = await resolveAccount(db, metaToken, apifyToken, accountId, {
        countries, allowFallback, remainingBudget, dryRun,
      });
      remainingBudget = Math.max(0, remainingBudget - budgetSpent);
      outcomes.push(outcome);
    }

    // Self-chain (cron path only): if accounts remain, fire a fresh invocation.
    let chained = false;
    if ((isCronPoke || chainDepth > 0) && chainDepth < MAX_CHAIN) {
      const remaining = await accountsWithQueue(db);
      if (remaining.length > 0) {
        chained = true;
        fetch(`${SUPABASE_URL}/functions/v1/resolve-ad-archive-ids?chain=${chainDepth + 1}`, {
          method: "POST",
          headers: { Authorization: req.headers.get("authorization") ?? "", "Content-Type": "application/json" },
          body: JSON.stringify({ chain: chainDepth + 1 }),
        }).catch((e: Error) => console.error("resolve self-chain error:", e.message));
      }
    }

    const totalResolved = outcomes.reduce((a, o) => a + o.resolvedCount, 0);
    const totalUnresolvable = outcomes.reduce((a, o) => a + o.unresolvableCount, 0);
    const totalDeferred = outcomes.reduce((a, o) => a + o.deferredCount, 0);
    const totalSpend = outcomes.reduce((a, o) => a + o.fallbackSpendUsd, 0);

    return json({
      ok: true, action: "resolve", chain_depth: chainDepth, chained,
      allow_fallback: allowFallback, budget_remaining: remainingBudget,
      totals: { resolved: totalResolved, unresolvable: totalUnresolvable, deferred: totalDeferred, fallback_spend_usd: totalSpend },
      accounts: outcomes,
    });
  } finally {
    if (claimedLock) {
      try { await db.rpc("release_resolver_singleflight"); } catch { /* best effort */ }
    }
  }
});
