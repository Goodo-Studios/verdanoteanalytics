#!/usr/bin/env node
// One-time, read-only copy of the old dashboard's data into verdanote-staging.
// See docs/dashboard-copy.md for the full procedure.
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
//     copies. Only after Matthew decides to copy real client data into staging
//     (decision 10 in the consolidation plan; the default is made-up test
//     clients only).
//
// Options:
//   --confirm-source <ref>        must equal the old dashboard project ref
//   --write                       copy rows (otherwise nothing is written)
//   --real-client-data-approved   required with --write (owner decision 10)
//   --replace                     with --write: empty the copied tables in staging first (never clients)
//   --report <path>               where to write the markdown report (default: stdout)
//   --page <n>                    rows per request (default 400)
//
// The old dashboard is only ever read, through the Supabase read-only query
// endpoint (runs as supabase_read_only_user). The target is hard wired to the
// verdanote-staging project; the script refuses anything else. Loading is
// idempotent (on conflict do nothing), so a repeated --write adds nothing twice.

import fs from 'node:fs';
import {
  DASHBOARD_REF, STAGING_REF, TABLES, sourceName, assertTargets, makeSourceClient, makeTargetClient,
  checksumSql, pageSql, insertSql, clearSql, counterSql, renderReport, renderPlan,
  parseArgs, runMode, assertWriteAllowed, seedFilter,
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

console.error(`Source (read only): old dashboard project ${DASHBOARD_REF}`);
console.error(`Target:             verdanote-staging project ${STAGING_REF}${mode === 'write' ? ' (WRITES)' : ' (dry run, counts only, no writes)'}`);

assertTargets({ sourceRef: DASHBOARD_REF, targetRef: STAGING_REF, confirmSource: args.confirmSource });

const src = makeSourceClient({ token: process.env.SUPABASE_ACCESS_TOKEN });
const dst = makeTargetClient({ token: process.env.VERDANOTE_STAGING_SUPABASE_ACCESS_TOKEN });

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
    console.error(`copied ${source} -> ${target}: ${copied} rows`);
  }
}

// Ad code counter: staging never goes below the live value.
const srcCounter = (await src.query('select value from public.ad_name_counter where id = 1'))[0]?.value ?? null;
if (mode === 'write' && srcCounter !== null) await dst.query(counterSql(srcCounter));
const dstCounter = (await dst.query('select value from public.ad_name_counter where id = 1'))[0]?.value ?? null;

// Compare row counts and content checksums table by table. Rows of the made-up
// staging seed are left out on the staging side.
const rows = [];
for (const [target, pk] of TABLES) {
  const source = sourceName(target);
  const [s] = await src.query(checksumSql(source, pk));
  const [d] = await dst.query(checksumSql(target, pk, seedFilter(target)));
  rows.push({ source, target, sourceCount: s.n, targetCount: d.n, match: s.n === d.n && s.sum === d.sum });
}

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
notes.push('Row counts and a checksum of every row, ordered by primary key, were compared on both sides. Made-up seed rows in staging are left out.');
const report = renderReport({ startedAt, rows, counter: { source: srcCounter, target: dstCounter }, roles, storage, notes });
if (args.report) fs.writeFileSync(args.report, report);
else process.stdout.write(report);

const bad = rows.filter((r) => !r.match);
if (bad.length) {
  console.error(`${mode === 'write' ? 'MISMATCH' : 'Differs (dry run)'} in ${bad.length} table(s): ${bad.map((b) => b.target).join(', ')}`);
  process.exit(mode === 'write' ? 1 : 0);
}
console.error('All tables match.');
