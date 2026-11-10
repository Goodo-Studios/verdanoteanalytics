// Dry-run default, owner-decision gate and seed-aware checksums of the
// dashboard copy (step 5a). The older guard tests are in dashboard-copy-lib.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DASHBOARD_REF, PRODUCTION_REF, TABLES, parseArgs, runMode, assertWriteAllowed, seedFilter, checksumSql, clearSql, renderPlan,
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
  assert.throws(() => parseArgs(['--target', PRODUCTION_REF]), /unknown option/);
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
  assert.match(r.stdout, /dashboard_creators \(key id\)  from creators/);
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
