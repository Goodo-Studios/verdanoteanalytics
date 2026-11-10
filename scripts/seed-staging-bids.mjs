#!/usr/bin/env node
// Seed the made-up demo BID for the read-only BID viewer in Verdanote STAGING (step 6).
// See scripts/seed-staging-bids-lib.mjs for what is written.
//
// Refuses any project other than verdanote-staging. Idempotent: import_client_bid returns the
// existing version when the same body was imported before, so a re-run writes nothing new.
// Run scripts/seed-staging-dashboard.mjs first (it creates the demo client).
//
//   hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_SERVICE_ROLE_KEY \
//     -- node scripts/seed-staging-bids.mjs
import { createClient } from '@supabase/supabase-js';
import { assertStagingUrl, buildDemoBid } from './seed-staging-bids-lib.mjs';

const url = process.env.STAGING_SUPABASE_URL;
const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
assertStagingUrl(url);
if (!key) {
  console.error('Set STAGING_SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const bid = buildDemoBid();
const { data, error } = await db.rpc('import_client_bid', bid);
if (error) {
  console.error(`FAILED import_client_bid: ${error.message}`);
  process.exit(1);
}
console.log(`ok  client_bids ${bid.p_client_slug} version ${data}`);
