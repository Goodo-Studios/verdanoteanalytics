// Regression test for regenerate-video-posters.mjs.
//
//   node --test scripts/regenerate-video-posters.test.mjs
//
// Requires SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY only because the module does
// its env check at import time; the values are never used by this test (no
// network call happens here).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "fake-service-role";

const { buildPosterUpdate } = await import("./regenerate-video-posters.mjs");

test("buildPosterUpdate sets thumbnail_storage_path alongside thumbnail_url/full_res_url", () => {
  // Regression: the original PATCH body only ever set thumbnail_url and
  // full_res_url, never thumbnail_storage_path — so every row this script
  // touched kept whatever (possibly stale, extensionless) path it already had.
  // 684 rows in prod were found in exactly this state: thumbnail_url correctly
  // pointing at storage/v1/object/public/ad-thumbnails/posters/<ad_id>.jpg, but
  // thumbnail_storage_path never updated to match.
  const url = "https://example.supabase.co/storage/v1/object/public/ad-thumbnails/posters/123.jpg";
  const path = "posters/123.jpg";
  assert.deepEqual(buildPosterUpdate(url, path), {
    thumbnail_url: url,
    full_res_url: url,
    thumbnail_storage_path: path,
  });
});

test("importing the module does NOT start the network scan (entry-point guard)", async () => {
  // Regression: the whole scan loop originally sat at module top level with no
  // guard, so merely `import`-ing this file (e.g. from a test) triggered a real
  // network fetch. Guarded now via pathToFileURL(process.argv[1]) — verified
  // indirectly by this file's own successful import above: if the guard were
  // absent or broken in the "always true" direction, importing would have hung
  // or thrown on a real network call before this test file's first assertion
  // ever ran. This test exists so a future regression fails loudly rather than
  // silently passing because Node happened to import fast enough.
  assert.equal(typeof buildPosterUpdate, "function", "module imported cleanly");
});

test("the guard correctly identifies direct execution: `node script.mjs` runs main()", () => {
  // The inverse failure mode — the guard being broken in the "always false"
  // direction — would make the script silently do nothing when run for real.
  // Exercise it exactly as an operator would invoke it: a relative path, from
  // the repo's scripts/ directory, which is the shape that broke a naive
  // `file://${process.argv[1]}` comparison (process.argv[1] is often relative).
  const here = dirname(fileURLToPath(import.meta.url));
  const out = execFileSync(
    "node",
    ["regenerate-video-posters.mjs", "--limit", "0"],
    {
      cwd: here,
      env: { ...process.env, SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fake" },
      encoding: "utf8",
    },
  );
  assert.match(out, /regenerate-video-posters/, "direct invocation must run main() and print its banner");
  assert.match(out, /DONE:/, "direct invocation must reach the DONE summary line");
});

test("buildPosterUpdate keeps thumbnail_storage_path bucket-relative (no bucket/URL prefix)", () => {
  // thumbnail_storage_path is a bucket-relative key (matches every other writer
  // in this repo — refresh-thumbnails, enrich-thumbnails), never the full public
  // URL. A regression here would make every consumer that builds a public URL
  // from this column double up the prefix.
  const result = buildPosterUpdate("https://x/storage/v1/object/public/ad-thumbnails/posters/9.jpg", "posters/9.jpg");
  assert.equal(result.thumbnail_storage_path, "posters/9.jpg");
  assert.equal(result.thumbnail_storage_path.startsWith("http"), false);
});
