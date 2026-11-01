#!/usr/bin/env node
// One-time, read-only copy of the old dashboard's data into verdanote-staging.
// See docs/dashboard-copy.md for the full procedure.
//
//   hq secrets exec --company goodo-studios \
//     --only SUPABASE_ACCESS_TOKEN,VERDANOTE_STAGING_SUPABASE_ACCESS_TOKEN -- \
//     node scripts/dashboard-copy.mjs --confirm-source qlvdvpchriyrsjtewwxx --report report.md
//
// Options:
//   --confirm-source <ref>  required; must equal the old dashboard project ref
//   --report <path>         where to write the markdown report (default: stdout)
//   --replace               empty the copied tables in staging first (staging only)
//   --counts-only           read row counts and checksums from both sides, write nothing
//   --page <n>              rows per request (default 400)
//
// The old dashboard is only ever read, through the Supabase read-only query
// endpoint (runs as supabase_read_only_user). The target is hard wired to the
// verdanote-staging project; the script refuses anything else.

import fs from 'node:fs';
import {
  DASHBOARD_REF, STAGING_REF, TABLES, sourceName, assertTargets, makeSourceClient, makeTargetClient,
  checksumSql, pageSql, insertSql, clearSql, counterSql, renderReport,
} from './dashboard-copy-lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);

const confirmSource = opt('confirm-source');
const reportPath = opt('report');
const pageSize = Number(opt('page', 400));
const countsOnly = flag('counts-only');

console.error(`Source (read only): old dashboard project ${DASHBOARD_REF}`);
console.error(`Target (writes):    verdanote-staging project ${STAGING_REF}${countsOnly ? ' (counts only, no writes)' : ''}`);

assertTargets({ sourceRef: DASHBOARD_REF, targetRef: STAGING_REF, confirmSource });

const src = makeSourceClient({ token: process.env.SUPABASE_ACCESS_TOKEN });
const dst = makeTargetClient({ token: process.env.VERDANOTE_STAGING_SUPABASE_ACCESS_TOKEN });

const startedAt = new Date().toISOString();
const notes = [];

if (!countsOnly && flag('replace')) {
  console.error('Emptying copied tables in staging...');
  await dst.query(clearSql(TABLES.map(([t]) => t)));
}

for (const [target, pk] of TABLES) {
  if (countsOnly) break;
  const source = sourceName(target);
  let offset = 0;
  let copied = 0;
  for (;;) {
    const page = await src.query(pageSql(source, pk, pageSize, offset));
    if (!page.length) break;
    await dst.query(insertSql(target, page.map((p) => p.row)));
    copied += page.length;
    offset += page.length;
    if (page.length < pageSize) break;
  }
  console.error(`copied ${source} -> ${target}: ${copied} rows`);
}

// Ad code counter: staging never goes below the live value.
const srcCounter = (await src.query('select value from public.ad_name_counter where id = 1'))[0]?.value ?? null;
if (!countsOnly && srcCounter !== null) await dst.query(counterSql(srcCounter));
const dstCounter = (await dst.query('select value from public.ad_name_counter where id = 1'))[0]?.value ?? null;

// Compare row counts and content checksums table by table.
const rows = [];
for (const [target, pk] of TABLES) {
  const source = sourceName(target);
  const [s] = await src.query(checksumSql(source, pk));
  const [d] = await dst.query(checksumSql(target, pk));
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

notes.push('Triggers were switched off during the load so stored values were copied, not recomputed.');
notes.push('Row counts and a checksum of every row, ordered by primary key, were compared on both sides.');
const report = renderReport({ startedAt, rows, counter: { source: srcCounter, target: dstCounter }, roles, storage, notes });
if (reportPath) fs.writeFileSync(reportPath, report);
else process.stdout.write(report);

const bad = rows.filter((r) => !r.match);
if (bad.length) {
  console.error(`MISMATCH in ${bad.length} table(s): ${bad.map((b) => b.target).join(', ')}`);
  process.exit(1);
}
console.error('All tables match.');
