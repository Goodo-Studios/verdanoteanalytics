import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DASHBOARD_REF, STAGING_REF, PRODUCTION_REF, TABLES, assertTargets, isReadOnlySql, makeSourceClient, makeTargetClient,
  insertSql, dollarQuote, clearSql, counterSql, checksumSql, renderReport, sourceName,
} from './dashboard-copy-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(here, '../supabase/migrations/20261101000001_dashboard_tables.sql'), 'utf8');

test('copies exactly the 32 tables the migration creates', () => {
  const created = [...migration.matchAll(/create table public\.(\w+) \(/g)].map((m) => m[1]).sort();
  assert.equal(created.length, 32);
  assert.deepEqual(TABLES.map(([t]) => t).sort(), created);
});

test('never includes the public form support tables', () => {
  const names = TABLES.map(([t]) => t);
  for (const n of ['public_error_reports', 'upload_url_rate_limits', 'actor_upload_url_rate_limits']) assert.ok(!names.includes(n));
});

test('parents are loaded before children', () => {
  const pos = Object.fromEntries(TABLES.map(([t], i) => [t, i]));
  for (const m of migration.matchAll(/alter table public\.(\w+) add constraint \w+ FOREIGN KEY \([^)]*\) REFERENCES (?:public\.)?(\w+)\(/g)) {
    assert.ok(pos[m[2]] < pos[m[1]], `${m[2]} must load before ${m[1]}`);
  }
});

test('primary keys match the migration', () => {
  for (const [t, pk] of TABLES) {
    const block = migration.match(new RegExp(`create table public\\.${t} \\(([\\s\\S]*?)\\n\\);`))[1];
    const m = block.match(/PRIMARY KEY \(([^)]*)\)/);
    assert.deepEqual(m[1].split(',').map((s) => s.trim()), pk, t);
  }
});

test('creators is renamed to dashboard_creators', () => {
  assert.equal(sourceName('dashboard_creators'), 'creators');
  assert.equal(sourceName('actors'), 'actors');
});

test('refuses production, the old dashboard as a target, and unknown projects', () => {
  const ok = { sourceRef: DASHBOARD_REF, targetRef: STAGING_REF, confirmSource: DASHBOARD_REF };
  assert.doesNotThrow(() => assertTargets(ok));
  assert.throws(() => assertTargets({ ...ok, targetRef: PRODUCTION_REF }), /production/);
  assert.throws(() => assertTargets({ ...ok, targetRef: DASHBOARD_REF }), /old dashboard/);
  assert.throws(() => assertTargets({ ...ok, targetRef: 'abcdefghijklmnopqrst' }), /staging/);
  assert.throws(() => assertTargets({ ...ok, sourceRef: PRODUCTION_REF }), /source/);
});

test('needs the explicit confirmation flag before reading the old dashboard', () => {
  const base = { sourceRef: DASHBOARD_REF, targetRef: STAGING_REF };
  assert.throws(() => assertTargets({ ...base, confirmSource: undefined }), /confirm-source/);
  assert.throws(() => assertTargets({ ...base, confirmSource: 'wrong' }), /confirm-source/);
});

test('source client only sends selects, to the read-only endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body).query }); return { status: 201, text: async () => '[]' }; };
  const c = makeSourceClient({ token: 't', fetchImpl });
  await c.query('select 1');
  assert.match(calls[0].url, /\/database\/query\/read-only$/);
  for (const bad of ['delete from public.clients', 'update public.clients set name = 1', 'select 1; drop table public.clients', 'insert into x select 1', 'truncate public.clients']) {
    await assert.rejects(() => c.query(bad), /only runs select/, bad);
  }
  assert.equal(calls.length, 1);
});

test('target client is staging only', () => {
  assert.throws(() => makeTargetClient({ token: 't', ref: PRODUCTION_REF }), /staging only/);
  assert.throws(() => makeTargetClient({ token: 't', ref: DASHBOARD_REF }), /staging only/);
  assert.doesNotThrow(() => makeTargetClient({ token: 't' }));
});

test('insert SQL switches triggers off, is idempotent and survives hostile data', () => {
  const rows = [{ id: 1, note: "it's $dc$ tricky $$" }];
  const sql = insertSql('actors', rows);
  assert.match(sql, /session_replication_role = replica/);
  assert.match(sql, /on conflict do nothing/);
  const q = dollarQuote(JSON.stringify(rows));
  assert.ok(sql.includes(q));
  assert.notEqual(q.split('$')[1], 'dc');
  assert.throws(() => insertSql('actors; drop table x', rows), /unsafe identifier/);
});

test('clear SQL deletes children before parents', () => {
  const sql = clearSql(['a', 'b', 'c']);
  assert.ok(sql.indexOf('public.c') < sql.indexOf('public.a'));
});

test('counter never moves backwards', () => {
  assert.match(counterSql(201234), /greatest\(/);
});

test('checksum SQL orders by primary key', () => {
  assert.match(checksumSql('call_sheet_crew', ['call_sheet_id', 'crew_member_id']), /order by call_sheet_id, crew_member_id/);
});

test('report shows mismatches', () => {
  const r = renderReport({ startedAt: 'now', rows: [{ source: 'a', target: 'a', sourceCount: 2, targetCount: 1, match: false }] });
  assert.match(r, /MISMATCH/);
  assert.ok(!r.includes('—'));
});

test('isReadOnlySql allows plain selects and with-selects', () => {
  assert.ok(isReadOnlySql('select count(*) from public.clients'));
  assert.ok(isReadOnlySql('with x as (select 1) select * from x'));
  assert.ok(!isReadOnlySql('begin; select 1'));
});
