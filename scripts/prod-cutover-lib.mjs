// Shared pieces of the production cutover scripts (docs/staging.md, "Releasing
// staging to production"): prod-secrets-status, ad-code-counter and
// the storage copy. Pure functions plus one small Supabase Management API client,
// so the safety rules can be tested without a network.
//
// Nothing here prints or returns a secret value. Secret listings keep names only.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { DASHBOARD_REF, PRODUCTION_REF, STAGING_REF } from './dashboard-copy-lib.mjs';

export { DASHBOARD_REF, PRODUCTION_REF, STAGING_REF };

const API = 'https://api.supabase.com/v1/projects';

// ------------------------------------------------------------------ guards

// Production is only touched when the exact project ref is typed out.
export function assertConfirmedProduction(value) {
  if (value !== PRODUCTION_REF) {
    throw new Error(`refusing to touch Verdanote production without --confirm-production ${PRODUCTION_REF}`);
  }
}

// Tiny argument parser shared by the scripts. `valueFlags` take one value,
// `boolFlags` take none. Anything else is refused. A project ref is accepted
// only as the value of a flag listed in `refFlags`.
export function parseFlags(argv, { valueFlags = [], boolFlags = [], refFlags = [] } = {}) {
  const out = {};
  const values = new Set(valueFlags);
  const bools = new Set(boolFlags);
  const refs = new Set(refFlags);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const name = a.slice(2);
    if (bools.has(name)) { out[name] = true; continue; }
    if (!values.has(name)) throw new Error(`unknown option --${name}`);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`--${name} needs a value`);
    if (!refs.has(name) && [PRODUCTION_REF, DASHBOARD_REF, STAGING_REF].some((r) => v.includes(r))) {
      throw new Error(`a project ref is not accepted for --${name}`);
    }
    out[name] = v;
  }
  return out;
}

// ------------------------------------------------------------------ receipts

export const RECEIPT_MAX_AGE_MINUTES = 120;
export const defaultReceiptPath = (kind, target) => path.join(os.tmpdir(), `${kind}-receipt-${target}.json`);

export const hashOf = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

export function buildReceipt({ kind, sourceRef, targetRef, now = new Date(), fingerprint, counts }) {
  return { kind, sourceRef, targetRef, fingerprint, createdAt: now.toISOString(), counts };
}

export function assertReceipt(receipt, { kind, sourceRef, targetRef, fingerprint, now = new Date(), maxAgeMinutes = RECEIPT_MAX_AGE_MINUTES }) {
  if (!receipt || receipt.kind !== kind) throw new Error('no dry-run receipt found. Run the dry run first (same command without the real-run flag).');
  if (receipt.sourceRef !== sourceRef || receipt.targetRef !== targetRef) throw new Error('the dry-run receipt is for a different source or target. Run the dry run again.');
  if (fingerprint !== undefined && receipt.fingerprint !== fingerprint) throw new Error('the plan changed since the dry run. Run the dry run again.');
  const age = now.getTime() - new Date(receipt.createdAt).getTime();
  if (!Number.isFinite(age) || age < -60000) throw new Error('the dry-run receipt has an invalid time. Run the dry run again.');
  if (age > maxAgeMinutes * 60000) throw new Error(`the dry-run receipt is older than ${maxAgeMinutes} minutes. Run the dry run again.`);
  return receipt;
}

export function readReceipt(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// ------------------------------------------------------------------ Management API

const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;
const REF = /^[a-z]{20}$/;

// token: a Supabase personal access token from the vault (SUPABASE_ACCESS_TOKEN).
// Errors carry the status and a short body, never the token.
export function makeManagementClient({ token, ref, fetchImpl = fetch }) {
  if (!token) throw new Error('missing SUPABASE_ACCESS_TOKEN (pass it with hq secrets exec --only SUPABASE_ACCESS_TOKEN)');
  if (!REF.test(ref || '')) throw new Error('a 20 letter project ref is needed');
  async function call(method, pathAndQuery, body) {
    const r = await fetchImpl(`${API}/${ref}${pathAndQuery}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (r.status >= 300) throw new Error(`${method} ${pathAndQuery} failed (${r.status}): ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  return {
    ref,
    // Deployed edge functions: [{ slug, status, version, updated_at }].
    async listFunctions() {
      const rows = await call('GET', '/functions');
      return (rows || []).map((f) => ({ slug: f.slug, status: f.status, version: f.version, updatedAt: f.updated_at }));
    },
    async deleteFunction(slug) {
      if (!SLUG.test(slug)) throw new Error(`unsafe function name ${slug}`);
      await call('DELETE', `/functions/${slug}`);
    },
    // Secret NAMES only. The API also returns a digest of each value; it is dropped here.
    async listSecretNames() {
      const rows = await call('GET', '/secrets');
      return (rows || []).map((s) => s.name).sort();
    },
    // Read-only SQL: the endpoint runs as supabase_read_only_user and the guard refuses non-selects.
    async readOnlyQuery(sql) {
      if (!isSelectOnly(sql)) throw new Error('only select statements are allowed here');
      return call('POST', '/database/query/read-only', { query: sql });
    },
    // Runs one select on the normal endpoint. Used only where a function must be called
    // as a simulated staff login (peek_ad_code), which the read-only role may not run.
    async selectQuery(sql) {
      if (!isSelectOnly(sql)) throw new Error('only select statements are allowed here');
      return call('POST', '/database/query', { query: sql });
    },
    // A write. Only the scripts that have passed their confirmation gates call it.
    async writeQuery(sql) {
      return call('POST', '/database/query', { query: sql });
    },
    // The service role key is returned to the caller only; it is never printed.
    async serviceRoleKey() {
      const keys = await call('GET', '/api-keys');
      const k = (keys || []).find((x) => x.name === 'service_role');
      if (!k?.api_key) throw new Error('service_role key not available for this token');
      return k.api_key;
    },
  };
}

export const isSelectOnly = (sql) => {
  const bare = String(sql).replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '');
  if (bare.includes(';') && bare.replace(/;\s*$/, '').includes(';')) return false;
  return /^\s*(with\b[\s\S]*?\bselect\b|select\b)/i.test(bare)
    && !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|reindex)\b/i.test(bare);
};

// ------------------------------------------------------------------ what the repo ships

// Function folders that exist in the repo (a folder with an index.ts). _shared is not a function.
export function localFunctionNames(functionsDir) {
  return fs.readdirSync(functionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(functionsDir, d.name, 'index.ts')))
    .map((d) => d.name)
    .sort();
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.ts') && !/\.test\.ts$/.test(e.name)) out.push(full);
  }
  return out;
}

// Secret name -> sorted function folders (or "_shared") whose code reads it with
// Deno.env.get('NAME'). Test files are ignored: a test that sets a name is not a reader.
export function secretsReadByCode(functionsDir) {
  const map = new Map();
  const re = /Deno\.env\.get\(\s*['"]([A-Za-z0-9_]+)['"]/g;
  for (const file of walk(functionsDir)) {
    const owner = path.relative(functionsDir, file).split(path.sep)[0];
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
      if (!map.has(m[1])) map.set(m[1], new Set());
      map.get(m[1]).add(owner);
    }
  }
  return new Map([...map.entries()].sort().map(([k, v]) => [k, [...v].sort()]));
}

// Names Supabase sets on every project itself. They are never ours to unset.
export const PLATFORM_SECRETS = new Set([
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'SUPABASE_JWKS',
  'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_SECRET_KEYS',
]);

// Every UPPER_SNAKE name that appears as a quoted string in function code (comments
// removed, tests ignored). The functions read secrets through a small env() helper
// as well as Deno.env.get, so "is this name read" means "does the code mention it".
export function namesMentionedInCode(functionsDir) {
  const names = new Set();
  for (const file of walk(functionsDir)) {
    const text = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
    for (const m of text.matchAll(/['"`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)['"`]/g)) names.add(m[1]);
  }
  return names;
}

export const projectTarget = (name) => {
  if (name === undefined || name === 'production') return { name: 'production', ref: PRODUCTION_REF, tokenEnv: 'SUPABASE_ACCESS_TOKEN' };
  if (name === 'staging') return { name: 'staging', ref: STAGING_REF, tokenEnv: 'VERDANOTE_STAGING_SUPABASE_ACCESS_TOKEN' };
  throw new Error('--target must be production or staging (a name, not a project ref)');
};
