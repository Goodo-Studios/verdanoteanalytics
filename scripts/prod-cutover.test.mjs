// Tests for the production cutover scripts: prod-cutover-lib, prod-secrets-status,
// ad-code-counter and the production target of the storage copy.
// No network: the Management API client gets a fake fetch, the CLIs are run with no
// credentials and must stop before any call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DASHBOARD_REF, PRODUCTION_REF, STAGING_REF, parseFlags, assertConfirmedProduction, buildReceipt, assertReceipt, hashOf,
  makeManagementClient, isSelectOnly, localFunctionNames, secretsReadByCode, namesMentionedInCode, projectTarget,
} from './prod-cutover-lib.mjs';
import { SECRET_CATALOG, evaluateSecrets, renderStatus, setCommand } from './prod-secrets-lib.mjs';
import { decideRaise, assertApplyAllowed, verifyCounter, peekAsBuilderSql, checklist, raiseSql } from './ad-code-counter-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const functionsDir = path.join(here, '../supabase/functions');
const runScript = (name, args, env = {}) => spawnSync(process.execPath, [path.join(here, name), ...args], {
  encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 20000,
});

// ------------------------------------------------------------------ lib

test('parseFlags refuses unknown options, stray values and project refs where none belong', () => {
  const spec = { valueFlags: ['target', 'confirm-production'], boolFlags: ['apply'], refFlags: ['confirm-production'] };
  assert.deepEqual(parseFlags(['--apply', '--target', 'staging'], spec), { apply: true, target: 'staging' });
  assert.deepEqual(parseFlags(['--confirm-production', PRODUCTION_REF], spec), { 'confirm-production': PRODUCTION_REF });
  assert.throws(() => parseFlags(['--nope'], spec), /unknown option/);
  assert.throws(() => parseFlags(['x'], spec), /unexpected argument/);
  assert.throws(() => parseFlags(['--target'], spec), /needs a value/);
  assert.throws(() => parseFlags(['--target', PRODUCTION_REF], spec), /project ref is not accepted/);
});

test('production confirmation needs the exact ref', () => {
  assert.doesNotThrow(() => assertConfirmedProduction(PRODUCTION_REF));
  for (const bad of [undefined, '', 'production', STAGING_REF, DASHBOARD_REF, `${PRODUCTION_REF} `]) {
    assert.throws(() => assertConfirmedProduction(bad), /--confirm-production/);
  }
});

test('generic receipts match kind, source, target, plan and age', () => {
  const base = { kind: 'k', sourceRef: DASHBOARD_REF, targetRef: PRODUCTION_REF, fingerprint: hashOf(['a']) };
  const now = new Date('2026-11-15T12:00:00Z');
  const fresh = buildReceipt({ ...base, now: new Date('2026-11-15T11:00:00Z'), counts: [] });
  assert.doesNotThrow(() => assertReceipt(fresh, { ...base, now }));
  assert.throws(() => assertReceipt(null, { ...base, now }), /no dry-run receipt/);
  assert.throws(() => assertReceipt({ ...fresh, kind: 'other' }, { ...base, now }), /no dry-run receipt/);
  assert.throws(() => assertReceipt(fresh, { ...base, targetRef: STAGING_REF, now }), /different source or target/);
  assert.throws(() => assertReceipt(fresh, { ...base, fingerprint: hashOf(['b']), now }), /plan changed/);
  assert.throws(() => assertReceipt(fresh, { ...base, now: new Date('2026-11-15T13:30:00Z') }), /older than 120 minutes/);
  assert.throws(() => assertReceipt({ ...fresh, createdAt: 'x' }, { ...base, now }), /invalid time/);
});

test('the management client never leaks the token and drops secret digests', async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body });
    if (url.endsWith('/secrets')) return { status: 200, text: async () => JSON.stringify([{ name: 'B_KEY', value: 'digest1' }, { name: 'A_KEY', value: 'digest2' }]) };
    if (url.endsWith('/functions')) return { status: 200, text: async () => JSON.stringify([{ slug: 'x', status: 'ACTIVE', version: 3, updated_at: 1 }]) };
    return { status: 401, text: async () => 'bad token tok-123' };
  };
  const c = makeManagementClient({ token: 'tok-123', ref: PRODUCTION_REF, fetchImpl: fake });
  assert.deepEqual(await c.listSecretNames(), ['A_KEY', 'B_KEY']);
  assert.deepEqual(await c.listFunctions(), [{ slug: 'x', status: 'ACTIVE', version: 3, updatedAt: 1 }]);
  assert.equal(calls[0].method, 'GET');
  await assert.rejects(() => c.deleteFunction('x; rm'), /unsafe function name/);
  await assert.rejects(() => c.readOnlyQuery('delete from t'), /only select/);
  await assert.rejects(() => c.deleteFunction('ok'), (e) => !String(e.message).includes('Bearer'));
  assert.throws(() => makeManagementClient({ token: '', ref: PRODUCTION_REF }), /missing SUPABASE_ACCESS_TOKEN/);
  assert.throws(() => makeManagementClient({ token: 't', ref: 'short' }), /20 letter/);
});

test('read-only queries go to the read-only endpoint, selects on the normal one, writes only through writeQuery', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { status: 200, text: async () => '[]' }; };
  const c = makeManagementClient({ token: 't', ref: STAGING_REF, fetchImpl: fake });
  await c.readOnlyQuery('select 1');
  await c.selectQuery('select 1');
  await c.writeQuery('update x set y = 1');
  assert.ok(urls[0].endsWith('/database/query/read-only'));
  assert.ok(urls[1].endsWith('/database/query') && urls[2].endsWith('/database/query'));
  await assert.rejects(() => c.selectQuery('select 1; delete from t'), /only select/);
});

test('isSelectOnly accepts selects and refuses everything else', () => {
  assert.ok(isSelectOnly('select name from vault.decrypted_secrets order by name'));
  assert.ok(isSelectOnly('with a as (select 1) select * from a'));
  assert.ok(isSelectOnly("select 'drop table x'"));
  for (const bad of ['delete from t', 'select 1; drop table t', 'insert into t select 1', 'update t set a = 1', 'select 1; select 2']) {
    assert.ok(!isSelectOnly(bad), bad);
  }
});

test('the repo has no Coda function folder and no code reads a Coda secret', () => {
  const local = localFunctionNames(functionsDir);
  assert.ok(local.length > 50);
  for (const n of local) assert.ok(!/coda/i.test(n), n);
  assert.ok(!local.includes('_shared'));
  assert.ok(!namesMentionedInCode(functionsDir).has('CODA_API_KEY'));
  assert.ok(secretsReadByCode(functionsDir).has('SUPABASE_SERVICE_ROLE_KEY'));
});

test('project targets are names, never refs', () => {
  assert.throws(() => projectTarget('gwyxaqoaldnaavkjqquv'), /a name, not a project ref/);
  assert.equal(projectTarget().ref, PRODUCTION_REF);
  assert.equal(projectTarget('staging').tokenEnv, 'VERDANOTE_STAGING_SUPABASE_ACCESS_TOKEN');
});

// ------------------------------------------------------------------ prod-secrets-status

test('every function secret in the catalog is mentioned by the code (or is a vault name)', () => {
  const mentioned = namesMentionedInCode(functionsDir);
  for (const s of SECRET_CATALOG.filter((x) => x.kind !== 'vault')) assert.ok(mentioned.has(s.name), `${s.name} is not read by any function`);
});

test('the catalog covers every secret the release notes say production lacks, and the vault names', () => {
  const names = SECRET_CATALOG.map((s) => s.name);
  for (const n of ['CLICKUP_API_TOKEN', 'CLICKUP_WEBHOOK_SECRET', 'SITE_URL', 'RESEND_API_KEY', 'SLACK_BOT_TOKEN', 'SLACK_WEBHOOK_URL', 'FIREFLIES_API_KEY',
    'CLICKUP_WRITEBACK_ENABLED', 'CLIENT_INVITES_SEND_ENABLED', 'ANTHROPIC_API_KEY', 'storage_signing_project_url', 'storage_signing_service_role_key']) {
    assert.ok(names.includes(n), n);
  }
  for (const s of SECRET_CATALOG) assert.ok(s.readBy && s.ifMissing, s.name);
});

test('evaluateSecrets marks set, missing, off by design and could-not-check, and never needs a value', () => {
  const { rows, other } = evaluateSecrets({ deployedNames: ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'ODD_ONE', 'OLD_KEY'], vaultNames: null });
  const by = Object.fromEntries(rows.map((r) => [r.name, r.status]));
  assert.equal(by.ANTHROPIC_API_KEY, 'set');
  assert.equal(by.CLICKUP_API_TOKEN, 'missing');
  assert.equal(by.CLICKUP_WRITEBACK_ENABLED, 'off');
  assert.equal(by.CLIENT_INVITES_SEND_ENABLED, 'off');
  assert.equal(by.storage_signing_project_url, 'could not check');
  assert.deepEqual(other, ['ODD_ONE', 'OLD_KEY']);
  const checked = evaluateSecrets({ deployedNames: [], vaultNames: ['storage_signing_project_url'] }).rows;
  assert.equal(checked.find((r) => r.name === 'storage_signing_project_url').status, 'set');
  assert.equal(checked.find((r) => r.name === 'storage_signing_service_role_key').status, 'missing');
});

test('the status report names what stays off, prints set commands for names only, and has no em dash', () => {
  const ev = evaluateSecrets({ deployedNames: ['ANTHROPIC_API_KEY'], vaultNames: [] });
  const text = renderStatus({ ...ev, projectName: 'production', ref: PRODUCTION_REF });
  assert.match(text, /CLICKUP_API_TOKEN: The ClickUp sync answers 503/);
  assert.match(text, /Off by design/);
  assert.ok(text.includes(setCommand('RESEND_API_KEY')));
  assert.ok(!text.includes('\u2014'));
  assert.match(setCommand('X_KEY'), /--only SUPABASE_ACCESS_TOKEN,X_KEY/);
});

test('prod-secrets-status refuses a missing token and a project ref as target, with no network', () => {
  const r = runScript('prod-secrets-status.mjs', []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /SUPABASE_ACCESS_TOKEN/);
  const t = runScript('prod-secrets-status.mjs', ['--target', PRODUCTION_REF]);
  assert.equal(t.status, 2);
  assert.match(t.stderr, /project ref is not accepted|a name, not a project ref/);
  assert.equal(runScript('prod-secrets-status.mjs', ['--delete']).status, 2);
});

// ------------------------------------------------------------------ ad-code-counter

test('the counter is only ever raised', () => {
  assert.deepEqual(decideRaise({ source: 201234, target: 199999 }), { action: 'raise', from: 199999, to: 201234, reason: 'raise by 1235' });
  assert.equal(decideRaise({ source: 200000, target: 200000 }).action, 'none');
  assert.equal(decideRaise({ source: '200000', target: '200050' }).action, 'none');
  assert.match(decideRaise({ source: 1, target: 5 }).reason, /never lowered/);
  assert.throws(() => decideRaise({ source: null, target: 5 }), /old dashboard counter/);
  assert.throws(() => decideRaise({ source: 5, target: undefined }), /Verdanote counter row/);
  assert.match(raiseSql(201234), /greatest\(public\.ad_name_counter\.value, excluded\.value\)/);
});

test('applying needs the source confirmation and, on production, the typed ref', () => {
  assert.doesNotThrow(() => assertApplyAllowed({ target: 'production', applyFlag: false }));
  assert.throws(() => assertApplyAllowed({ target: 'production', applyFlag: true }), /--confirm-source/);
  assert.throws(() => assertApplyAllowed({ target: 'production', applyFlag: true, confirmSource: DASHBOARD_REF }), /--confirm-production/);
  assert.throws(() => assertApplyAllowed({ target: 'production', applyFlag: true, confirmSource: DASHBOARD_REF, confirmProduction: STAGING_REF }), /--confirm-production/);
  assert.doesNotThrow(() => assertApplyAllowed({ target: 'production', applyFlag: true, confirmSource: DASHBOARD_REF, confirmProduction: PRODUCTION_REF }));
  assert.doesNotThrow(() => assertApplyAllowed({ target: 'staging', applyFlag: true, confirmSource: DASHBOARD_REF }));
  assert.throws(() => assertApplyAllowed({ target: 'staging', applyFlag: true, confirmSource: DASHBOARD_REF, confirmProduction: PRODUCTION_REF }), /only goes with --target production/);
});

test('verification compares both counters and the peek', () => {
  assert.equal(verifyCounter({ source: 100, target: 100, peek: 101 }).ok, true);
  assert.equal(verifyCounter({ source: 100, target: 150, peek: 151 }).ok, true);
  assert.equal(verifyCounter({ source: 100, target: 99, peek: 100 }).ok, false);
  const wrongPeek = verifyCounter({ source: 100, target: 100, peek: 105 });
  assert.equal(wrongPeek.ok, false);
  assert.match(wrongPeek.problems[0], /should show 101/);
  assert.equal(verifyCounter({ source: null, target: 100, peek: 101 }).ok, true);
  assert.equal(verifyCounter({ source: 100, target: 100, peek: null }).ok, true);
  assert.match(verifyCounter({ source: 100, target: 100, peek: null }).peekState, /by hand/);
});

test('the peek check is one select with no write and the checklist covers both old generators', () => {
  assert.ok(isSelectOnly(peekAsBuilderSql));
  assert.ok(!/\b(insert|update|delete)\b/i.test(peekAsBuilderSql));
  const c = checklist({ targetName: 'production' });
  assert.match(c, /goodo-ad-name-generator/);
  assert.match(c, /Goodo OS/);
  assert.match(c, /--apply/);
  assert.match(c, /--verify/);
  assert.match(c, /never let two generators issue codes at once/);
  assert.ok(!c.includes('\u2014'));
});

test('ad-code-counter prints the checklist with no credentials and refuses unsafe runs before any network call', () => {
  const plain = runScript('ad-code-counter.mjs', []);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /Switch-over checklist/);
  assert.match(plain.stdout, /Nothing was read/);
  const noSource = runScript('ad-code-counter.mjs', ['--apply', '--confirm-production', PRODUCTION_REF]);
  assert.equal(noSource.status, 2);
  assert.match(noSource.stderr, /--confirm-source/);
  const noProd = runScript('ad-code-counter.mjs', ['--apply', '--confirm-source', DASHBOARD_REF]);
  assert.equal(noProd.status, 2);
  assert.match(noProd.stderr, /--confirm-production/);
  const stray = runScript('ad-code-counter.mjs', ['--confirm-production', PRODUCTION_REF]);
  assert.equal(stray.status, 2);
  assert.match(stray.stderr, /only goes with --apply/);
  const both = runScript('ad-code-counter.mjs', ['--apply', '--verify', '--confirm-source', DASHBOARD_REF, '--confirm-production', PRODUCTION_REF]);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /separate runs/);
  const noToken = runScript('ad-code-counter.mjs', ['--confirm-source', DASHBOARD_REF]);
  assert.equal(noToken.status, 2);
  assert.match(noToken.stderr, /SUPABASE_ACCESS_TOKEN/);
});

// ------------------------------------------------------------------ storage copy, production target

const storage = (args, env = {}) => runScript('dashboard-storage-copy.mjs', args, env);

test('the storage copy needs the source confirmation, a target name and, for production, the typed ref', () => {
  assert.equal(storage([]).status, 2);
  const badTarget = storage(['--confirm-source', DASHBOARD_REF, '--target', PRODUCTION_REF]);
  assert.equal(badTarget.status, 2);
  assert.match(badTarget.stderr, /a name, not a project ref/);
  const noRef = storage(['--confirm-source', DASHBOARD_REF, '--target', 'production', '--dry-run']);
  assert.equal(noRef.status, 2);
  assert.match(noRef.stderr, new RegExp(`--confirm-production ${PRODUCTION_REF}`));
  const stray = storage(['--confirm-source', DASHBOARD_REF, '--confirm-production', PRODUCTION_REF]);
  assert.equal(stray.status, 2);
  assert.match(stray.stderr, /only goes with --target production/);
});

test('a real production storage copy stops without a fresh dry-run receipt, before any sign-in', () => {
  const real = ['--confirm-source', DASHBOARD_REF, '--target', 'production', '--confirm-production', PRODUCTION_REF];
  const none = storage([...real, '--receipt', path.join(os.tmpdir(), `none-${process.pid}.json`)]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no dry-run receipt found/);
  const file = path.join(os.tmpdir(), `storage-stale-${process.pid}.json`);
  const BUCKETS = fs.readFileSync(path.join(here, 'dashboard-storage-copy.mjs'), 'utf8').match(/const BUCKETS = \[([\s\S]*?)\];/)[1];
  const names = [...BUCKETS.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  fs.writeFileSync(file, JSON.stringify(buildReceipt({ kind: 'dashboard-storage-copy-dry-run', sourceRef: DASHBOARD_REF, targetRef: PRODUCTION_REF, fingerprint: hashOf(names), now: new Date('2020-01-01T00:00:00Z'), counts: [] })));
  try {
    const stale = storage([...real, '--receipt', file]);
    assert.equal(stale.status, 2);
    assert.match(stale.stderr, /older than 120 minutes/);
  } finally { fs.unlinkSync(file); }
});

test('the storage copy writes only to the target, only with POST, and production is never the default', () => {
  const src = fs.readFileSync(path.join(here, 'dashboard-storage-copy.mjs'), 'utf8');
  assert.match(src, /flag\('--target'\) \?\? 'staging'/);
  for (const m of src.matchAll(/fetch\(`\$\{DST\}[^`]*`,\s*\{\s*method: '(\w+)'/g)) assert.equal(m[1], 'POST');
});
