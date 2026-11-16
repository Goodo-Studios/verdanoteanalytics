// Dry-run default, owner-decision gate and seed-aware checksums of the
// dashboard copy (step 5a). The older guard tests are in dashboard-copy-lib.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  DASHBOARD_REF, PRODUCTION_REF, STAGING_REF, TABLES, parseArgs, runMode, assertWriteAllowed, seedFilter, checksumSql, clearSql, renderPlan,
  buildReceipt, assertReceipt, tableFingerprint, RECEIPT_MAX_AGE_MINUTES, targetRefFor,
} from './dashboard-copy-lib.mjs';
import { SEED_MARKERS } from './seed-staging-dashboard-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'dashboard-copy.mjs');
const run = (args) => spawnSync(process.execPath, [script, ...args], {
  encoding: 'utf8',
  env: { PATH: process.env.PATH },
  timeout: 20000,
});

test('no flags is a dry run that only prints the plan', () => {
  const args = parseArgs([]);
  assert.equal(runMode(args), 'plan');
  assert.doesNotThrow(() => assertWriteAllowed(args));
});

test('--confirm-source alone reads counts and writes nothing', () => {
  assert.equal(runMode(parseArgs(['--confirm-source', DASHBOARD_REF])), 'counts');
});

test('--write needs the source confirmation and the owner approval flag', () => {
  assert.throws(() => assertWriteAllowed(parseArgs(['--write'])), /confirm-source/);
  assert.throws(() => assertWriteAllowed(parseArgs(['--write', '--confirm-source', DASHBOARD_REF])), /Decision 10/);
  assert.throws(() => assertWriteAllowed(parseArgs(['--write', '--confirm-source', 'wrong', '--real-client-data-approved'])), /confirm-source/);
  const ok = parseArgs(['--write', '--confirm-source', DASHBOARD_REF, '--real-client-data-approved']);
  assert.doesNotThrow(() => assertWriteAllowed(ok));
  assert.equal(runMode(ok), 'write');
});

test('unknown options, stray values, --replace without --write and project refs in paths are refused', () => {
  assert.throws(() => parseArgs(['--target', PRODUCTION_REF]), /a name, not a project ref/);
  assert.throws(() => parseArgs(['--target', 'dashboard']), /staging or production/);
  assert.throws(() => parseArgs(['--counts-only']), /unknown option/);
  assert.throws(() => parseArgs([PRODUCTION_REF]), /unexpected argument/);
  assert.throws(() => parseArgs(['--replace']), /only makes sense with --write/);
  assert.throws(() => parseArgs(['--report', `/tmp/${PRODUCTION_REF}.md`]), /project ref/);
  assert.throws(() => parseArgs(['--page', '0']), /whole number/);
  assert.throws(() => parseArgs(['--confirm-source']), /needs a value/);
});

test('the script with no flags exits 0, prints the plan and needs no credentials', () => {
  const r = run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry run, nothing read or written/);
  assert.match(r.stdout, /dashboard_creators \(key id\) {2}from creators/);
});

test('the script refuses --write without the owner approval before any network call', () => {
  const r = run(['--write', '--confirm-source', DASHBOARD_REF]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Decision 10/);
});

test('every seed marker names a copied table and the checksum leaves those rows out', () => {
  const copied = new Set(TABLES.map(([t]) => t));
  for (const table of Object.keys(SEED_MARKERS)) {
    assert.ok(copied.has(table), table);
    assert.match(checksumSql(table, ['id'], seedFilter(table)), new RegExp(`where not \\(${SEED_MARKERS[table].sql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`));
  }
  // A copied table the seed does not write (creator_videos) gets no filter.
  assert.equal(SEED_MARKERS.creator_videos, undefined);
  assert.ok(!checksumSql('creator_videos', ['id'], seedFilter('creator_videos')).includes('where'));
});

test('--replace never empties clients', () => {
  const sql = clearSql(TABLES.map(([t]) => t));
  assert.ok(!sql.includes('delete from public.clients;'));
  assert.ok(sql.includes('delete from public.creator_assignments;'));
});

test('the plan names the owner decision and the refused production project', () => {
  const p = renderPlan();
  assert.match(p, /decision 10/);
  assert.ok(p.includes(PRODUCTION_REF));
  assert.match(p, /clients \(key slug\).*never emptied by --replace/);
});

// ---------------------------------------------------------------- production target

const prodWrite = ['--target', 'production', '--confirm-source', DASHBOARD_REF, '--write', '--real-client-data-approved'];

test('staging stays the default target and stays refused for a production confirmation', () => {
  assert.equal(parseArgs([]).target, 'staging');
  assert.equal(targetRefFor('staging'), STAGING_REF);
  assert.equal(targetRefFor('production'), PRODUCTION_REF);
  const r = run(['--confirm-source', DASHBOARD_REF, '--confirm-production', PRODUCTION_REF]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /only goes with --target production/);
});

test('--write on production is refused without every confirmation, before any network call', () => {
  const refused = (extra, pattern) => {
    assert.throws(() => assertWriteAllowed(parseArgs(extra)), pattern, extra.join(' '));
  };
  refused(['--target', 'production', '--write'], /confirm-source/);
  refused(['--target', 'production', '--confirm-source', DASHBOARD_REF, '--write', '--real-client-data-approved'], /--confirm-production/);
  refused(['--target', 'production', '--confirm-source', DASHBOARD_REF, '--confirm-production', 'wrong', '--write', '--real-client-data-approved'], /--confirm-production/);
  refused(['--target', 'production', '--confirm-source', DASHBOARD_REF, '--confirm-production', STAGING_REF, '--write', '--real-client-data-approved'], /--confirm-production/);
  refused(['--target', 'production', '--confirm-source', DASHBOARD_REF, '--confirm-production', PRODUCTION_REF, '--write'], /Decision 10/);
  assert.doesNotThrow(() => assertWriteAllowed(parseArgs([...prodWrite, '--confirm-production', PRODUCTION_REF])));
  const r = run(prodWrite);
  assert.equal(r.status, 2);
  assert.match(r.stderr, new RegExp(`--confirm-production ${PRODUCTION_REF}`));
});

test('--replace is refused on production', () => {
  assert.throws(() => parseArgs([...prodWrite, '--confirm-production', PRODUCTION_REF, '--replace']), /never allowed on production/);
});

test('a production write with every flag still stops without a dry-run receipt', () => {
  const missing = path.join(os.tmpdir(), `no-such-receipt-${process.pid}.json`);
  const r = run([...prodWrite, '--confirm-production', PRODUCTION_REF, '--receipt', missing]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no dry-run receipt found/);
  assert.ok(!r.stderr.includes('Source (read only)'), 'the network section was not reached');
});

test('a stale, mismatched or foreign receipt is refused and a fresh one passes', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const base = { sourceRef: DASHBOARD_REF, targetRef: PRODUCTION_REF };
  const fresh = buildReceipt({ ...base, now: new Date('2026-11-15T11:30:00Z'), rows: [{ target: 'actors', sourceCount: 3, targetCount: 0 }] });
  assert.doesNotThrow(() => assertReceipt(fresh, { ...base, now }));
  const old = buildReceipt({ ...base, now: new Date(now.getTime() - (RECEIPT_MAX_AGE_MINUTES + 1) * 60000), rows: [] });
  assert.throws(() => assertReceipt(old, { ...base, now }), /older than 120 minutes/);
  assert.throws(() => assertReceipt(fresh, { ...base, targetRef: STAGING_REF, now }), /different source or target/);
  assert.throws(() => assertReceipt(fresh, { sourceRef: PRODUCTION_REF, targetRef: PRODUCTION_REF, now }), /different source or target/);
  assert.throws(() => assertReceipt({ ...fresh, tables: 'changed' }, { ...base, now }), /table list changed/);
  assert.throws(() => assertReceipt({ ...fresh, createdAt: '2027-01-01T00:00:00Z' }, { ...base, now }), /invalid time/);
  assert.throws(() => assertReceipt({ ...fresh, createdAt: 'nope' }, { ...base, now }), /invalid time/);
  assert.throws(() => assertReceipt(null, { ...base, now }), /no dry-run receipt/);
  assert.throws(() => assertReceipt({ kind: 'something-else' }, { ...base, now }), /no dry-run receipt/);
  assert.equal(fresh.tables, tableFingerprint());
  assert.deepEqual(fresh.counts, [{ table: 'actors', source: 3, target: 0 }]);
});

test('the script itself refuses a stale receipt file', () => {
  const file = path.join(os.tmpdir(), `stale-receipt-${process.pid}.json`);
  const stale = buildReceipt({ sourceRef: DASHBOARD_REF, targetRef: PRODUCTION_REF, now: new Date('2020-01-01T00:00:00Z'), rows: [] });
  fs.writeFileSync(file, JSON.stringify(stale));
  try {
    const r = run([...prodWrite, '--confirm-production', PRODUCTION_REF, '--receipt', file]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /older than 120 minutes/);
  } finally { fs.unlinkSync(file); }
});

test('production has no seed filter and the plan names the production rules', () => {
  assert.equal(seedFilter('clients', 'production'), null);
  assert.equal(seedFilter('actors', 'production'), null);
  assert.equal(typeof seedFilter('clients', 'staging'), 'string');
  const p = renderPlan();
  assert.match(p, /--target production --confirm-production/);
  assert.match(p, /receipt/);
});
