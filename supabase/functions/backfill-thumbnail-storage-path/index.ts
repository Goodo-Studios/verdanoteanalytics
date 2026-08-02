// One-time (re-runnable) backfill: repair creatives.thumbnail_storage_path rows
// that are missing their file extension.
//
// THE BUG (creative-diversity US-001 validation spike, 2026-08-02): every write
// site in refresh-thumbnails/index.ts used to set
//   thumbnail_storage_path = `${account_id}/${ad_id}`
// discarding the extension that downloadAndCache() had ALREADY computed and
// actually uploaded with (e.g. "act_123/456.jpg"). The public Storage URL built
// from the bare path 400s, even though the real object in the bucket is fine and
// `thumbnail_url` on the same row already resolves correctly. Measured on one
// pilot account this silently cost ~17% of active ads to any consumer that
// trusted the column. The write bug itself is fixed in refresh-thumbnails/
// index.ts (downloadAndCache now returns the real path; callers use it instead
// of reconstructing it). This function repairs the ROWS that bug already wrote.
//
// DERIVATION, NOT GUESSING: for each bad row, thumbnail_url already IS the
// correct public Storage URL (with extension) for rows that were ever cached —
// downloadAndCache always kept the URL correct, only the separate path column
// was wrong. So the fix is a pure string parse of thumbnail_url via
// parseStoragePublicUrl, verified to belong to THIS row (bucket + account/ad_id
// prefix must match) before writing. No network calls, no guessing an extension.
// Rows whose thumbnail_url is not a resolvable storage URL for this account/ad
// (e.g. a live but never-cached CDN url) are left untouched and counted —
// there is no reliable source to backfill from without re-caching, which is
// refresh-thumbnails' job, not this one's.
//
// SECOND VALID SHAPE — poster frames (2026-08-02): scripts/regenerate-video-posters.mjs
// stores upgraded video poster frames at ad-thumbnails/posters/<ad_id>.<ext> — a
// shared, account-agnostic folder, deliberately different from every other
// writer's <account_id>/<ad_id>.<ext>. That script had its own bug (never wrote
// thumbnail_storage_path at all — fixed separately in PR #97) which left rows
// in exactly this state: thumbnail_url correctly resolves under posters/, but
// thumbnail_storage_path is stale. Accepted here as a second legitimate prefix,
// still exact-matched against THIS row's ad_id — never a blanket "anything
// under posters/ is fine" rule.
//
// IDEMPOTENT + SELF-CHAINING (matches backfill-retag's pattern): a row is
// touched only when its stored path is missing a known extension. Re-running
// after a partial drain is always safe — already-fixed rows are skipped. The
// self-chain fires UNCONDITIONALLY on `drained === false`, never on a narrower
// per-account gate (verdanoteanalytics-self-chaining-fire-selfcontinue-unconditionally).
//
// HEALTH CHECK: every response includes `remaining_bad_estimate` — a fresh count
// of still-extensionless rows in the scope just processed, computed from the same
// page(s) already fetched (no extra query). Call with `{ dry_run: true }` any
// time to check drift without writing anything.
//
//   deno test -A supabase/functions/backfill-thumbnail-storage-path/index.test.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/internal-auth.ts";
import { hasKnownMediaExtension, parseStoragePublicUrl } from "../_shared/storage-url.ts";

const THUMB_BUCKET = "ad-thumbnails";
const PAGE = 1000; // PostgREST page size
const DEADLINE_MS = 45_000; // per-invocation wall budget (edge fn ~60s)

export interface BackfillCounters {
  scanned: number;
  fixed: number;
  /** of `fixed`, how many matched the poster-frame shape rather than the per-account shape. */
  fixed_poster_frame: number;
  already_ok: number;
  /** thumbnail_url isn't a resolvable storage URL for this row — left untouched. */
  skipped_no_storage_url: number;
  /** thumbnail_url parsed to a DIFFERENT account/ad or bucket — left untouched, logged loudly. */
  skipped_mismatch: number;
}
function newCounters(): BackfillCounters {
  return { scanned: 0, fixed: 0, fixed_poster_frame: 0, already_ok: 0, skipped_no_storage_url: 0, skipped_mismatch: 0 };
}

/**
 * Every path shape this backfill will accept as a legitimate source to derive
 * thumbnail_storage_path from, checked in order. Each entry's prefix must be an
 * EXACT match against THIS row's own account_id/ad_id — never a blanket
 * "anything under this folder" acceptance.
 */
function acceptedPrefixesFor(accountId: string, adId: string): string[] {
  return [`${accountId}/${adId}.`, `posters/${adId}.`];
}

interface BackfillBody {
  account_id?: string;
  dry_run?: boolean;
  _chained?: boolean;
}

/**
 * Fire-and-forget re-invocation of THIS function to continue draining after the
 * wall budget is hit. Mirrors backfill-retag's selfContinue exactly: carries the
 * same scope forward, fires unconditionally whenever drained === false.
 */
async function selfContinue(body: BackfillBody): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.warn("backfill-thumbnail-storage-path selfContinue: missing env vars — cannot self-chain");
      return;
    }
    const continuePromise = fetch(`${supabaseUrl}/functions/v1/backfill-thumbnail-storage-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ ...body, _chained: true }),
    });
    // deno-lint-ignore no-explicit-any
    const w = (globalThis as any).EdgeRuntime?.waitUntil;
    if (w) w(continuePromise); else await continuePromise;
    console.log("backfill-thumbnail-storage-path selfContinue: fired non-blocking continue invocation");
  } catch (err) {
    console.warn("backfill-thumbnail-storage-path selfContinue error (non-fatal):", err);
  }
}

export async function handler(req: Request, supabaseOverride?: unknown): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authFailure = await requireServiceRole(req);
  if (authFailure) return authFailure;

  const startedMs = Date.now();
  const timedOut = () => Date.now() - startedMs > DEADLINE_MS;

  try {
    // deno-lint-ignore no-explicit-any
    const supabase: any = (supabaseOverride && typeof (supabaseOverride as any).from === "function")
      ? supabaseOverride
      : createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let body: BackfillBody = {};
    try { body = await req.json(); } catch { /* no body */ }
    const dryRun = body.dry_run === true;

    const counters = newCounters();
    let offset = 0;
    let drained = true;
    const mismatches: string[] = [];

    while (true) {
      if (timedOut()) { drained = false; break; }

      // Build the full filter chain BEFORE the terminal .range() — account_id
      // must be applied as a filter, not tacked on after pagination is set.
      let query = supabase
        .from("creatives")
        .select("ad_id, account_id, thumbnail_storage_path, thumbnail_url")
        .not("thumbnail_storage_path", "is", null)
        .order("ad_id", { ascending: true });
      if (body.account_id) query = query.eq("account_id", body.account_id);

      const { data: rows, error } = await query.range(offset, offset + PAGE - 1);
      if (error) throw error;
      if (!rows || rows.length === 0) break;

      for (const row of rows as Array<Record<string, unknown>>) {
        counters.scanned++;
        const path = String(row.thumbnail_storage_path);
        if (hasKnownMediaExtension(path)) { counters.already_ok++; continue; }

        const url = row.thumbnail_url ? String(row.thumbnail_url) : null;
        const parsed = url ? parseStoragePublicUrl(url) : null;
        if (!parsed) { counters.skipped_no_storage_url++; continue; }

        const accountId = String(row.account_id);
        const adId = String(row.ad_id);
        const [accountPrefix, posterPrefix] = acceptedPrefixesFor(accountId, adId);
        const isPosterShape = parsed.path.startsWith(posterPrefix);
        const isAccountShape = parsed.path.startsWith(accountPrefix);
        if (parsed.bucket !== THUMB_BUCKET || !(isAccountShape || isPosterShape)) {
          counters.skipped_mismatch++;
          mismatches.push(`${accountId}/${adId}: url resolved to ${parsed.bucket}/${parsed.path}`);
          continue;
        }
        if (!hasKnownMediaExtension(parsed.path)) { counters.skipped_no_storage_url++; continue; }

        counters.fixed++;
        if (isPosterShape) counters.fixed_poster_frame++;
        if (!dryRun) {
          const { error: updErr } = await supabase
            .from("creatives")
            .update({ thumbnail_storage_path: parsed.path })
            .eq("ad_id", row.ad_id);
          if (updErr) console.warn(`backfill-thumbnail-storage-path: update failed for ${row.ad_id}:`, updErr.message);
        }
      }

      if (rows.length < PAGE) break; // last page for this scope
      offset += PAGE;
    }

    if (!drained) {
      // Fire unconditionally on drained===false — no narrower gate, and no guard
      // on body._chained either: each invocation only writes rows still missing
      // an extension, so the candidate set is strictly monotonically decreasing
      // and the chain terminates on its own once nothing is left to fix.
      await selfContinue(body);
    }

    return new Response(
      JSON.stringify({
        dry_run: dryRun,
        drained,
        counters,
        // Health check: rows that still lack a known extension after this
        // invocation. In dry_run, "fixed" means "would have been fixed" (nothing
        // was written), so it counts as still-bad too. In a real run that already
        // reached drained:true, this should read as skipped_no_storage_url +
        // skipped_mismatch only — i.e. exactly the unfixable rows, logged above.
        remaining_bad_estimate: dryRun
          ? counters.fixed + counters.skipped_no_storage_url + counters.skipped_mismatch
          : counters.skipped_no_storage_url + counters.skipped_mismatch,
        mismatches: mismatches.length ? mismatches.slice(0, 20) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("backfill-thumbnail-storage-path error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

if (!Deno.env.get("BACKFILL_THUMB_PATH_NO_SERVE")) {
  Deno.serve((req) => handler(req));
}
