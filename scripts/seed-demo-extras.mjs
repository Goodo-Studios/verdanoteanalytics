#!/usr/bin/env node
// Second-pass seed for the DEMO account (act_demo_glowdrip): fills the tabs the
// base seed (seed-demo-account.mjs) doesn't cover, so every Verdanote page has
// data. Reads the already-seeded creatives from the DB and layers on:
//
//   * creatives backfill: destination_key (Landing Pages), launch/lifecycle dates
//     (Creative Rotation cohorts), cluster_id (Entities) — only for columns that
//     actually exist in the live schema (probed first).
//   * creative_clusters  — entity cards for the Entities tab (grouped by angle).
//   * coda_tasks         — Content Pipeline board (across the 5 pipeline stages).
//   * briefs             — Briefs list.
//   * reports            — Reports list/detail (aggregates computed like the app's
//     report generator, since that endpoint needs a real user JWT we don't have).
//
// SAFETY: dry-run by default. --execute to mutate. --teardown to remove all of the
// above. Credentials from env only.
//
//   Dry run:  hq secrets exec --company goodo-studios --only VERDANOTE_NEW_SUPABASE_URL,VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY -- node scripts/seed-demo-extras.mjs
//   Execute:  ... node scripts/seed-demo-extras.mjs --execute
//   Teardown: ... node scripts/seed-demo-extras.mjs --teardown --execute

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const EXECUTE = process.argv.includes("--execute");
const TEARDOWN = process.argv.includes("--teardown");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VERDANOTE_NEW_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VERDANOTE_NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env."); process.exit(1); }
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const ACCOUNT_ID = "act_demo_glowdrip";
const ACCOUNT_NAME = "Glowdrip — Skincare (DEMO)";
const DAYS = 30;

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(70725);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round2 = (n) => Math.round(n * 100) / 100;
const isoDate = (d) => d.toISOString().slice(0, 10);
const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");

const LP_BY_ANGLE = {
  "Hydration": "glowdrip.co/hydro-serum",
  "Anti-aging": "glowdrip.co/age-rewind",
  "Clean ingredients": "glowdrip.co/clean-routine",
  "Dermatologist-backed": "glowdrip.co/derm-bundle",
  "Routine simplicity": "glowdrip.co/3-step",
  "Price/value": "glowdrip.co/starter-kit",
  "Sensitive skin": "glowdrip.co/gentle",
};

async function columnExists(table, col) {
  const { error } = await db.from(table).select(col).limit(1);
  if (!error) return true;
  if (/column .* does not exist|Could not find the '.*' column|does not exist/i.test(error.message)) return false;
  return true; // other errors (RLS etc.) — assume present
}
async function tableExists(table) {
  const { error } = await db.from(table).select("*", { head: true, count: "exact" }).limit(1);
  if (!error) return true;
  if (/relation .* does not exist|Could not find the table|does not exist|schema cache/i.test(error.message)) return false;
  return true;
}

async function fetchCreatives() {
  const { data, error } = await db.from("creatives")
    .select("ad_id, ad_name, unique_code, theme, style, ad_format, ad_type, hook, spend, roas, cpa, ctr, purchases, created_time, tag_source")
    .eq("account_id", ACCOUNT_ID);
  if (error) throw new Error(`read creatives failed: ${error.message}`);
  return data || [];
}

// Self-healing insert (drops columns absent from the live schema).
async function insertRows(table, rows) {
  if (!rows.length) return { inserted: 0, dropped: [] };
  const drop = new Set();
  const sanitize = (r) => { const o = { ...r }; for (const k of drop) delete o[k]; return o; };
  let batch = rows.map(sanitize);
  for (;;) {
    const { error } = await db.from(table).insert(batch);
    if (!error) break;
    const m = error.message.match(/Could not find the '([^']+)' column/);
    if (m) { drop.add(m[1]); batch = batch.map(sanitize); continue; }
    throw new Error(`${table} insert failed: ${error.message}`);
  }
  return { inserted: rows.length, dropped: [...drop] };
}

async function teardown() {
  console.log(`\n=== Extras teardown — ${ACCOUNT_ID} ===`);
  const dels = [
    ["coda_tasks", () => db.from("coda_tasks").delete().eq("account_id", ACCOUNT_ID)],
    ["briefs", () => db.from("briefs").delete().eq("account_id", ACCOUNT_ID)],
    ["reports", () => db.from("reports").delete().eq("account_id", ACCOUNT_ID)],
    ["creative_clusters", () => db.from("creative_clusters").delete().eq("account_id", ACCOUNT_ID)],
  ];
  for (const [name, fn] of dels) {
    if (!EXECUTE) { console.log(`  DRY RUN — would delete ${name} for ${ACCOUNT_ID}`); continue; }
    if (!(await tableExists(name))) { console.log(`  (skip ${name} — table absent)`); continue; }
    const { error } = await fn();
    console.log(error ? `  ! ${name}: ${error.message}` : `  deleted ${name} rows`);
  }
  // null out the creatives backfill columns (best-effort per column)
  for (const col of ["cluster_id", "destination_key"]) {
    if (!EXECUTE) { console.log(`  DRY RUN — would clear creatives.${col}`); continue; }
    if (await columnExists("creatives", col)) {
      const { error } = await db.from("creatives").update({ [col]: null }).eq("account_id", ACCOUNT_ID);
      console.log(error ? `  ! creatives.${col}: ${error.message}` : `  cleared creatives.${col}`);
    }
  }
}

async function seed() {
  const creatives = await fetchCreatives();
  if (!creatives.length) { console.error(`No creatives for ${ACCOUNT_ID}. Run seed-demo-account.mjs --execute first.`); process.exit(1); }
  console.log(`\n=== Extras seed — ${ACCOUNT_NAME} (${creatives.length} creatives) ===`);

  const today = new Date();
  const windowStart = new Date(today); windowStart.setDate(today.getDate() - (DAYS - 1));

  // ── Probe which optional creatives columns exist in the live schema ──────────
  const cols = {};
  for (const c of ["destination_key", "cluster_id", "launch_date", "first_added_date", "first_spend_date"]) {
    cols[c] = await columnExists("creatives", c);
  }
  console.log(`  creatives columns present: ${Object.entries(cols).filter(([, v]) => v).map(([k]) => k).join(", ") || "(none of the optional set)"}`);

  // ── Build entity clusters grouped by angle (theme) ───────────────────────────
  const byAngle = {};
  for (const c of creatives) { const k = c.theme || "Uncategorized"; (byAngle[k] ||= []).push(c); }
  const clusters = [];
  const clusterIdByAd = {};
  for (const [angle, members] of Object.entries(byAngle)) {
    const spend = round2(members.reduce((a, c) => a + Number(c.spend || 0), 0));
    if (spend <= 0) continue;
    const rep = [...members].sort((a, b) => Number(b.spend) - Number(a.spend))[0];
    const topFormat = rep.ad_format || rep.style || "Mixed";
    const id = randomUUID();
    const tier = members.length >= 4 ? "corroborated" : members.length >= 2 ? "probable" : "visual_only";
    clusters.push({
      id, account_id: ACCOUNT_ID, label: `${angle} · ${topFormat}`,
      n_creatives: members.length, total_spend: spend,
      cv_roas: round2(0.1 + rand() * 0.3), cv_ctr: round2(0.1 + rand() * 0.3), cv_cpa: round2(0.1 + rand() * 0.3),
      tag_homogeneity: round2(0.6 + rand() * 0.35), manual_tag_frac: 1,
      confidence_tier: tier, representative_ad_id: rep.ad_id, threshold: 0.82, model: "demo-clusters-v1",
    });
    for (const m of members) clusterIdByAd[m.ad_id] = id;
  }

  // ── Per-creative backfill payloads (only existing columns) ───────────────────
  const backfills = creatives.map((c) => {
    const launch = c.created_time ? new Date(c.created_time) : new Date(windowStart);
    const firstSpend = launch > windowStart ? launch : windowStart;
    const payload = {};
    if (cols.destination_key) payload.destination_key = LP_BY_ANGLE[c.theme] || "glowdrip.co/shop";
    if (cols.cluster_id && clusterIdByAd[c.ad_id]) payload.cluster_id = clusterIdByAd[c.ad_id];
    if (cols.launch_date) payload.launch_date = isoDate(launch);
    if (cols.first_added_date) payload.first_added_date = isoDate(launch);
    if (cols.first_spend_date) payload.first_spend_date = isoDate(firstSpend);
    return { ad_id: c.ad_id, payload };
  }).filter((b) => Object.keys(b.payload).length);

  // ── Content Pipeline (coda_tasks) across the 5 mapped stages ─────────────────
  const STAGES = ["Preparing Content", "Production", "Editing", "Client Review", "Ready to Launch"];
  const stagePlan = [3, 3, 3, 2, 3];
  const codaTasks = [];
  let ci = 0;
  STAGES.forEach((stage, si) => {
    for (let k = 0; k < stagePlan[si]; k++) {
      const c = creatives[(ci * 3 + si) % creatives.length]; ci++;
      const due = new Date(today); due.setDate(today.getDate() + Math.floor(rand() * 18) - 4);
      const launched = stage === "Ready to Launch";
      codaTasks.push({
        id: randomUUID(), account_id: ACCOUNT_ID, account_name: ACCOUNT_NAME,
        task_name: `${c.ad_name} (concept)`, stage, status: launched ? "Live" : "In progress",
        content_type: c.ad_format || "UGC", ad_type: c.ad_type || "video",
        brief: `${c.theme} angle — ${c.hook || "hook TBD"}. ${c.ad_format} for ${c.style}.`,
        creative_name: c.ad_name, due_date: isoDate(due),
        roas: launched ? String(c.roas ?? "") : null, spend: launched ? String(c.spend ?? "") : null,
        coda_url: `https://coda.io/d/glowdrip-demo#Row-${1000 + ci}`, coda_row_id: `demo-${1000 + ci}`,
        synced_at: today.toISOString(), coda_created_at: isoDate(new Date(today.getTime() - rand() * 20 * 86400000)),
      });
    }
  });

  // ── Briefs ───────────────────────────────────────────────────────────────────
  const topAds = [...creatives].sort((a, b) => Number(b.roas) - Number(a.roas));
  const briefDefs = [
    { name: "Glowdrip — Hydration UGC Sprint (Q3)", status: "approved", angle: "Hydration" },
    { name: "Glowdrip — Founder Story Refresh", status: "in_review", angle: "Dermatologist-backed" },
    { name: "Glowdrip — Before/After Concepts", status: "draft", angle: "Anti-aging" },
    { name: "Glowdrip — Sensitive Skin Testimonials", status: "draft", angle: "Sensitive skin" },
    { name: "Glowdrip — Clean Ingredients Explainer", status: "in_review", angle: "Clean ingredients" },
  ];
  const briefs = briefDefs.map((b) => {
    const refs = topAds.filter((c) => c.theme === b.angle).slice(0, 2).map((c) => c.ad_id);
    return {
      id: randomUUID(), account_id: ACCOUNT_ID, name: b.name, status: b.status,
      assignee_name: pick(["Maya R.", "Jenna K.", "Chloe T.", "Priya (Founder)"]),
      due_date: isoDate(new Date(today.getTime() + (5 + Math.floor(rand() * 20)) * 86400000)),
      reference_ad_ids: refs.length ? refs : [topAds[0].ad_id],
      share_token: hex(24),
      content: {
        objective: `Produce 3–5 ${b.angle.toLowerCase()} concepts that beat the current control on ROAS.`,
        angle: b.angle,
        hook_ideas: ["Open on the problem in the first 2s", "Lead with the 42k-review social proof", "Founder-to-camera cold open"],
        format: pick(["UGC", "Founder Story", "Testimonial", "Before/After"]),
        cta: pick(["Shop Now", "Get Offer", "Learn More"]),
        notes: "Keep it on-brand: warm, plain-spoken, sensitive-skin friendly.",
      },
    };
  });

  // ── Reports (computed from the seeded snapshot; mirrors the app's generator) ──
  function buildReport(name, days) {
    const start = new Date(today); start.setDate(today.getDate() - (days - 1));
    const totalSpend = round2(creatives.reduce((a, c) => a + Number(c.spend || 0), 0));
    const meanRoas = round2(creatives.reduce((a, c) => a + Number(c.roas || 0), 0) / creatives.length);
    const meanCpa = round2(creatives.reduce((a, c) => a + Number(c.cpa || 0), 0) / creatives.length);
    const meanCtr = round2(creatives.reduce((a, c) => a + Number(c.ctr || 0), 0) / creatives.length);
    const winRate = round2((creatives.filter((c) => Number(c.roas || 0) > 1).length / creatives.length) * 100);
    const sorted = [...creatives].sort((a, b) => Number(b.spend) - Number(a.spend));
    const perf = (c) => ({ ad_id: c.ad_id, ad_name: c.ad_name || c.ad_id, unique_code: c.unique_code, roas: round2(Number(c.roas || 0)), cpa: round2(Number(c.cpa || 0)), spend: round2(Number(c.spend || 0)), ctr: round2(Number(c.ctr || 0)) });
    return {
      id: randomUUID(), account_id: ACCOUNT_ID, report_name: name, report_type: "standard",
      creative_count: creatives.length, total_spend: totalSpend, blended_roas: meanRoas,
      average_cpa: meanCpa, average_ctr: meanCtr, win_rate: winRate,
      tags_manual_count: creatives.length, tags_parsed_count: 0, tags_csv_count: 0, tags_untagged_count: 0,
      top_performers: JSON.stringify(sorted.slice(0, 10).map(perf)),
      bottom_performers: JSON.stringify(sorted.slice(-5).map(perf)),
      date_range_start: isoDate(start), date_range_end: isoDate(today), date_range_days: days,
      is_public: false,
    };
  }
  const reports = [
    buildReport("Glowdrip — 30-Day Performance Review", 30),
    buildReport("Glowdrip — Last 7 Days", 7),
  ];

  // ── Plan summary ─────────────────────────────────────────────────────────────
  console.log(`  clusters (Entities):     ${clusters.length}  (${clusters.map((c) => c.label).slice(0, 3).join(", ")}${clusters.length > 3 ? ", …" : ""})`);
  console.log(`  creatives backfilled:    ${backfills.length}  (${Object.keys(backfills[0]?.payload || {}).join(", ") || "none"})`);
  console.log(`  coda_tasks (Pipeline):   ${codaTasks.length}  across ${STAGES.length} stages`);
  console.log(`  briefs:                  ${briefs.length}`);
  console.log(`  reports:                 ${reports.length}`);

  if (!EXECUTE) { console.log("\n  DRY RUN — no writes. Re-run with --execute to apply."); return; }

  // Clean any prior extras first (idempotent re-seed).
  await db.from("coda_tasks").delete().eq("account_id", ACCOUNT_ID);
  await db.from("briefs").delete().eq("account_id", ACCOUNT_ID);
  await db.from("reports").delete().eq("account_id", ACCOUNT_ID);
  if (await tableExists("creative_clusters")) await db.from("creative_clusters").delete().eq("account_id", ACCOUNT_ID);

  // Clusters first (creatives.cluster_id references them).
  if (cols.cluster_id && await tableExists("creative_clusters") && clusters.length) {
    const r = await insertRows("creative_clusters", clusters);
    console.log(`  ✓ creative_clusters: ${r.inserted}${r.dropped.length ? " (dropped " + r.dropped.join(",") + ")" : ""}`);
  } else { console.log("  (skip creative_clusters — table/cluster_id column absent)"); }

  // Per-creative backfill.
  let bf = 0;
  for (const b of backfills) {
    const { error } = await db.from("creatives").update(b.payload).eq("account_id", ACCOUNT_ID).eq("ad_id", b.ad_id);
    if (error) { console.error(`  ! backfill ${b.ad_id}: ${error.message}`); break; }
    bf++;
  }
  console.log(`  ✓ creatives backfilled: ${bf}/${backfills.length}`);

  const t1 = await insertRows("coda_tasks", codaTasks); console.log(`  ✓ coda_tasks: ${t1.inserted}${t1.dropped.length ? " (dropped " + t1.dropped.join(",") + ")" : ""}`);
  const t2 = await insertRows("briefs", briefs); console.log(`  ✓ briefs: ${t2.inserted}${t2.dropped.length ? " (dropped " + t2.dropped.join(",") + ")" : ""}`);
  const t3 = await insertRows("reports", reports); console.log(`  ✓ reports: ${t3.inserted}${t3.dropped.length ? " (dropped " + t3.dropped.join(",") + ")" : ""}`);

  console.log("\n  ✅ Extras seeded — Pipeline, Briefs, Reports, Landing Pages, Rotation, and Entities now have data.");
}

console.log(`Verdanote demo EXTRAS — ${EXECUTE ? "EXECUTE (will mutate)" : "DRY RUN"}${TEARDOWN ? " — TEARDOWN" : ""}`);
if (TEARDOWN) { await teardown(); } else { await seed(); }
