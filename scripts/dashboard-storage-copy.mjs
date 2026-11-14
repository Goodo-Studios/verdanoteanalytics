#!/usr/bin/env node
// Copy of dashboard media files into Verdanote storage: staging by default,
// production behind explicit confirmation (step 8 of the release). Source (old
// dashboard) is only read, signed in as a viewer account whose storage policies
// allow reads and no writes. Plan: docs/dashboard-storage-copy-plan.md
//
// Env (from the vault, via hq secrets exec):
//   DASHBOARD_VIEWER_EMAIL, DASHBOARD_VIEWER_PASSWORD, DASHBOARD_ANON_KEY
//   staging:    STAGING_SUPABASE_SERVICE_ROLE_KEY
//   production: SUPABASE_ACCESS_TOKEN (the production service role key is fetched with it for
//               this run and never printed; or set PRODUCTION_SUPABASE_SERVICE_ROLE_KEY)
//
// Usage:
//   node scripts/dashboard-storage-copy.mjs --confirm-source qlvdvpchriyrsjtewwxx [--bucket name] [--dry-run] [--verify]
//
// Production:
//   1. Dry run: --target production --confirm-production gwyxaqoaldnaavkjqquv --dry-run
//      Lists files and bytes per bucket, writes nothing, leaves a receipt.
//   2. Copy: the same command without --dry-run. Refused unless the receipt from
//      step 1 is for this source and target and no older than 120 minutes. A copy
//      with no failures consumes the receipt. Files already there with the same size
//      are skipped, so a second run is safe.
//   3. Check: the same command with --verify (paths and sizes, source against production).

import fs from 'node:fs';
import { DASHBOARD_REF, STAGING_REF, PRODUCTION_REF } from './dashboard-copy-lib.mjs';
import { assertConfirmedProduction, buildReceipt, assertReceipt, readReceipt, defaultReceiptPath, hashOf, makeManagementClient } from './prod-cutover-lib.mjs';

const BUCKETS = [
  'creator-headshots', 'creator-family-pet-photos', 'creator-filming-locations', 'actor-headshots', 'actor-photos',
  'location-photos', 'creator-videos', 'actor-videos', 'creator-application-headshots', 'actor-application-headshots',
  'creator-application-videos', 'actor-application-videos', 'moodboard-refs',
];
const SRC = `https://${DASHBOARD_REF}.supabase.co`;
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
const fail = (m) => { console.error(m); process.exit(2); };
if (flag('--confirm-source') !== DASHBOARD_REF) {
  fail(`Refusing to read the old dashboard without --confirm-source ${DASHBOARD_REF}`);
}
const targetName = flag('--target') ?? 'staging';
if (targetName !== 'staging' && targetName !== 'production') fail('--target must be staging or production (a name, not a project ref)');
const isProduction = targetName === 'production';
const DST = `https://${isProduction ? PRODUCTION_REF : STAGING_REF}.supabase.co`;
const dryRun = args.includes('--dry-run');
const verifyOnly = args.includes('--verify');
const only = flag('--bucket');
if (only && !BUCKETS.includes(only)) fail(`Unknown bucket ${only}`);

// Production needs the typed ref for every use of its key, and a fresh dry-run receipt for a real copy.
const receiptPath = flag('--receipt') ?? defaultReceiptPath('dashboard-storage-copy', targetName);
const receiptScope = { kind: 'dashboard-storage-copy-dry-run', sourceRef: DASHBOARD_REF, targetRef: PRODUCTION_REF, fingerprint: hashOf(BUCKETS) };
if (isProduction) {
  try { assertConfirmedProduction(flag('--confirm-production')); } catch (e) { fail(String(e.message)); }
  if (!dryRun && !verifyOnly) {
    try { assertReceipt(readReceipt(receiptPath), receiptScope); } catch (e) { fail(String(e.message)); }
  }
} else if (flag('--confirm-production') !== undefined) {
  fail('--confirm-production only goes with --target production');
}

const need = (n) => { const v = process.env[n]; if (!v) { console.error(`Missing ${n}`); process.exit(2); } return v; };
const email = need('DASHBOARD_VIEWER_EMAIL');
const password = need('DASHBOARD_VIEWER_PASSWORD');
const anon = need('DASHBOARD_ANON_KEY');
// The target's service role key. Named stagingKey for the staging case it started with.
const stagingKey = !isProduction
  ? need('STAGING_SUPABASE_SERVICE_ROLE_KEY')
  : (process.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY
    || await makeManagementClient({ token: need('SUPABASE_ACCESS_TOKEN'), ref: PRODUCTION_REF }).serviceRoleKey());

let session = null;
async function signIn() {
  const r = await fetch(`${SRC}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`viewer sign-in failed (${r.status})`);
  session = (await r.json()).access_token;
  signedInAt = Date.now();
}
// Login tokens last an hour and storage answers an expired one with a 400, so sign in again
// before they run out and retry once on any auth-looking failure.
let signedInAt = 0;
const srcFetch = async (url, init = {}) => {
  const go = () => fetch(url, { ...init, headers: { apikey: anon, authorization: `Bearer ${session}`, ...(init.headers || {}) } });
  if (Date.now() - signedInAt > 30 * 60 * 1000) await signIn();
  let r = await go();
  if ([400, 401, 403].includes(r.status)) { await signIn(); r = await go(); }
  return r;
};
const dstHeaders = { apikey: stagingKey, authorization: `Bearer ${stagingKey}` };
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

const dstFetch = (url, init = {}) => fetch(url, { ...init, headers: { ...dstHeaders, ...(init.headers || {}) } });

async function listAll(bucket, prefix = '', side = 'src') {
  const files = [];
  const [base, doFetch] = side === 'src' ? [SRC, srcFetch] : [DST, dstFetch];
  for (let offset = 0; ; offset += 1000) {
    const r = await doFetch(`${base}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error(`list ${bucket}/${prefix} failed (${r.status})`);
    const items = await r.json();
    for (const it of items) {
      const path = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) files.push(...await listAll(bucket, path, side));
      else files.push({ path, size: it.metadata?.size ?? 0, type: it.metadata?.mimetype });
    }
    if (items.length < 1000) break;
  }
  return files;
}

async function existingSize(bucket, path) {
  const r = await fetch(`${DST}/storage/v1/object/info/${bucket}/${enc(path)}`, { headers: dstHeaders });
  if (!r.ok) return null;
  return (await r.json()).size ?? null;
}

async function copyOne(bucket, f) {
  if ((await existingSize(bucket, f.path)) === f.size && f.size) return 'skipped';
  const d = await srcFetch(`${SRC}/storage/v1/object/authenticated/${bucket}/${enc(f.path)}`);
  if (!d.ok) throw new Error(`download ${bucket}/${f.path} failed (${d.status})`);
  const u = await fetch(`${DST}/storage/v1/object/${bucket}/${enc(f.path)}`, {
    method: 'POST', duplex: 'half', body: d.body,
    headers: { ...dstHeaders, 'content-type': f.type || 'application/octet-stream', 'content-length': d.headers.get('content-length') ?? String(f.size), 'x-upsert': 'true' },
  });
  if (!u.ok) {
    const why = (await u.text().catch(() => '')).slice(0, 160);
    throw new Error(`upload ${bucket}/${f.path} failed (${u.status}) ${why} [${f.size} bytes]`);
  }
  return 'copied';
}

await signIn();

if (args.includes('--verify')) {
  // Compare file count, total bytes and every path+size between source and staging. Reads only.
  let mismatch = 0;
  console.log('bucket | source files | staging files | source MB | staging MB | result');
  for (const bucket of only ? [only] : BUCKETS) {
    const a = await listAll(bucket, '', 'src');
    const b = await listAll(bucket, '', 'dst');
    const sizes = new Map(b.map((f) => [f.path, f.size]));
    const missing = a.filter((f) => sizes.get(f.path) !== f.size);
    const extra = b.filter((f) => !a.some((x) => x.path === f.path));
    const sa = a.reduce((s, f) => s + f.size, 0);
    const sb = b.reduce((s, f) => s + f.size, 0);
    const ok = !missing.length && !extra.length && sa === sb;
    if (!ok) mismatch++;
    console.log(`${bucket} | ${a.length} | ${b.length} | ${(sa / 1048576).toFixed(1)} | ${(sb / 1048576).toFixed(1)} | ${ok ? 'match' : `MISMATCH (${missing.length} missing or different size, ${extra.length} extra)`}`);
    for (const f of missing.slice(0, 20)) console.log(`  missing ${f.path}`);
  }
  process.exit(mismatch ? 1 : 0);
}

const results = [];
for (const bucket of only ? [only] : BUCKETS) {
  const files = await listAll(bucket);
  const bytes = files.reduce((s, f) => s + f.size, 0);
  console.log(`${bucket}: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
  const row = { bucket, files: files.length, bytes, copied: 0, skipped: 0, failed: [] };
  if (!dryRun) {
    const queue = [...files];
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (let f; (f = queue.shift());) {
        try { row[await copyOne(bucket, f)]++; } catch (e) { row.failed.push(`${f.path}: ${e.message}`); }
      }
    }));
  }
  results.push(row);
}

if (dryRun && isProduction) {
  const counts = results.map((r) => ({ bucket: r.bucket, files: r.files, bytes: r.bytes }));
  fs.writeFileSync(receiptPath, JSON.stringify(buildReceipt({ ...receiptScope, counts }), null, 2) + '\n');
  console.log(`\nDry-run receipt written to ${receiptPath} (valid for 120 minutes, for this source and target only).`);
}

let bad = 0;
console.log('\nbucket | source files | copied | skipped (already there) | failed');
for (const r of results) { bad += r.failed.length; console.log(`${r.bucket} | ${r.files} | ${r.copied} | ${r.skipped} | ${r.failed.length}`); for (const f of r.failed) console.log(`  FAILED ${f}`); }
if (!bad && !dryRun && isProduction) {
  try { fs.unlinkSync(receiptPath); console.log('Dry-run receipt used up. Run the dry run again before another real copy.'); } catch { /* already gone */ }
}
process.exit(bad ? 1 : 0);
