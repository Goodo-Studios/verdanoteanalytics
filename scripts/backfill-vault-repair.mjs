#!/usr/bin/env node
// Targeted vault repair — one-off backfill for two shipped bugs.
//
//   Part A — un-poison image ads wrongly tagged as video.
//     The old extractPreviewVideoSrc matched fbcdn IMAGE urls (bare "/v/"), so
//     cache-creative-image wrote an image URL into creatives.video_url. Those ads
//     then behaved like videos. This resets any creatives.video_url that is not
//     recognizably a video to the 'no-video' sentinel (image-only), matching what
//     the fixed matcher now produces.
//
//   Part B — unstick items pinned at status='analyzing'.
//     The old ItemDetailPage re-analyze wrote status='analyzing' AFTER awaiting
//     vault-analyze (which had already written the terminal status), pinning items
//     forever. This re-invokes vault-analyze server-side for each stuck item so it
//     runs to a real terminal status ('ready'/'error').
//
// SAFETY: dry-run by default. Pass --execute to mutate. Reads credentials from the
// environment only (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) — never hard-coded.
//
//   Dry run:   node scripts/backfill-vault-repair.mjs
//   Execute:   node scripts/backfill-vault-repair.mjs --execute
//   One part:  ... --only=A   |   --only=B
//
// Run this AFTER the fixed edge functions are deployed (scripts/deploy-functions.sh)
// so future saves don't re-introduce the poison Part A cleans up.

import { createClient } from "@supabase/supabase-js";

const EXECUTE = process.argv.includes("--execute");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "AB";
const PAGE = 1000;

// Accept the HQ vault names (VERDANOTE_NEW_*) as fallbacks so `hq secrets exec`
// can inject them directly without renaming.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VERDANOTE_NEW_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const SENTINELS = new Set(["no-video", "no-thumbnail"]);

/** Recognizably a real video source (storage mp4/webm, .mp4/.webm asset, or Meta
 *  video CDN host). Mirrors the fixed extractPreviewVideoSrc signal set. */
function looksLikeVideoUrl(u) {
  if (typeof u !== "string" || !u) return false;
  if (u.includes("/storage/v1/object/public/ad-videos/")) return true;
  if (u.includes(".mp4") || u.includes(".webm")) return true;
  if (/:\/\/video[.-][^/]*\.fbcdn\.net/i.test(u)) return true;
  return false;
}

/** A video_url that is set, not a sentinel, and NOT recognizably a video — i.e. an
 *  image/page URL wrongly stored as video by the old matcher. */
function isPoisonedVideoUrl(u) {
  if (typeof u !== "string" || !u.trim()) return false;
  if (SENTINELS.has(u.trim())) return false;
  return !looksLikeVideoUrl(u);
}

async function fetchAll(table, columns, applyFilter) {
  const rows = [];
  let from = 0;
  for (;;) {
    let q = db.from(table).select(columns).range(from, from + PAGE - 1);
    q = applyFilter ? applyFilter(q) : q;
    const { data, error } = await q;
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function partA() {
  console.log("\n=== Part A — un-poison image ads tagged as video ===");
  // Coarse pull: any non-null, non-sentinel video_url. Precise classification in JS.
  const candidates = await fetchAll(
    "creatives",
    "ad_id, account_id, video_url",
    (q) => q.not("video_url", "is", null).not("video_url", "in", "(no-video,no-thumbnail)"),
  );
  const poisoned = candidates.filter((c) => isPoisonedVideoUrl(c.video_url));
  console.log(`  creatives with a video_url: ${candidates.length}`);
  if (!EXECUTE) {
    // Breakdown so "0 poisoned" is trustworthy — confirm every value is a real video signal.
    const b = { storage: 0, mp4_webm: 0, videoHost: 0, other: 0 };
    for (const c of candidates) {
      const u = c.video_url;
      if (typeof u === "string" && u.includes("/storage/v1/object/public/ad-videos/")) b.storage++;
      else if (typeof u === "string" && (u.includes(".mp4") || u.includes(".webm"))) b.mp4_webm++;
      else if (typeof u === "string" && /:\/\/video[.-][^/]*\.fbcdn\.net/i.test(u)) b.videoHost++;
      else b.other++;
    }
    console.log(`  breakdown: storage=${b.storage} mp4/webm=${b.mp4_webm} videoHost=${b.videoHost} other=${b.other}`);
    console.log("  sample video_url values:");
    candidates.slice(0, 6).forEach((c) => console.log(`    - ${String(c.video_url).slice(0, 90)}`));
  }
  console.log(`  poisoned (image/page URL stored as video): ${poisoned.length}`);
  poisoned.slice(0, 10).forEach((c) => console.log(`    - ${c.ad_id}: ${String(c.video_url).slice(0, 100)}`));
  if (poisoned.length > 10) console.log(`    … and ${poisoned.length - 10} more`);

  if (!EXECUTE) {
    console.log("  DRY RUN — would reset the above video_url values to 'no-video'.");
    return { found: poisoned.length, fixed: 0 };
  }
  let fixed = 0;
  for (const c of poisoned) {
    const { error } = await db
      .from("creatives")
      .update({ video_url: "no-video" })
      .eq("ad_id", c.ad_id)
      .eq("account_id", c.account_id);
    if (error) console.error(`    ! ${c.ad_id}: ${error.message}`);
    else fixed++;
  }
  console.log(`  reset ${fixed}/${poisoned.length} to 'no-video'.`);
  return { found: poisoned.length, fixed };
}

async function partB() {
  console.log("\n=== Part B — unstick items pinned at status='analyzing' ===");
  const stuck = await fetchAll(
    "inspiration_items",
    "id, status, created_at",
    (q) => q.eq("status", "analyzing"),
  );
  console.log(`  items stuck at 'analyzing': ${stuck.length}`);
  stuck.slice(0, 10).forEach((i) => console.log(`    - ${i.id} (since ${i.created_at})`));
  if (stuck.length > 10) console.log(`    … and ${stuck.length - 10} more`);

  if (!EXECUTE) {
    console.log("  DRY RUN — would re-invoke vault-analyze for each so it reaches a real terminal status.");
    return { found: stuck.length, fixed: 0 };
  }
  let fixed = 0;
  for (const it of stuck) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/vault-analyze`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: it.id }),
      });
      if (res.ok) fixed++;
      else console.error(`    ! ${it.id}: vault-analyze ${res.status} ${(await res.text()).slice(0, 120)}`);
    } catch (e) {
      console.error(`    ! ${it.id}: ${e.message}`);
    }
  }
  console.log(`  re-analyzed ${fixed}/${stuck.length}.`);
  return { found: stuck.length, fixed };
}

console.log(`Vault repair — ${EXECUTE ? "EXECUTE (will mutate)" : "DRY RUN"} — parts: ${ONLY}`);
const results = {};
if (ONLY.includes("A")) results.A = await partA();
if (ONLY.includes("B")) results.B = await partB();
console.log("\n=== Summary ===");
console.log(JSON.stringify(results, null, 2));
if (!EXECUTE) console.log("\nRe-run with --execute to apply.");
