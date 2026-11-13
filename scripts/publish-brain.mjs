#!/usr/bin/env node
// Publish HQ knowledge into the app's Brain (story OS-014).
//
// HQ is the source. This reads the knowledge folder (read only), maps company, processes,
// clients and insights to the Handbook, Playbooks, Clients and Insights sections, and writes
// the brain_pages table as the service role. Rules live in scripts/publish-brain-lib.mjs.
//
// Re-running is safe: pages are matched on their source path; unchanged pages (same content
// hash) are not rewritten, changed pages are updated, and pages whose file is gone, or is now
// skipped, are removed. Slack capture is never published.
//
// Refuses any target other than the staging project unless --allow-production is passed.
//
//   --root <folder>     knowledge folder (default: the Goodo Studios HQ knowledge folder)
//   --dry-run           read and map everything and print the plan; write nothing. With the
//                       target variables set it also compares against the app (read only).
//   --allow-production  allow a target that is not the staging project
//
//   hq secrets exec --company goodo-studios \
//     --only TARGET_SUPABASE_URL,TARGET_SUPABASE_SERVICE_ROLE_KEY \
//     -- node scripts/publish-brain.mjs --dry-run
import { createClient } from '@supabase/supabase-js';
import {
  assertTarget, buildPages, diffPages, parseArgs, pendingFixes, readKnowledge, summariseSkips, unmatchedOwnerLines,
} from './publish-brain-lib.mjs';

const BATCH = 200;

function fail(message) {
  console.error(`FAILED ${message}`);
  process.exit(1);
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  fail(err.message);
}
if (opts.help) {
  console.log('Usage: node scripts/publish-brain.mjs [--root <folder>] [--dry-run] [--allow-production]');
  process.exit(0);
}

const targetUrl = process.env.TARGET_SUPABASE_URL;
const targetKey = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;
const canCompare = Boolean(targetUrl && targetKey);
if (!opts.dryRun || canCompare) {
  try {
    assertTarget(targetUrl, { allowProduction: opts.allowProduction });
  } catch (err) {
    fail(err.message);
  }
  if (!targetKey) fail('Set TARGET_SUPABASE_SERVICE_ROLE_KEY.');
}

let read;
try {
  read = await readKnowledge(opts.root);
} catch (err) {
  fail(`Could not read the knowledge folder: ${err.message}`);
}
const { pages, skipped, notes } = buildPages(read.files);
const allSkipped = [...read.skipped, ...skipped];

let existing = [];
let db = null;
if (canCompare || !opts.dryRun) {
  db = createClient(targetUrl, targetKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from('brain_pages').select('source_path, content_hash');
  if (error) fail(`Could not read brain_pages: ${error.message}`);
  existing = data ?? [];
}

const plan = diffPages(existing, pages);

if (!opts.dryRun) {
  // Remove first so a slug freed by a deleted or renamed file can be reused in this run.
  for (let i = 0; i < plan.remove.length; i += BATCH) {
    const { error } = await db.from('brain_pages').delete().in('source_path', plan.remove.slice(i, i + BATCH));
    if (error) fail(`Could not remove pages: ${error.message}`);
  }
  const writes = [...plan.add, ...plan.update].map((p) => ({ ...p, published_at: new Date().toISOString() }));
  for (let i = 0; i < writes.length; i += BATCH) {
    const { error } = await db.from('brain_pages').upsert(writes.slice(i, i + BATCH), { onConflict: 'source_path' });
    if (error) fail(`Could not write pages: ${error.message}`);
  }
}

const bySection = new Map();
for (const p of pages) bySection.set(p.section, (bySection.get(p.section) ?? 0) + 1);

console.log(opts.dryRun ? 'Dry run: nothing was written.' : 'Published.');
if (opts.dryRun && !canCompare) console.log('No target set, so every page counts as added.');
console.log(`Pages: ${pages.length} (${[...bySection.entries()].map(([s, n]) => `${s} ${n}`).join(', ') || 'none'})`);
console.log(`Added ${plan.add.length}, updated ${plan.update.length}, unchanged ${plan.unchanged}, removed ${plan.remove.length}`);
console.log(`Skipped ${allSkipped.length}:`);
for (const [reason, count] of summariseSkips(allSkipped)) console.log(`  ${count}  ${reason}`);
// OS-016: match page owners to staff logins again (names may have changed since the last run),
// report the owners that match nobody, and list accepted fixes still to apply in HQ.
if (db) {
  if (!opts.dryRun) {
    const { data, error } = await db.rpc('rematch_brain_page_owners');
    if (error) console.log(`Could not match owners to logins: ${error.message}`);
    else {
      const lines = unmatchedOwnerLines(data);
      console.log(`Owners with no staff login ${lines.length}${lines.length ? ' (their pages show on nobody\'s Today page):' : ''}`);
      for (const line of lines) console.log(line);
    }
  }
  const [{ data: fixes, error: fixError }, { data: current, error: pageError }] = await Promise.all([
    db.from('brain_page_corrections').select('id, brain_page_id, source_path, page_content_hash, reason, created_at, brain_page_correction_reviews(decision)'),
    db.from('brain_pages').select('id, content_hash'),
  ]);
  if (fixError || pageError) console.log(`Could not read suggested fixes: ${(fixError ?? pageError).message}`);
  else {
    const pending = pendingFixes(fixes, current);
    console.log(`Accepted fixes to apply in HQ ${pending.length}${pending.length ? ':' : ''}`);
    for (const f of pending) console.log(`  ${f.source_path}: ${f.reason}`);
  }
}
const noteCounts = summariseSkips(notes.map((n) => ({ reason: n.note })));
if (noteCounts.length) {
  console.log('Published with a fallback:');
  for (const [note, count] of noteCounts) console.log(`  ${count}  ${note}`);
  for (const n of notes) console.log(`    ${n.path}: ${n.note}`);
}
