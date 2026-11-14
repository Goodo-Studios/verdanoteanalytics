#!/usr/bin/env node
// Seed made-up test clients for the old dashboard pages in Verdanote STAGING.
// See scripts/seed-staging-dashboard-lib.mjs for what is written.
//
// Refuses any project other than verdanote-staging. Idempotent: fixed ids and
// upserts, so a re-run updates the same rows (follow-up dates move with today).
// Run scripts/seed-demo-account.mjs and scripts/seed-staging-users.mjs first.
//
//   hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_SERVICE_ROLE_KEY \
//     -- node scripts/seed-staging-dashboard.mjs
import { createClient } from '@supabase/supabase-js';
import { SEED_ORDER, assertStagingUrl, buildDashboardSeed } from './seed-staging-dashboard-lib.mjs';

const url = process.env.STAGING_SUPABASE_URL;
const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
assertStagingUrl(url);
if (!key) {
  console.error('Set STAGING_SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const seed = buildDashboardSeed(new Date());

for (const [table, onConflict] of SEED_ORDER) {
  const rows = seed[table];
  const { error } = await db.from(table).upsert(rows, { onConflict });
  if (error) {
    console.error(`FAILED ${table}: ${error.message}`);
    process.exit(1);
  }
  console.log(`ok  ${table.padEnd(20)} ${rows.length} rows`);
}
