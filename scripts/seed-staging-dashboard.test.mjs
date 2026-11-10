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
  for (const a of seed.actors) {
    assert.match(a.email, /@example\.test$/);
    assert.match(a.phone, /^555-01\d\d$/, 'fictional phone range');
  }
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
  const actorIds = new Set(seed.actors.map((a) => a.id));
  for (const c of seed.actor_assignments) assert.ok(actorIds.has(c.actor_id) && slugs.has(c.client_slug), c.id);
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

test('casting rows use the actor stages and sit on production clients', () => {
  const stages = migration.match(/actor_assignments_stage_check CHECK \(\(stage = ANY \(ARRAY\[([^\]]*)\]/)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
  const production = new Set(seed.clients.filter((c) => c.does_production).map((c) => c.slug));
  for (const c of seed.actor_assignments) {
    assert.ok(stages.includes(c.stage), c.stage);
    assert.ok(production.has(c.client_slug), c.client_slug);
  }
  const pairs = seed.actor_assignments.map((c) => `${c.actor_id}|${c.client_slug}`);
  assert.equal(new Set(pairs).size, pairs.length, 'one casting per actor and client');
});

test('every seeded table that the dashboard copy also copies has a seed marker', async () => {
  const { TABLES } = await import('./dashboard-copy-lib.mjs');
  const copied = new Set(TABLES.map(([t]) => t));
  for (const [t] of SEED_ORDER) if (copied.has(t)) assert.ok(SEED_MARKERS[t], `${t} needs a seed marker so copy checksums leave it out`);
});

test('demo applications: made-up addresses, valid status, one pending per email, one roster match', () => {
  for (const t of ['creator_applications', 'actor_applications']) {
    for (const a of seed[t]) {
      assert.match(a.email, /@example\.test$/);
      assert.ok(['pending', 'approved', 'rejected'].includes(a.status), a.status);
      assert.equal(a.reviewed_by, null);
      if (a.status === 'rejected') assert.ok(a.review_notes);
    }
    const pending = seed[t].filter((a) => a.status === 'pending').map((a) => a.email.toLowerCase());
    assert.equal(new Set(pending).size, pending.length, `${t}: one pending application per email`);
  }
  for (const a of seed.actor_applications) assert.match(a.phone, /^555-01\d\d$/);
  const creatorEmails = new Set(seed.dashboard_creators.map((c) => c.email));
  assert.equal(seed.creator_applications.filter((a) => creatorEmails.has(a.email)).length, 1);
});

test('demo approval boards: one live creator board on a demo client, votes on its own assignments', () => {
  const t = new Date(now.getTime());
  const live = seed.approval_boards.filter((b) => !b.revoked && new Date(b.expires_at) > t);
  assert.equal(live.length, 1);
  for (const b of seed.approval_boards) {
    assert.equal(b.board_type, 'creators');
    assert.match(b.client_slug, /^demo-/);
    assert.equal(b.token.length, 48);
  }
  assert.equal(new Set(seed.approval_boards.map((b) => b.token)).size, seed.approval_boards.length);
  const byId = new Map(seed.creator_assignments.map((a) => [a.id, a]));
  for (const v of seed.approval_votes) {
    assert.ok(['up', 'down'].includes(v.vote));
    const board = seed.approval_boards.find((b) => b.id === v.board_id);
    assert.ok(board, v.id);
    assert.equal(byId.get(v.assignment_id)?.client_slug, board.client_slug, 'a vote is on an assignment of the board brand');
    assert.ok(v.voted_by === null || v.voted_by.length <= 40);
  }
  const pairs = seed.approval_votes.map((v) => `${v.board_id}|${v.assignment_id}`);
  assert.equal(new Set(pairs).size, pairs.length, 'one vote per board and assignment');
});

test('demo locations: made up, host contacts at example.test, one live link on a demo client', () => {
  for (const l of seed.locations) {
    assert.match(l.name, /made up/);
    assert.ok(l.contact_email === null || l.contact_email.endsWith('@example.test'), l.contact_email);
    assert.equal(l.wifi_password, null);
    assert.ok(l.bathrooms === null || Number.isInteger(l.bathrooms * 2));
  }
  const ids = new Set(seed.locations.map((l) => l.id));
  assert.equal(seed.location_boards.length, 1);
  for (const b of seed.location_boards) {
    assert.match(b.client_slug, /^demo-/);
    assert.equal(b.token.length, 48);
  }
  for (const i of seed.location_board_items) {
    assert.ok(ids.has(i.location_id), i.id);
    assert.ok(seed.location_boards.some((b) => b.id === i.board_id), i.id);
  }
  const pairs = seed.location_board_items.map((i) => `${i.board_id}|${i.location_id}`);
  assert.equal(new Set(pairs).size, pairs.length, 'a location is on a link once');
});

test('demo props: valid outcomes, demo client names, no negative prices', () => {
  const names = new Set(seed.clients.map((c) => c.name));
  for (const p of seed.props) {
    assert.ok(p.return_status === null || ['Returned', 'Thrown away', 'Kept'].includes(p.return_status), p.id);
    assert.ok(p.client === null || names.has(p.client), p.client);
    assert.ok(p.price === null || p.price >= 0);
    assert.match(p.name, /^Demo /);
  }
});

test('demo crew: example.test emails, 555-01xx phones, one archived', () => {
  for (const c of seed.crew_members) {
    assert.match(c.email, /@example\.test$/);
    assert.match(c.phone, /^555-01\d\d$/);
    assert.ok(c.role.trim());
  }
  assert.equal(seed.crew_members.filter((c) => !c.active).length, 1);
  assert.equal(new Set(seed.crew_members.map((c) => c.email)).size, seed.crew_members.length);
});

test('demo studio shipments: demo clients only, a linked casting of the same client, invented tracking', () => {
  const castings = new Map(seed.actor_assignments.map((a) => [a.id, a]));
  for (const s of seed.studio_shipments) {
    assert.match(s.client_slug, /^demo-/);
    assert.ok(s.description.trim().length <= 300);
    assert.ok(s.tracking_number === null || s.tracking_number.startsWith('DEMO-'));
    if (s.actor_assignment_id) assert.equal(castings.get(s.actor_assignment_id)?.client_slug, s.client_slug);
  }
});

test('demo shoot: blocks in order, talent confirmed onto the shoot, crew from the demo crew', () => {
  const order = SEED_ORDER.map(([t]) => t);
  assert.ok(order.indexOf('shoots') < order.indexOf('actor_assignments'), 'shoots are written before the castings that point at them');
  assert.ok(order.indexOf('crew_members') < order.indexOf('shoot_schedule_block_crew'));
  const shoot = seed.shoots[0];
  for (const b of seed.shoot_schedule_blocks) {
    assert.equal(b.shoot_id, shoot.id);
    assert.ok(b.end_time > b.start_time, b.label);
  }
  const confirmed = new Set(seed.actor_assignments.filter((a) => a.shoot_id === shoot.id).map((a) => a.id));
  for (const t of seed.shoot_schedule_block_talent) assert.ok(confirmed.has(t.actor_assignment_id), 'only talent confirmed onto the shoot is called');
  const crew = new Set(seed.crew_members.map((c) => c.id));
  for (const c of seed.shoot_schedule_block_crew) assert.ok(crew.has(c.crew_member_id));
  for (const a of seed.actor_assignments.filter((x) => x.shoot_id)) assert.equal(a.scheduled_shoot_date, shoot.shoot_date);
});
