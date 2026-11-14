#!/usr/bin/env node
// Staff list reconciliation report for staging (step 5d). Signs in as the staging test
// builder, reads staff_reconciliation() and prints counts per issue only (no names, no
// emails). Writes nothing.
//
//   hq secrets exec --company goodo-studios --only STAGING_SUPABASE_URL,STAGING_SUPABASE_ANON_KEY,STAGING_TEST_PASSWORD \
//     -- node scripts/staff-reconciliation-report.mjs
//
// The people behind each count are on the Team page (builders only).
import { createClient } from "@supabase/supabase-js";
import { assertNotProduction, countIssues, formatReport } from "./staff-reconciliation-lib.mjs";

const url = process.env.STAGING_SUPABASE_URL;
const anon = process.env.STAGING_SUPABASE_ANON_KEY;
const password = process.env.STAGING_TEST_PASSWORD;
try {
  assertNotProduction(url);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
if (!anon || !password) {
  console.error("Set STAGING_SUPABASE_ANON_KEY and STAGING_TEST_PASSWORD.");
  process.exit(1);
}

const c = createClient(url, anon, { auth: { persistSession: false } });
const { error: signInError } = await c.auth.signInWithPassword({ email: "builder@staging.verdanote.test", password });
if (signInError) {
  console.error(`sign-in failed: ${signInError.message}`);
  process.exit(1);
}
const { data, error } = await c.rpc("staff_reconciliation");
if (error) {
  console.error(`staff_reconciliation failed: ${error.code ?? ""} ${error.message}`);
  process.exit(1);
}
console.log(formatReport(countIssues(data)));
