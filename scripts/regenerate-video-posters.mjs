#!/usr/bin/env node
// Regenerate crisp poster images for captured-video creatives.
//
// WHY: the free preview-capture route stores whatever poster the ad-preview
// iframe exposes — often Meta's tiny (e.g. 64x64) thumbnail, upscaled onto a
// 1080 canvas so it reports "HD" but renders soft. Meanwhile the captured video
// itself is 360–720p. This script extracts a real frame from the captured video
// (native resolution, high JPEG quality) and uses it as the poster — but ONLY
// when it beats the current poster's resolution, so an already-crisp thumbnail is
// never downgraded.
//
// Frame extraction needs a video decoder (ffmpeg), which the Supabase edge
// runtime can't run — hence a local/worker script rather than an edge function.
// Idempotent + re-runnable: once a creative's poster is the regenerated frame,
// its short side is >= the video's, so it's skipped on the next run.
//
// ENV (required): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// USAGE:
//   node scripts/regenerate-video-posters.mjs [--account act_x] [--limit N]
//        [--after AD_ID] [--dry-run]
//   Requires ffmpeg + ffprobe on PATH.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env.");
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? true) : undefined;
};
const ACCOUNT = opt("account");
const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;
const DRY_RUN = args.includes("--dry-run");
const PAGE = 200;
const BUCKET = "ad-thumbnails";
const REST = `${SUPABASE_URL}/rest/v1`;
const H = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
};

/** Short side (min of width/height) of an image or video URL/file via ffprobe; 0 on failure. */
async function shortSide(target) {
  try {
    const { stdout } = await execFileP(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", target],
      { timeout: 30_000 },
    );
    const [w, h] = stdout.trim().split("x").map(Number);
    if (!w || !h) return 0;
    return Math.min(w, h);
  } catch {
    return 0;
  }
}

/** Extract a representative native-resolution frame to a JPEG file; returns path or null. */
async function extractFrame(videoUrl, dir) {
  const out = join(dir, "frame.jpg");
  for (const ss of ["1", "0"]) {
    try {
      await execFileP(
        "ffmpeg",
        ["-y", "-loglevel", "error", "-ss", ss, "-i", videoUrl, "-frames:v", "1", "-q:v", "2", out],
        { timeout: 60_000 },
      );
      return out;
    } catch { /* try next seek offset */ }
  }
  return null;
}

async function measureRemote(url, dir) {
  // Download small images to measure; probe videos directly (range-fetched).
  try {
    const res = await fetch(url);
    if (!res.ok) return 0;
    const buf = Buffer.from(await res.arrayBuffer());
    const p = join(dir, "cur.img");
    writeFileSync(p, buf);
    return await shortSide(p);
  } catch {
    return 0;
  }
}

async function uploadPoster(path, filePath) {
  const body = readFileSync(filePath);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { ...H, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body,
  });
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function updateRow(adId, url) {
  const res = await fetch(`${REST}/creatives?ad_id=eq.${encodeURIComponent(adId)}`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ thumbnail_url: url, full_res_url: url }),
  });
  if (!res.ok) throw new Error(`patch ${res.status}: ${await res.text()}`);
}

async function fetchPage(after) {
  const params = new URLSearchParams({
    select: "ad_id,account_id,video_url,thumbnail_url",
    video_url: "like.http*",
    order: "ad_id.asc",
    limit: String(PAGE),
  });
  if (ACCOUNT) params.set("account_id", `eq.${ACCOUNT}`);
  if (after) params.set("ad_id", `gt.${after}`);
  const res = await fetch(`${REST}/creatives?${params}`, { headers: H });
  if (!res.ok) throw new Error(`list ${res.status}: ${await res.text()}`);
  return res.json();
}

const stats = { scanned: 0, upgraded: 0, skippedBigger: 0, skippedNoFrame: 0, errors: 0 };
let after = opt("after") || "";
const dir = mkdtempSync(join(tmpdir(), "posters-"));

console.log(`regenerate-video-posters ${DRY_RUN ? "(DRY RUN) " : ""}account=${ACCOUNT ?? "ALL"} limit=${LIMIT}`);
try {
  while (stats.scanned < LIMIT) {
    const rows = await fetchPage(after);
    if (!rows.length) break;
    for (const c of rows) {
      if (stats.scanned >= LIMIT) break;
      stats.scanned++;
      after = c.ad_id;
      try {
        const hasThumb = typeof c.thumbnail_url === "string" && c.thumbnail_url.startsWith("http");
        const curShort = hasThumb ? await measureRemote(c.thumbnail_url, dir) : 0;
        if (curShort >= 720) { stats.skippedBigger++; continue; } // video (<=720p) can't beat it
        const frame = await extractFrame(c.video_url, dir);
        if (!frame) { stats.skippedNoFrame++; continue; }
        const newShort = await shortSide(frame);
        if (newShort <= curShort) { stats.skippedBigger++; continue; } // never downgrade
        if (DRY_RUN) {
          stats.upgraded++;
          if (stats.upgraded <= 10) console.log(`  would upgrade ${c.ad_id}: ${curShort} -> ${newShort}px`);
          continue;
        }
        const url = await uploadPoster(`posters/${c.ad_id}.jpg`, frame);
        await updateRow(c.ad_id, url);
        stats.upgraded++;
      } catch (e) {
        stats.errors++;
        if (stats.errors <= 10) console.log(`  err ${c.ad_id}: ${e.message}`);
      }
    }
    console.log(`… scanned=${stats.scanned} upgraded=${stats.upgraded} skipped=${stats.skippedBigger + stats.skippedNoFrame} errors=${stats.errors} cursor=${after}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`DONE: ${JSON.stringify(stats)}`);
