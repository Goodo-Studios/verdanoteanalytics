#!/usr/bin/env node
// Read-only copy of the old dashboard's data into Verdanote: staging by default,
// production behind explicit confirmation. See docs/dashboard-copy.md.
//
// Dry run by default:
//
//   node scripts/dashboard-copy.mjs
//     prints the plan; no network, no credentials needed.
//
//   hq secrets exec --company goodo-studios \
//     --only SUPABASE_ACCESS_TOKEN,VERDANOTE_STAGING_SUPABASE_ACCESS_TOKEN -- \
//     node scripts/dashboard-copy.mjs --confirm-source qlvdvpchriyrsjtewwxx --report report.md
//     reads row counts and checksums from both sides; writes nothing.
//
//   ... --confirm-source qlvdvpchriyrsjtewwxx --write --real-client-data-approved
//     copies into staging. Only after Matthew decides to copy real client data
//     into staging (decision 10 in the consolidation plan).
//
// Production (step 7 of the release):
//
//   1. Dry run:  --target production --confirm-source qlvdvpchriyrsjtewwxx
//      Reads counts and checksums from the old dashboard and from production
//      (production through the read-only endpoint, so it cannot change anything),
//      prints the row counts per table and leaves a receipt.
//   2. Copy:     --target production --confirm-production gwyxaqoaldnaavkjqquv \
//                --confirm-source qlvdvpchriyrsjtewwxx --write --real-client-data-approved
//      Refused unless the receipt from step 1 is for the same source and target
//      and no older than 120 minutes. A successful copy consumes the receipt.
//      Production uses SUPABASE_ACCESS_TOKEN (never the staging token).
//
// Options:
//   --target <staging|production>   default staging
//   --confirm-source <ref>          must equal the old dashboard project ref
//   --confirm-production <ref>      with --write on production: the exact production project ref
//   --write                         copy rows (otherwise nothing is written)
//   --real-client-data-approved     required with --write (owner decision 10)
//   --replace                       with --write on staging: empty the copied tables first (never clients; refused on production)
//   --receipt <path>                dry-run receipt file (default: a file in the temp folder)
//   --report <path>                 where to write the markdown report (default: stdout)
//   --page <n>                      rows per request (default 400)
//
// The old dashboard is only ever read, through the Supabase read-only query
// endpoint (runs as supabase_read_only_user). Loading is idempotent (on conflict
// do nothing, ad code counter raised with greatest), so a repeated --write adds
// nothing twice. Rows already in production are never overwritten.

import fs from 'node:fs';
import {
  DASHBOARD_REF, TABLES, sourceName, assertTargets, makeSourceClient, makeTargetClient, targetRefFor,
  checksumSql, pageSql, insertSql, clearSql, counterSql, renderReport, renderPlan,
  parseArgs, runMode, assertWriteAllowed, seedFilter, buildReceipt, assertReceipt, defaultReceiptPath,
} from './dashboard-copy-lib.mjs';

let args;
try {
  args = parseArgs(process.argv.slice(2));
  assertWriteAllowed(args);
} catch (e) {
  console.error(String(e.message));
  process.exit(2);
}
const mode = runMode(args);

if (mode === 'plan') {
  process.stdout.write(renderPlan());
  process.exit(0);
}

const targetRef = targetRefFor(args.target);
const isProduction = args.target === 'production';
const receiptPath = args.receipt || defaultReceiptPath(args.target);

try {
  assertTargets({ sourceRef: DASHBOARD_REF, targetRef, confirmSource: args.confirmSource, confirmProduction: args.confirmProduction });
  // A production copy needs a fresh dry-run receipt. Checked before any network call.
  if (isProduction && mode === 'write') {
    let receipt = null;
    try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch { /* reported by assertReceipt */ }
    assertReceipt(receipt, { sourceRef: DASHBOARD_REF, targetRef });
  }
} catch (e) {
  console.error(String(e.message));
  process.exit(2);
}

console.error(`Source (read only): old dashboard project ${DASHBOARD_REF}`);
console.error(`Target:             ${isProduction ? 'VERDANOTE PRODUCTION' : 'verdanote-staging'} project ${targetRef}${mode === 'write' ? ' (WRITES)' : ' (dry run, counts only, no writes)'}`);

const src = makeSourceClient({ token: process.env.SUPABASE_ACCESS_TOKEN });
const dst = makeTargetClient({
  token: isProduction ? process.env.SUPABASE_ACCESS_TOKEN : process.env.VERDANOTE_STAGING_SUPABASE_ACCESS_TOKEN,
  ref: targetRef,
  confirmProduction: args.confirmProduction,
  write: mode === 'write',
});

const startedAt = new Date().toISOString();
const notes = [];

if (mode === 'write') {
  if (args.replace) {
    console.error('Emptying copied tables in staging (clients are kept)...');
    await dst.query(clearSql(TABLES.map(([t]) => t)));
  }
  for (const [target, pk] of TABLES) {
    const source = sourceName(target);
    let offset = 0;
    let copied = 0;
    for (;;) {
      const page = await src.query(pageSql(source, pk, args.page, offset));
      if (!page.length) break;
      await dst.query(insertSql(target, page.map((p) => p.row)));
      copied += page.length;
      offset += page.length;
      if (page.length < args.page) break;
    }
    console.error(`copied ${source} -> ${target}: ${copied} rows read`);
  }
}

// Ad code counter: the target never goes below the live value. Staging is raised
// here. Production is left alone: scripts/ad-code-counter.mjs raises it at the
// moment the old generators are switched off (step 9), because the old counter
// keeps moving until then.
const srcCounter = (await src.query('select value from public.ad_name_counter where id = 1'))[0]?.value ?? null;
if (mode === 'write' && !isProduction && srcCounter !== null) await dst.query(counterSql(srcCounter));
const dstCounter = (await dst.query('select value from public.ad_name_counter where id = 1'))[0]?.value ?? null;

// Compare row counts and content checksums table by table. Rows of the made-up
// staging seed are left out on the staging side.
const rows = [];
for (const [target, pk] of TABLES) {
  const source = sourceName(target);
  const [s] = await src.query(checksumSql(source, pk));
  const [d] = await dst.query(checksumSql(target, pk, seedFilter(target, args.target)));
  rows.push({ source, target, sourceCount: s.n, targetCount: d.n, match: s.n === d.n && s.sum === d.sum });
}

// Row counts per table, on stderr so the report on stdout stays clean.
console.error('\ntable | source rows | target rows | match');
for (const r of rows) console.error(`${r.target} | ${r.sourceCount} | ${r.targetCount} | ${r.match ? 'yes' : 'NO'}`);
console.error('');

// Team roles: counts only, no names or emails.
const roleRows = await src.query('select role, count(*)::int as n from public.app_users group by role order by role');
const loginRows = await dst.query(
  `select au.role, count(u.id)::int as with_login from public.app_users au left join auth.users u on lower(u.email) = lower(au.email) group by au.role`
);
const roleMap = { admin: 'builder', producer: 'employee' };
const roles = roleRows.map((r) => ({
  role: r.role, n: r.n, mapped: roleMap[r.role], with_login: loginRows.find((l) => l.role === r.role)?.with_login ?? 0,
}));

// Storage inventory feeds the file copy plan (docs/dashboard-storage-copy-plan.md).
let storage = [];
try {
  storage = await src.query(
    `select bucket_id, count(*)::int as files, coalesce(sum((metadata->>'size')::bigint), 0) as bytes from storage.objects group by bucket_id order by bucket_id`
  );
} catch (e) {
  notes.push(`Storage inventory not read: ${String(e.message).slice(0, 120)}`);
}

if (mode === 'write') notes.push('Triggers were switched off during the load so stored values were copied, not recomputed.');
else notes.push('Dry run: nothing was written. Counts and checksums show the difference a --write would close.');
if (isProduction) notes.push('Production rows that already exist are kept as they are (on conflict do nothing); a table can show a different count or checksum when production held rows of its own, for example clients created by hand. Read those lines before the real run.');
else notes.push('Row counts and a checksum of every row, ordered by primary key, were compared on both sides. Made-up seed rows in staging are left out.');
const report = renderReport({ startedAt, rows, counter: { source: srcCounter, target: dstCounter }, roles, storage, notes, target: args.target });
if (args.report) fs.writeFileSync(args.report, report);
else process.stdout.write(report);

if (mode === 'counts') {
  fs.writeFileSync(receiptPath, JSON.stringify(buildReceipt({ sourceRef: DASHBOARD_REF, targetRef, rows }), null, 2) + '\n');
  console.error(`Dry-run receipt written to ${receiptPath} (valid for 120 minutes, for the same source and target only).`);
}

const bad = rows.filter((r) => !r.match);
if (mode === 'write') {
  if (isProduction) {
    try { fs.unlinkSync(receiptPath); console.error('Dry-run receipt used up. Run the dry run again before another real copy.'); } catch { /* already gone */ }
  }
  if (bad.length) {
    console.error(`MISMATCH in ${bad.length} table(s): ${bad.map((b) => b.target).join(', ')}`);
    process.exit(1);
  }
} else if (bad.length) {
  console.error(`Differs (dry run) in ${bad.length} table(s): ${bad.map((b) => b.target).join(', ')}`);
  process.exit(0);
}
console.error('All tables match.');
