// Shape of the made-up staging seed for the old dashboard pages (step 5a).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRODUCTION_REF, STAGING_REF, DASHBOARD_REF, SEED_MARKERS, SEED_ORDER, assertStagingUrl, buildDashboardSeed,
} from './seed-staging-dashboard-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const now = new Date('2026-11-10T12:00:00Z');
const seed = buildDashboardSeed(now);
const migration = fs.readFileSync(path.join(here, '../supabase/migrations/20261101000001_dashboard_tables.sql'), 'utf8');

test('refuses production, the old dashboard and any non-staging URL', () => {
  assert.throws(() => assertStagingUrl(`https://${PRODUCTION_REF}.supabase.co`), /production/);
  assert.throws(() => assertStagingUrl(`https://${DASHBOARD_REF}.supabase.co`), /old dashboard/);
  assert.throws(() => assertStagingUrl('https://abcdefghijklmnopqrst.supabase.co'), /not the verdanote-staging/);
  assert.throws(() => assertStagingUrl(undefined), /STAGING_SUPABASE_URL/);
  assert.doesNotThrow(() => assertStagingUrl(`https://${STAGING_REF}.supabase.co`));
});

test('every table in the upsert order has rows and nothing is left out', () => {
  assert.deepEqual(SEED_ORDER.map(([t]) => t).sort(), Object.keys(seed).sort());
  for (const [t] of SEED_ORDER) assert.ok(seed[t].length > 0, t);
});

test('every seeded row of a copied table carries its seed marker', () => {
  for (const [table, marker] of Object.entries(SEED_MARKERS)) {
    for (const row of seed[table]) assert.ok(marker.match(row), `${table} ${JSON.stringify(row).slice(0, 80)}`);
  }
});

test('the data is made up: demo slugs, example.test and staging.verdanote.test addresses only', () => {
  for (const c of seed.clients) assert.match(c.slug, /^demo-/);
  for (const c of seed.dashboard_creators) assert.match(c.email, /@example\.test$/);
  for (const u of seed.app_users) assert.match(u.email, /@staging\.verdanote\.test$/);
  for (const t of seed.pipeline_tasks) assert.match(t.clickup_task_id, /^demo-seed-/);
});

test('rows respect the dashboard constraints', () => {
  const stages = migration.match(/creator_assignments_stage_check CHECK \(\(stage = ANY \(ARRAY\[([^\]]*)\]/)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
  for (const a of seed.creator_assignments) assert.ok(stages.includes(a.stage), a.stage);
  for (const c of seed.clients) {
    assert.ok(c.does_creators || c.does_production, c.slug);
    assert.ok(['coda', 'manual'].includes(c.origin));
  }
  for (const d of seed.deliverables) {
    assert.ok(['cycle_brief', 'production', 'delivery', 'report', 'performance'].includes(d.type));
    assert.ok(['pending', 'in_progress', 'complete'].includes(d.status));
  }
  const pairs = seed.creator_assignments.map((a) => `${a.creator_id}|${a.client_slug}`);
  assert.equal(new Set(pairs).size, pairs.length, 'one assignment per creator and client');
  const keys = seed.deliverables.map((d) => `${d.client_slug}|${d.month}|${d.type}`);
  assert.equal(new Set(keys).size, keys.length, 'one deliverable per client, month and type');
});

test('references point at seeded rows', () => {
  const slugs = new Set(seed.clients.map((c) => c.slug));
  const creators = new Set(seed.dashboard_creators.map((c) => c.id));
  const users = new Set(seed.app_users.map((u) => u.id));
  for (const a of seed.creator_assignments) {
    assert.ok(slugs.has(a.client_slug));
    assert.ok(creators.has(a.creator_id));
    assert.ok(a.owner_id === null || users.has(a.owner_id));
  }
  for (const t of ['deliverables', 'engagements', 'client_ad_accounts', 'pipeline_tasks']) {
    for (const r of seed[t]) assert.ok(slugs.has(r.client_slug), `${t} ${r.client_slug}`);
  }
});

test('follow-ups cover overdue, today and later, relative to the day it runs', () => {
  const dates = seed.creator_assignments.map((a) => a.next_follow_up_at).filter(Boolean);
  assert.ok(dates.includes('2026-11-09'), 'one overdue');
  assert.ok(dates.includes('2026-11-10'), 'one due today');
  assert.ok(dates.some((d) => d > '2026-11-10'), 'one later');
});

test('at most one active sprint per client and active sprints have a start date', () => {
  const active = seed.engagements.filter((e) => e.status === 'active');
  assert.equal(new Set(active.map((e) => e.client_slug)).size, active.length);
  for (const e of seed.engagements) if (e.status !== 'planned') assert.ok(e.start_date);
});
