#!/usr/bin/env node
// Seed a self-contained DEMO ad account ("Glowdrip") with realistic fake data so
// the Verdanote features can be shown end-to-end without touching a real Meta
// account. Everything it writes is namespaced to a single account_id and is fully
// removable with --teardown.
//
// What it creates:
//   * one ad_accounts row  (id = act_demo_glowdrip, name flagged "(DEMO)")
//   * 32 creatives          (varied formats / hooks / angles / lanes, tagged)
//   * ~30 days of creative_daily_metrics per creative (the source of truth every
//     windowed view derives from — get_period_metrics / get_daily_trends /
//     get_creative_window_aggregates all sum these daily rows)
//   * each creative's stored snapshot columns are the 30-day derived aggregate of
//     its own daily rows, so the Creatives table reconciles exactly with the
//     Overview / Analytics windows (same summable-base + derived-ratio contract as
//     rollup_creatives_from_daily / get_creative_window_aggregates).
//
// Thumbnails are branded base64 SVG data-URIs — self-contained (no network, no
// storage upload) and shaped to pass the client looksLikeHtmlBlob guard.
//
// SAFETY: dry-run by default. Pass --execute to mutate. Reads credentials from the
// environment only — never hard-coded. Run with the Verdanote infra secret:
//
//   Dry run:   hq secrets exec --company goodo-studios -- node scripts/seed-demo-account.mjs
//   Execute:   hq secrets exec --company goodo-studios -- node scripts/seed-demo-account.mjs --execute
//   Teardown:  hq secrets exec --company goodo-studios -- node scripts/seed-demo-account.mjs --teardown --execute
//
// Deterministic: a fixed PRNG seed means re-running --execute reproduces the same
// numbers, and re-seeding replaces the account cleanly (delete-by-account_id first).

import { createClient } from "@supabase/supabase-js";

const EXECUTE = process.argv.includes("--execute");
const TEARDOWN = process.argv.includes("--teardown");
const VERIFY = process.argv.includes("--verify");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VERDANOTE_NEW_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  console.error("Run via: hq secrets exec --company goodo-studios -- node scripts/seed-demo-account.mjs [--execute]");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── Config ────────────────────────────────────────────────────────────────────
const ACCOUNT_ID = "act_demo_glowdrip";
const ACCOUNT_NAME = "Glowdrip — Skincare (DEMO)";
const DAYS = 30;
const AOV = 48; // avg order value ($) for a skincare DTC
const SCALE_THRESHOLD = 2.0;
const KILL_THRESHOLD = 1.0;

// ── Deterministic PRNG (mulberry32) ─────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260723);
const rng = (lo, hi) => lo + (hi - lo) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round2 = (n) => Math.round(n * 100) / 100;

// ── Taxonomy (drives Tag Insights variety) ──────────────────────────────────────
const FORMATS = [
  { format: "UGC", video: true },
  { format: "Static Image", video: false },
  { format: "Motion Graphic", video: true },
  { format: "Founder Story", video: true },
  { format: "Testimonial", video: true },
  { format: "Before/After", video: true },
  { format: "Product Demo", video: true },
  { format: "Unboxing", video: true },
];
const HOOKS = ["Question", "Problem/Agitate", "Bold Claim", "Curiosity", "Social Proof", "Pattern Interrupt", "Founder POV"];
const ANGLES = ["Hydration", "Anti-aging", "Clean ingredients", "Dermatologist-backed", "Routine simplicity", "Price/value", "Sensitive skin"];
const LANES = [["Prospecting", "PRO"], ["Retargeting", "RET"], ["Retention", "RTN"]];
const CTAS = ["Shop Now", "Learn More", "Get Offer", "Sign Up"];
const FRAMEWORKS = ["PAS", "AIDA", "Star-Story-Solution", "FAB", "4Ps"];
const AUDIENCES = ["Women 25-34", "Women 35-44", "Skincare enthusiasts", "First-time buyers", "Lapsed customers"];
const CREATORS = ["Maya R.", "Jenna K.", "Dr. Alvarez", "Priya (Founder)", "Chloe T.", "Nina S."];
const HOOK_LINES = {
  Question: "Ever wonder why your moisturizer stops working by noon?",
  "Problem/Agitate": "Tight, flaky skin no cream seems to fix?",
  "Bold Claim": "The 3-step routine that replaced my whole shelf.",
  Curiosity: "I didn't believe the 'glass skin' hype… until week 3.",
  "Social Proof": "42,000 five-star reviews can't all be wrong.",
  "Pattern Interrupt": "Stop buying serums until you watch this.",
  "Founder POV": "I built Glowdrip because my sensitive skin hated everything else.",
};
const GRADIENTS = [
  ["#FCE1E4", "#F6A6B2"], ["#FFE8D6", "#F4B393"], ["#E8DAEF", "#B08BD9"],
  ["#D6F5E3", "#79D7A8"], ["#FDE2C8", "#F49AC1"], ["#E3F0FF", "#8FB8F0"],
  ["#FFF0D9", "#F0C05A"], ["#F3E1F7", "#C77DD6"],
];

// ── Branded self-contained thumbnail (base64 SVG data-URI) ──────────────────────
function makeThumb(i, format, roas, label) {
  const [c1, c2] = GRADIENTS[i % GRADIENTS.length];
  const badgeColor = roas >= SCALE_THRESHOLD ? "#1B8A5A" : roas < KILL_THRESHOLD ? "#C0392B" : "#B7791F";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>` +
    `<rect width="400" height="500" fill="url(#g)"/>` +
    `<circle cx="200" cy="215" r="92" fill="#ffffff" opacity="0.34"/>` +
    `<text x="200" y="150" font-family="Georgia,serif" font-size="34" font-weight="700" fill="#3A2E3F" text-anchor="middle" letter-spacing="2">Glowdrip</text>` +
    `<text x="200" y="230" font-family="Arial,Helvetica,sans-serif" font-size="20" fill="#3A2E3F" text-anchor="middle">${esc(format)}</text>` +
    `<text x="200" y="262" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#5B4B60" text-anchor="middle">DEMO CREATIVE</text>` +
    `<rect x="120" y="300" width="160" height="40" rx="20" fill="${badgeColor}"/>` +
    `<text x="200" y="327" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="700" fill="#ffffff" text-anchor="middle">${roas.toFixed(2)}x ROAS</text>` +
    `<text x="200" y="420" font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#4A3B50" text-anchor="middle">${esc(label)}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// ── Build creative definitions across performance tiers ─────────────────────────
// tier: winners (scaling), monitoring, killed — spread of roas + spend scale.
function buildCreativeDefs() {
  const defs = [];
  const tiers = [
    { n: 9, name: "winner", roas: [2.2, 4.6], spend: [900, 2200], status: "ACTIVE" },
    { n: 14, name: "monitor", roas: [1.05, 2.1], spend: [400, 1300], status: "ACTIVE" },
    { n: 9, name: "killed", roas: [0.35, 0.95], spend: [180, 700], status: "PAUSED" },
  ];
  let idx = 0;
  const familyParents = {}; // angle -> first ad_id, to chain a few iterations
  for (const tier of tiers) {
    for (let k = 0; k < tier.n; k++) {
      const fmt = pick(FORMATS);
      const hook = pick(HOOKS);
      const angle = pick(ANGLES);
      const [lane, laneCode] = pick(LANES);
      const targetRoas = round2(rng(tier.roas[0], tier.roas[1]));
      const dailySpendBase = round2(rng(tier.spend[0], tier.spend[1]) / DAYS);
      const version = 1 + Math.floor(rand() * 3);
      const adId = `demo_gd_${String(idx + 1).padStart(4, "0")}`;
      const adName = `GD_${laneCode}_${fmt.format.replace(/[^A-Za-z]/g, "")}_${hook.replace(/[^A-Za-z]/g, "")}_v${version}`;

      // Chain a couple of iterations per angle for the Iterations view.
      let parentAdId = null;
      if (familyParents[angle] && version > 1 && rand() < 0.5) parentAdId = familyParents[angle];
      else if (!familyParents[angle]) familyParents[angle] = adId;

      defs.push({
        idx, adId, adName, tier: tier.name, status: tier.status,
        fmt, hook, angle, lane, targetRoas, dailySpendBase, version, parentAdId,
        cta: pick(CTAS), framework: pick(FRAMEWORKS), audience: pick(AUDIENCES), creator: pick(CREATORS),
      });
      idx++;
    }
  }
  return defs;
}

// ── Generate 30 daily rows for one creative + return the derived snapshot ────────
function generateDailyAndSnapshot(def, dates) {
  const daily = [];
  // per-creative baseline rates
  const cpm = rng(12, 22);
  const ctr = rng(0.8, 2.6) / 100;
  const isVideo = def.fmt.video;
  const thumbStop = rng(0.25, 0.46); // video_views / impressions
  const holdRate = rng(12, 36);      // %
  const vapt = rng(3, 12);           // s
  const freq = rng(1.1, 2.4);
  const ret = { p25: rng(55, 78), p50: rng(30, 52), p75: rng(15, 30), p100: rng(6, 16) };
  const atcMult = rng(2.5, 4.2);

  // accumulators for snapshot
  let s = { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0, adds_to_cart: 0, video_views: 0 };
  let holdNum = 0, vaptNum = 0, freqNum = 0;
  let retNum = { p25: 0, p50: 0, p75: 0, p100: 0 }, retW = 0;

  dates.forEach((date, di) => {
    // gentle trend + jitter; winners ramp up, killed taper down
    const trend = def.tier === "winner" ? 1 + (di / DAYS) * 0.5
      : def.tier === "killed" ? 1.2 - (di / DAYS) * 0.6 : 1;
    const jitter = rng(0.72, 1.28);
    const spend = round2(def.dailySpendBase * trend * jitter);
    const impressions = Math.round((spend / cpm) * 1000);
    const clicks = Math.round(impressions * ctr * rng(0.85, 1.15));
    const dailyRoas = def.targetRoas * rng(0.8, 1.2);
    const purchaseValue = round2(spend * dailyRoas);
    const purchases = Math.max(0, Math.round(purchaseValue / AOV));
    const purchaseValueFinal = round2(purchases * AOV); // reconcile pv with integer purchases
    const addsToCart = Math.round(purchases * atcMult) + Math.round(rng(0, 3));
    const videoViews = isVideo ? Math.round(impressions * thumbStop * rng(0.9, 1.1)) : 0;
    const dCpa = purchases > 0 ? round2(spend / purchases) : 0;
    const dCpc = clicks > 0 ? round2(spend / clicks) : 0;
    const dCtr = impressions > 0 ? round2((clicks / impressions) * 100) : 0;
    const dCpm = impressions > 0 ? round2((spend / impressions) * 1000) : 0;
    const dTsr = impressions > 0 && videoViews > 0 ? round2((videoViews / impressions) * 100) : null;
    const dHold = isVideo ? round2(holdRate * rng(0.9, 1.1)) : null;
    const dVapt = isVideo ? round2(vapt * rng(0.9, 1.1)) : null;
    const dFreq = round2(freq * rng(0.92, 1.08));
    const dAtcCost = addsToCart > 0 ? round2(spend / addsToCart) : null;

    daily.push({
      account_id: ACCOUNT_ID, ad_id: def.adId, date, platform: "facebook",
      spend, impressions, clicks, purchases, purchase_value: purchaseValueFinal,
      adds_to_cart: addsToCart, video_views: videoViews,
      roas: spend > 0 ? round2(purchaseValueFinal / spend) : 0,
      cpa: dCpa, cpc: dCpc, ctr: dCtr, cpm: dCpm,
      cost_per_add_to_cart: dAtcCost, thumb_stop_rate: dTsr, hold_rate: dHold,
      video_avg_play_time: dVapt, frequency: dFreq,
      retention_p25: isVideo ? round2(ret.p25 * rng(0.95, 1.05)) : null,
      retention_p50: isVideo ? round2(ret.p50 * rng(0.95, 1.05)) : null,
      retention_p75: isVideo ? round2(ret.p75 * rng(0.95, 1.05)) : null,
      retention_p100: isVideo ? round2(ret.p100 * rng(0.95, 1.05)) : null,
    });

    // accumulate for snapshot (mirror get_creative_window_aggregates)
    s.spend += spend; s.impressions += impressions; s.clicks += clicks;
    s.purchases += purchases; s.purchase_value += purchaseValueFinal;
    s.adds_to_cart += addsToCart; s.video_views += videoViews;
    if (dHold != null && videoViews) holdNum += (dHold / 100) * videoViews;
    if (dVapt != null && videoViews) vaptNum += dVapt * videoViews;
    freqNum += dFreq * impressions;
    if (isVideo && videoViews > 0) {
      retNum.p25 += (ret.p25) * videoViews; retNum.p50 += (ret.p50) * videoViews;
      retNum.p75 += (ret.p75) * videoViews; retNum.p100 += (ret.p100) * videoViews;
      retW += videoViews;
    }
  });

  const roas = s.spend > 0 ? round2(s.purchase_value / s.spend) : 0;
  const snap = {
    spend: round2(s.spend), impressions: s.impressions, clicks: s.clicks,
    purchases: s.purchases, purchase_value: round2(s.purchase_value),
    adds_to_cart: s.adds_to_cart, video_views: s.video_views, roas,
    cpa: s.purchases > 0 ? round2(s.spend / s.purchases) : 0,
    cpc: s.clicks > 0 ? round2(s.spend / s.clicks) : 0,
    ctr: s.impressions > 0 ? round2((s.clicks / s.impressions) * 100) : 0,
    cpm: s.impressions > 0 ? round2((s.spend / s.impressions) * 1000) : 0,
    cost_per_add_to_cart: s.adds_to_cart > 0 ? round2(s.spend / s.adds_to_cart) : 0,
    thumb_stop_rate: s.impressions > 0 && s.video_views > 0 ? round2((s.video_views / s.impressions) * 100) : null,
    hold_rate: s.video_views > 0 ? round2((holdNum / s.video_views) * 100) : null,
    video_avg_play_time: s.video_views > 0 ? round2(vaptNum / s.video_views) : null,
    frequency: s.impressions > 0 ? round2(freqNum / s.impressions) : null,
    retention_p25: retW > 0 ? round2(retNum.p25 / retW) : null,
    retention_p50: retW > 0 ? round2(retNum.p50 / retW) : null,
    retention_p75: retW > 0 ? round2(retNum.p75 / retW) : null,
    retention_p100: retW > 0 ? round2(retNum.p100 / retW) : null,
  };
  return { daily, snap };
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

function buildAll() {
  const today = new Date();
  const dates = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(isoDate(d));
  }
  const defs = buildCreativeDefs();
  const creatives = [];
  let allDaily = [];

  for (const def of defs) {
    const { daily, snap } = generateDailyAndSnapshot(def, dates);
    allDaily = allDaily.concat(daily);
    const isVideo = def.fmt.video;
    const createdOffset = Math.floor(rng(2, 58));
    const createdTime = new Date(today); createdTime.setDate(today.getDate() - createdOffset);
    const thumb = makeThumb(def.idx, def.fmt.format, snap.roas, def.adName);

    creatives.push({
      account_id: ACCOUNT_ID, ad_id: def.adId, ad_name: def.adName,
      campaign_name: `Glowdrip | ${def.lane} | ${def.angle}`,
      adset_name: `${def.audience} | ${def.fmt.format}`,
      ad_status: def.status, ad_type: isVideo ? "video" : "image",
      ad_format: def.fmt.format, platform: "facebook",
      created_time: createdTime.toISOString(),
      version: def.version, parent_ad_id: def.parentAdId,
      // tags / structured metadata (Tag Insights dimensions)
      hook_type: def.hook, hook_text: HOOK_LINES[def.hook], hook: HOOK_LINES[def.hook],
      theme: def.angle, style: def.fmt.format, creative_type: def.fmt.format,
      creative_lane: def.lane, cta_type: def.cta, copywriting_framework: def.framework,
      target_audience: def.audience, industry: "Beauty & Skincare",
      product: "Glowdrip Hydrating Serum", person: def.creator, creator_id: null,
      brand_name: "Glowdrip", tag_source: "manual",
      // media (self-contained branded thumbnail; no external calls)
      thumbnail_url: thumb, video_url: "no-video", preview_url: null, full_res_url: null,
      // analysis (populates detail view + AI panels)
      analysis_status: "done", analyzed_at: new Date().toISOString(),
      transcript_status: isVideo ? "completed" : "none",
      transcript: isVideo ? `[DEMO transcript] ${HOOK_LINES[def.hook]} … Glowdrip's ${def.angle.toLowerCase()} formula in a simple daily routine. Tap ${def.cta}.` : null,
      ai_analysis: `Strong ${def.fmt.format} execution on a "${def.angle}" angle. ${snap.roas >= SCALE_THRESHOLD ? "Clear scaler — hook + offer landing with the target audience." : snap.roas < KILL_THRESHOLD ? "Underperforming — hook fatigue and weak CTA follow-through." : "Steady performer worth iterating on."}`,
      ai_hook_analysis: `${def.hook} hook. First 3s carry the promise; ${snap.thumb_stop_rate ? `thumb-stop ${snap.thumb_stop_rate}%` : "static open"}.`,
      ai_visual_notes: `${def.fmt.format} visual style, on-brand palette, product hero in frame.`,
      ai_cta_notes: `${def.cta} CTA using a ${def.framework} structure.`,
      // metrics snapshot (30-day derived aggregate — reconciles with windows)
      spend: snap.spend, impressions: snap.impressions, clicks: snap.clicks,
      purchases: snap.purchases, purchase_value: snap.purchase_value,
      adds_to_cart: snap.adds_to_cart, video_views: snap.video_views,
      roas: snap.roas, cpa: snap.cpa, cpc: snap.cpc, ctr: snap.ctr, cpm: snap.cpm,
      cost_per_add_to_cart: snap.cost_per_add_to_cart, thumb_stop_rate: snap.thumb_stop_rate,
      hold_rate: snap.hold_rate, video_avg_play_time: snap.video_avg_play_time,
      frequency: snap.frequency,
      retention_p25: snap.retention_p25, retention_p50: snap.retention_p50,
      retention_p75: snap.retention_p75, retention_p100: snap.retention_p100,
      result_type: "purchase", result_count: snap.purchases, cost_per_result: snap.cpa,
      prior_roas: def.version > 1 ? round2(snap.roas * rng(0.6, 0.95)) : null,
    });
  }

  const account = {
    id: ACCOUNT_ID, name: ACCOUNT_NAME, is_active: true,
    industry_category: "Beauty & Skincare",
    company_description: "Glowdrip is a (fictional) DTC skincare brand built around a hydrating serum and a simple 3-step routine for sensitive skin. This is a DEMO account with synthetic data for showcasing Verdanote — it is not a real client.",
    date_range_days: DAYS, scale_threshold: SCALE_THRESHOLD, kill_threshold: KILL_THRESHOLD,
    iteration_spend_threshold: 250, optimization_goal: "PURCHASE",
    primary_kpi: "Purchase ROAS > 2x", target_roas: 2.5, target_cpa: 26, target_monthly_spend: 90000,
    kill_scale_kpi: "roas", kill_scale_kpi_direction: "gte",
    winner_kpi: "roas", winner_kpi_direction: "gte",
    winner_kpi_threshold: SCALE_THRESHOLD, winner_roas_threshold: SCALE_THRESHOLD,
    attribution_model: "7d_click_1d_view", click_window: 7, view_window: 1,
    creative_count: creatives.length, untagged_count: 0,
    insights_prompt: "Glowdrip sells a hydrating serum to sensitive-skin buyers. Winning angles historically: hydration and dermatologist-backed. UGC and founder-story formats outperform static.",
    last_synced_at: new Date().toISOString(), last_data_sync: new Date().toISOString(),
    portfolio_enabled: false,
  };

  return { account, creatives, allDaily, dates };
}

async function teardown() {
  console.log(`\n=== Teardown — removing demo account ${ACCOUNT_ID} ===`);
  // Child/extra tables first, then metrics, creatives, and the account last.
  // Extra tables (from seed-demo-extras.mjs) are best-effort — ignore if absent.
  const extras = ["coda_tasks", "briefs", "reports", "creative_clusters"];
  const steps = [
    ...extras.map((t) => [t, () => db.from(t).delete().eq("account_id", ACCOUNT_ID), true]),
    ["creative_daily_metrics", () => db.from("creative_daily_metrics").delete().eq("account_id", ACCOUNT_ID), false],
    ["creatives", () => db.from("creatives").delete().eq("account_id", ACCOUNT_ID), false],
    ["ad_accounts", () => db.from("ad_accounts").delete().eq("id", ACCOUNT_ID), false],
  ];
  for (const [name, fn, optional] of steps) {
    if (!EXECUTE) { console.log(`  DRY RUN — would delete from ${name} where account = ${ACCOUNT_ID}`); continue; }
    const { error } = await fn();
    if (error) {
      if (optional) { console.log(`  (skip ${name}: ${error.message})`); continue; }
      console.error(`  ! ${name}: ${error.message}`); process.exit(1);
    }
    console.log(`  deleted ${name} rows for ${ACCOUNT_ID}`);
  }

  // Purge the demo media uploaded by wire-demo-media.mjs (demo-glowdrip/ prefix).
  const MEDIA_PREFIX = "demo-glowdrip";
  for (const bucket of ["ad-thumbnails", "ad-videos"]) {
    if (!EXECUTE) { console.log(`  DRY RUN — would remove storage ${bucket}/${MEDIA_PREFIX}/`); continue; }
    const { data, error } = await db.storage.from(bucket).list(MEDIA_PREFIX);
    if (error) { console.log(`  (skip storage ${bucket}: ${error.message})`); continue; }
    const paths = (data || []).map((f) => `${MEDIA_PREFIX}/${f.name}`);
    if (!paths.length) { console.log(`  storage ${bucket}: nothing to remove`); continue; }
    const { error: rmErr } = await db.storage.from(bucket).remove(paths);
    console.log(rmErr ? `  ! storage ${bucket}: ${rmErr.message}` : `  removed ${paths.length} object(s) from ${bucket}`);
  }
}

// Self-healing insert: the checked-in types can be ahead of the live prod schema
// (migrations not yet pushed). On a "Could not find the 'X' column" error we drop
// that column from every row and retry, so the seed still lands on prod.
async function chunkInsert(table, rows, size = 500) {
  if (!rows.length) return;
  const drop = new Set();
  const sanitize = (r) => { const o = { ...r }; for (const k of drop) delete o[k]; return o; };
  for (let i = 0; i < rows.length; i += size) {
    let batch = rows.slice(i, i + size).map(sanitize);
    for (;;) {
      const { error } = await db.from(table).insert(batch);
      if (!error) break;
      const m = error.message.match(/Could not find the '([^']+)' column/);
      if (m) { drop.add(m[1]); batch = batch.map(sanitize); continue; }
      throw new Error(`${table} insert failed at row ${i}: ${error.message}`);
    }
  }
  if (drop.size) console.log(`  note: dropped ${drop.size} column(s) absent from prod schema: ${[...drop].join(", ")}`);
}

async function seed() {
  const { account, creatives, allDaily } = buildAll();
  const winners = creatives.filter((c) => c.roas >= SCALE_THRESHOLD).length;
  const killed = creatives.filter((c) => c.roas < KILL_THRESHOLD).length;
  const totalSpend = round2(creatives.reduce((a, c) => a + c.spend, 0));
  const totalPV = round2(creatives.reduce((a, c) => a + c.purchase_value, 0));
  const blendedRoas = round2(totalPV / totalSpend);

  console.log(`\n=== Seed plan — ${ACCOUNT_NAME} ===`);
  console.log(`  account_id:      ${ACCOUNT_ID}`);
  console.log(`  creatives:       ${creatives.length}  (scaling ${winners} / monitoring ${creatives.length - winners - killed} / paused ${killed})`);
  console.log(`  daily rows:      ${allDaily.length}  (${DAYS} days x ${creatives.length} ads)`);
  console.log(`  30d spend:       $${totalSpend.toLocaleString()}`);
  console.log(`  30d revenue:     $${totalPV.toLocaleString()}`);
  console.log(`  blended ROAS:    ${blendedRoas}x`);
  console.log(`  sample ads:`);
  creatives.slice(0, 5).forEach((c) => console.log(`    - ${c.ad_name}  ${c.roas}x  $${c.spend}  [${c.ad_format}/${c.hook_type}/${c.theme}]`));

  if (!EXECUTE) {
    console.log("\n  DRY RUN — no writes. Re-run with --execute to apply.");
    return;
  }

  // Clean re-seed: remove any prior demo rows first (delete child -> parent).
  console.log("\n  Clearing any existing demo rows…");
  await db.from("creative_daily_metrics").delete().eq("account_id", ACCOUNT_ID);
  await db.from("creatives").delete().eq("account_id", ACCOUNT_ID);
  await db.from("ad_accounts").delete().eq("id", ACCOUNT_ID);

  console.log("  Inserting account…");
  { const { error } = await db.from("ad_accounts").insert(account); if (error) throw new Error(`ad_accounts insert failed: ${error.message}`); }
  console.log(`  Inserting ${creatives.length} creatives…`);
  await chunkInsert("creatives", creatives);
  console.log(`  Inserting ${allDaily.length} daily-metric rows…`);
  await chunkInsert("creative_daily_metrics", allDaily);

  console.log("\n  ✅ Demo account seeded. Select \"" + ACCOUNT_NAME + "\" in the account switcher.");
}

async function verify() {
  console.log(`\n=== Verify — ${ACCOUNT_ID} ===`);
  const acct = await db.from("ad_accounts").select("name, creative_count, is_active").eq("id", ACCOUNT_ID).single();
  console.log(`  account:        ${acct.data?.name}  (active=${acct.data?.is_active}, creative_count=${acct.data?.creative_count})`);
  const cCount = await db.from("creatives").select("*", { count: "exact", head: true }).eq("account_id", ACCOUNT_ID);
  const dCount = await db.from("creative_daily_metrics").select("*", { count: "exact", head: true }).eq("account_id", ACCOUNT_ID);
  console.log(`  creatives:      ${cCount.count}`);
  console.log(`  daily rows:     ${dCount.count}`);

  const today = new Date();
  const from = new Date(today); from.setDate(today.getDate() - (DAYS - 1));
  const p = await db.rpc("get_period_metrics", { p_account_id: ACCOUNT_ID, p_from: isoDate(from), p_to: isoDate(today) });
  if (p.error) { console.log(`  get_period_metrics: ERROR ${p.error.message}`); }
  else {
    const r = p.data[0];
    const roas = r.total_spend > 0 ? (r.total_purchase_value / r.total_spend) : 0;
    console.log(`  period metrics: spend $${round2(r.total_spend).toLocaleString()}  rev $${round2(r.total_purchase_value).toLocaleString()}  ROAS ${round2(roas)}x  purchases ${r.total_purchases}  active ${r.active_count}`);
  }
  const t = await db.rpc("get_daily_trends", { p_account_id: ACCOUNT_ID, p_from: isoDate(from), p_to: isoDate(today) });
  console.log(`  daily trends:   ${t.error ? "ERROR " + t.error.message : t.data.length + " day points"}`);
  const w = await db.rpc("get_creative_window_aggregates", { p_account_id: ACCOUNT_ID, p_from: isoDate(from), p_to: isoDate(today) });
  if (w.error) { console.log(`  window aggs:    ERROR ${w.error.message}`); }
  else {
    const scaling = w.data.filter((x) => Number(x.roas) >= SCALE_THRESHOLD).length;
    const killed = w.data.filter((x) => Number(x.roas) < KILL_THRESHOLD).length;
    console.log(`  window aggs:    ${w.data.length} ads  (scaling ${scaling} / paused ${killed})`);
    const top = [...w.data].sort((a, b) => Number(b.roas) - Number(a.roas))[0];
    console.log(`  top by ROAS:    ${top.ad_id}  ${round2(Number(top.roas))}x  $${round2(Number(top.spend))}`);
  }
  // Reconciliation: snapshot on creatives vs window aggregate should match per ad.
  const snap = await db.from("creatives").select("ad_id, spend, roas").eq("account_id", ACCOUNT_ID);
  const byId = Object.fromEntries((w.data || []).map((x) => [x.ad_id, x]));
  let mism = 0;
  for (const c of snap.data || []) {
    const a = byId[c.ad_id];
    if (!a) continue;
    if (Math.abs(Number(a.spend) - Number(c.spend)) > 1) mism++;
  }
  console.log(`  reconciliation: ${mism === 0 ? "✅ snapshot spend matches window aggregate for all ads" : "⚠️ " + mism + " ad(s) differ >$1"}`);
}

console.log(`Verdanote demo seed — ${VERIFY ? "VERIFY" : EXECUTE ? "EXECUTE (will mutate)" : "DRY RUN"}${TEARDOWN ? " — TEARDOWN" : ""}`);
if (VERIFY) { await verify(); }
else if (TEARDOWN) { await teardown(); }
else { await seed(); }
