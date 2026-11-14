// Shape of the made-up staging BID for the read-only BID viewer (step 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BID_SECTIONS, DEMO_BID_CLIENT, assertStagingUrl, buildDemoBid } from './seed-staging-bids-lib.mjs';
import { PRODUCTION_REF, STAGING_REF } from './seed-staging-dashboard-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('refuses production and any non-staging URL', () => {
  assert.throws(() => assertStagingUrl(`https://${PRODUCTION_REF}.supabase.co`), /production/);
  assert.throws(() => assertStagingUrl('https://abcdefghijklmnopqrst.supabase.co'), /not the verdanote-staging/);
  assert.doesNotThrow(() => assertStagingUrl(`https://${STAGING_REF}.supabase.co`));
});

test('the demo BID is made up, for the demo client, with all 17 section headings in order', () => {
  const bid = buildDemoBid();
  assert.equal(bid.p_client_slug, DEMO_BID_CLIENT);
  assert.equal(bid.p_source, 'staging-seed');
  assert.equal(bid.p_data_origin, 'made_up');
  assert.match(bid.p_body_markdown, /Made-up staging BID/);
  const headings = [...bid.p_body_markdown.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(headings, BID_SECTIONS.map((t, i) => [i + 1, t]));
  assert.equal(BID_SECTIONS.length, 17);
});

test('the same body every run, so the import is idempotent', () => {
  assert.equal(buildDemoBid().p_body_markdown, buildDemoBid().p_body_markdown);
});

test('the demo client is one the staging dashboard seed creates', () => {
  const lib = fs.readFileSync(path.join(here, 'seed-staging-dashboard-lib.mjs'), 'utf8');
  assert.match(lib, new RegExp(`slug: '${DEMO_BID_CLIENT}'`));
});

test('the arguments match the import function in the migration', () => {
  const sql = fs.readFileSync(path.join(here, '../supabase/migrations/20261111020001_client_bids.sql'), 'utf8');
  for (const arg of Object.keys(buildDemoBid())) assert.match(sql, new RegExp(`\\b${arg}\\b`), arg);
});
