#!/usr/bin/env node
// One-time copy of dashboard media files into Verdanote STAGING storage.
// Source (old dashboard) is only read, signed in as a viewer account whose
// storage policies allow reads and no writes. Target is hard wired to staging.
// Plan: docs/dashboard-storage-copy-plan.md
//
// Env (from the vault, via hq secrets exec):
//   DASHBOARD_VIEWER_EMAIL, DASHBOARD_VIEWER_PASSWORD, DASHBOARD_ANON_KEY
//   STAGING_SUPABASE_SERVICE_ROLE_KEY
// Usage: node scripts/dashboard-storage-copy.mjs --confirm-source qlvdvpchriyrsjtewwxx [--bucket name] [--dry-run]

import { DASHBOARD_REF, STAGING_REF } from './dashboard-copy-lib.mjs';

const BUCKETS = [
  'creator-headshots', 'creator-family-pet-photos', 'creator-filming-locations', 'actor-headshots', 'actor-photos',
  'location-photos', 'creator-videos', 'actor-videos', 'creator-application-headshots', 'actor-application-headshots',
  'creator-application-videos', 'actor-application-videos', 'moodboard-refs',
];
const SRC = `https://${DASHBOARD_REF}.supabase.co`;
const DST = `https://${STAGING_REF}.supabase.co`;
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
if (flag('--confirm-source') !== DASHBOARD_REF) {
  console.error(`Refusing to read the old dashboard without --confirm-source ${DASHBOARD_REF}`);
  process.exit(2);
}
const dryRun = args.includes('--dry-run');
const only = flag('--bucket');
if (only && !BUCKETS.includes(only)) { console.error(`Unknown bucket ${only}`); process.exit(2); }

const need = (n) => { const v = process.env[n]; if (!v) { console.error(`Missing ${n}`); process.exit(2); } return v; };
const email = need('DASHBOARD_VIEWER_EMAIL');
const password = need('DASHBOARD_VIEWER_PASSWORD');
const anon = need('DASHBOARD_ANON_KEY');
const stagingKey = need('STAGING_SUPABASE_SERVICE_ROLE_KEY');

let session = null;
async function signIn() {
  const r = await fetch(`${SRC}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`viewer sign-in failed (${r.status})`);
  session = (await r.json()).access_token;
}
const srcFetch = async (url, init = {}) => {
  const go = () => fetch(url, { ...init, headers: { apikey: anon, authorization: `Bearer ${session}`, ...(init.headers || {}) } });
  let r = await go();
  if (r.status === 401 || r.status === 403 && !r.ok) { await signIn(); r = await go(); }
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
  if (!u.ok) throw new Error(`upload ${bucket}/${f.path} failed (${u.status})`);
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

let bad = 0;
console.log('\nbucket | source files | copied | skipped (already there) | failed');
for (const r of results) { bad += r.failed.length; console.log(`${r.bucket} | ${r.files} | ${r.copied} | ${r.skipped} | ${r.failed.length}`); for (const f of r.failed) console.log(`  FAILED ${f}`); }
process.exit(bad ? 1 : 0);
