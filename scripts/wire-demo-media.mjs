#!/usr/bin/env node
// Attach real generated media to the DEMO account's creatives. Downloads the
// AI-generated skincare stills + clips, uploads them to the app's PUBLIC storage
// buckets (ad-thumbnails / ad-videos) under a demo-glowdrip/ prefix, then wires the
// permanent storage URLs onto creatives (thumbnail_url/full_res_url for every ad;
// video_url for the video-format ads). Storage URLs are permanent + public, so the
// client serves them directly (no CDN expiry, no external dependency at demo time).
//
// SAFETY: dry-run by default. --execute to upload+wire. --teardown removes the
// uploaded storage objects. Credentials from env only.
//
//   Dry run:  hq secrets exec --company goodo-studios --only VERDANOTE_NEW_SUPABASE_URL,VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY -- node scripts/wire-demo-media.mjs
//   Execute:  ... node scripts/wire-demo-media.mjs --execute
//   Teardown: ... node scripts/wire-demo-media.mjs --teardown --execute

import { createClient } from "@supabase/supabase-js";

const EXECUTE = process.argv.includes("--execute");
const TEARDOWN = process.argv.includes("--teardown");
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VERDANOTE_NEW_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env."); process.exit(1); }
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const ACCOUNT_ID = "act_demo_glowdrip";
const PREFIX = "demo-glowdrip";
const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3AlLYkDcKy8ZraLqIOFGAFU7iRp/";

// AI-generated source assets, grouped by category.
const IMAGES = {
  product: ["hf_20260724_050517_87d129a5-e54a-47fd-8a3e-a9490df76b7d.png", "hf_20260724_050516_403f80e8-ac89-4af5-b524-3c48fbd5cc78.png", "hf_20260724_050516_97fc4d30-02f4-4ae9-9bf0-beb3ead6a79c.png", "hf_20260724_050516_d134ad39-9cf2-413c-9243-0ffdc5d5bcc3.png"],
  ugc: ["hf_20260724_050518_f06fe15a-54fc-4702-825a-c70f86c2b9b7.png", "hf_20260724_050518_ccb50b46-ea29-4b4b-8a86-2a0dd1ecf8ed.png", "hf_20260724_050518_0347c844-8f6c-49df-b4fd-dbefdc3be09d.png", "hf_20260724_050518_2b369549-403e-43ce-87f0-9e1ac767819b.png"],
  skin: ["hf_20260724_050533_0a949e56-09ab-4747-a4c1-c6cbb01fc55b.png", "hf_20260724_050533_ae0b4bb2-8269-4c44-9631-edd02a010328.png", "hf_20260724_050533_703f615f-a9b8-4f99-b034-6cd5b8665e0a.png", "hf_20260724_050533_e2b48822-fdc3-4b1b-adee-ca9604a9a2b6.png"],
  flatlay: ["hf_20260724_050535_33167c36-2dfd-430b-bdc8-5b90da1d0e75.png", "hf_20260724_050535_9d53d251-5461-40a6-b5e3-06ccf4f7bc7a.png", "hf_20260724_050535_57aa8bfb-669d-4dc9-81b8-5dfbe9a5f009.png", "hf_20260724_050535_9d7fda9d-211b-45f5-b810-b4f8e907e036.png"],
};
const VIDEOS = {
  product: "hf_20260724_050541_8f0dd446-5c0b-43cf-acf1-2e77570f0c31.mp4",
  ugc: "hf_20260724_050546_3c504ce9-625c-41d0-8e46-817c00a37428.mp4",
  skin: "hf_20260724_050551_079e5059-3fe2-4dbe-88d4-b586abcfde84.mp4",
};

// ad_format → which image category + which video category (null = no video)
const CAT_BY_FORMAT = {
  "UGC": { img: "ugc", vid: "ugc" },
  "Static Image": { img: "product", vid: null },
  "Motion Graphic": { img: "flatlay", vid: "product" },
  "Founder Story": { img: "ugc", vid: "ugc" },
  "Testimonial": { img: "ugc", vid: "ugc" },
  "Before/After": { img: "skin", vid: "skin" },
  "Product Demo": { img: "product", vid: "product" },
  "Unboxing": { img: "product", vid: "product" },
};

async function uploadFromCdn(bucket, srcFile, destName, contentType) {
  const res = await fetch(CDN + srcFile);
  if (!res.ok) throw new Error(`fetch ${srcFile} → ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const path = `${PREFIX}/${destName}`;
  const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
  const { data } = db.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function teardown() {
  console.log(`\n=== Media teardown — removing ${PREFIX}/ from storage ===`);
  for (const bucket of ["ad-thumbnails", "ad-videos"]) {
    if (!EXECUTE) { console.log(`  DRY RUN — would list+remove ${bucket}/${PREFIX}/`); continue; }
    const { data, error } = await db.storage.from(bucket).list(PREFIX);
    if (error) { console.log(`  (skip ${bucket}: ${error.message})`); continue; }
    const paths = (data || []).map((f) => `${PREFIX}/${f.name}`);
    if (!paths.length) { console.log(`  ${bucket}: nothing to remove`); continue; }
    const { error: rmErr } = await db.storage.from(bucket).remove(paths);
    console.log(rmErr ? `  ! ${bucket}: ${rmErr.message}` : `  removed ${paths.length} object(s) from ${bucket}`);
  }
}

async function seed() {
  console.log(`\n=== Wire media — ${ACCOUNT_ID} ===`);
  if (!EXECUTE) {
    const { data } = await db.from("creatives").select("ad_id, ad_format, ad_type").eq("account_id", ACCOUNT_ID);
    const withVid = (data || []).filter((c) => c.ad_type === "video" && CAT_BY_FORMAT[c.ad_format]?.vid).length;
    console.log(`  would upload ${Object.values(IMAGES).flat().length} images + ${Object.keys(VIDEOS).length} videos to storage (${PREFIX}/)`);
    console.log(`  would wire real thumbnails onto ${data?.length ?? "?"} creatives; playable video onto ${withVid} video-format creatives`);
    console.log("\n  DRY RUN — no writes. Re-run with --execute to apply.");
    return;
  }

  // 1. Upload all assets, capture public storage URLs.
  console.log("  Uploading images → ad-thumbnails …");
  const imgUrls = {};
  for (const [cat, files] of Object.entries(IMAGES)) {
    imgUrls[cat] = [];
    for (let i = 0; i < files.length; i++) {
      imgUrls[cat].push(await uploadFromCdn("ad-thumbnails", files[i], `${cat}-${i + 1}.png`, "image/png"));
    }
  }
  console.log("  Uploading videos → ad-videos …");
  const vidUrls = {};
  for (const [cat, file] of Object.entries(VIDEOS)) {
    vidUrls[cat] = await uploadFromCdn("ad-videos", file, `${cat}.mp4`, "video/mp4");
  }

  // 2. Assign to creatives (round-robin images within each category).
  const { data: creatives, error } = await db.from("creatives")
    .select("ad_id, ad_format, ad_type").eq("account_id", ACCOUNT_ID);
  if (error) throw new Error(`read creatives: ${error.message}`);

  const counters = {};
  let imgWired = 0, vidWired = 0;
  for (const c of creatives) {
    const cat = CAT_BY_FORMAT[c.ad_format] || { img: "product", vid: null };
    const pool = imgUrls[cat.img] || imgUrls.product;
    const n = (counters[cat.img] = (counters[cat.img] || 0) + 1) - 1;
    const imageUrl = pool[n % pool.length];
    const payload = { thumbnail_url: imageUrl, full_res_url: imageUrl };
    if (c.ad_type === "video" && cat.vid && vidUrls[cat.vid]) { payload.video_url = vidUrls[cat.vid]; }
    else { payload.video_url = "no-video"; }
    const { error: uErr } = await db.from("creatives").update(payload).eq("account_id", ACCOUNT_ID).eq("ad_id", c.ad_id);
    if (uErr) { console.error(`  ! ${c.ad_id}: ${uErr.message}`); break; }
    imgWired++; if (payload.video_url !== "no-video") vidWired++;
  }
  console.log(`  ✓ wired real thumbnails onto ${imgWired} creatives`);
  console.log(`  ✓ wired playable video onto ${vidWired} creatives`);
  console.log("\n  ✅ Media attached. Creative grid now shows real skincare imagery; video ads play on click.");
}

console.log(`Verdanote demo MEDIA — ${EXECUTE ? "EXECUTE (will mutate)" : "DRY RUN"}${TEARDOWN ? " — TEARDOWN" : ""}`);
if (TEARDOWN) { await teardown(); } else { await seed(); }
