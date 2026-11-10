// Made-up test data for the old dashboard pages in Verdanote STAGING (step 5a:
// Overview, Client Detail, Creator pipeline, Follow-ups). Decision 10 in the
// consolidation plan: staging gets made-up test clients by default, never a copy
// of real client data unless the owner says so.
//
// Every row here is invented. Client slugs start with "demo-", creators come
// from source "staging_seed" with @example.test addresses, staff rows use the
// @staging.verdanote.test logins that scripts/seed-staging-users.mjs creates.
// SEED_MARKERS tells the dashboard copy script (scripts/dashboard-copy.mjs)
// which rows belong to this seed, so its checksums leave them out.
//
// Pure functions only, so the shape can be tested without a network.

export const PRODUCTION_REF = 'gwyxaqoaldnaavkjqquv';
export const STAGING_REF = 'mnvcksbhbvypuiwozvct';
export const DASHBOARD_REF = 'qlvdvpchriyrsjtewwxx';
export const DEMO_ACCOUNT = 'act_demo_glowdrip';

// Rows of this seed, per copied table: a SQL predicate (for the copy script)
// and the same rule in JS (for the tests).
export const SEED_MARKERS = {
  clients: { sql: "slug like 'demo-%'", match: (r) => r.slug.startsWith('demo-') },
  deliverables: { sql: "client_slug like 'demo-%'", match: (r) => r.client_slug.startsWith('demo-') },
  creator_assignments: { sql: "client_slug like 'demo-%'", match: (r) => r.client_slug.startsWith('demo-') },
  dashboard_creators: { sql: "source = 'staging_seed'", match: (r) => r.source === 'staging_seed' },
  app_users: { sql: "email like '%@staging.verdanote.test'", match: (r) => r.email.endsWith('@staging.verdanote.test') },
};

// Upsert order (parents first) and the conflict key of each table.
export const SEED_ORDER = [
  ['clients', 'slug'],
  ['app_users', 'email'],
  ['client_ad_accounts', 'account_id'],
  ['engagements', 'id'],
  ['deliverables', 'id'],
  ['dashboard_creators', 'id'],
  ['creator_assignments', 'id'],
  ['pipeline_tasks', 'clickup_task_id'],
];

export function assertStagingUrl(url) {
  if (!url) throw new Error('Set STAGING_SUPABASE_URL.');
  if (url.includes(PRODUCTION_REF)) throw new Error('Refusing to run: that URL is the Verdanote production project.');
  if (url.includes(DASHBOARD_REF)) throw new Error('Refusing to run: that URL is the old dashboard project.');
  if (!url.includes(STAGING_REF)) throw new Error(`Refusing to run: the URL is not the verdanote-staging project (${STAGING_REF}).`);
}

const id = (n) => `de5a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pad = (n) => String(n).padStart(2, '0');
export const isoDay = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDays = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
export const monthKey = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;

export const SEED_IDS = {
  builderAppUser: id(1),
  employeeAppUser: id(2),
};

export function buildDashboardSeed(now = new Date()) {
  const today = addDays(now, 0);
  const day = (n) => isoDay(addDays(today, n));
  const stamp = (n) => addDays(today, n).toISOString();
  const thisMonth = monthKey(today);
  const lastMonth = monthKey(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)));

  // origin 'coda' is the legacy value for a client the HQ sync keeps in step
  // with its knowledge file; two demo clients carry it so the pages show both.
  const clients = [
    { slug: 'demo-glowdrip', name: 'Glowdrip (demo)', status: 'active', active: true, origin: 'coda', does_creators: true, does_production: false,
      service_type: 'Performance Creative', strategist: 'Test Strategist', pct_complete: 35, contract_start: day(-60), contract_end: day(120),
      last_synced: stamp(-16), month: thisMonth, scope: '6 UGC videos per cycle', notes: null },
    { slug: 'demo-northwind', name: 'Northwind Snacks (demo)', status: 'active', active: true, origin: 'manual', does_creators: true, does_production: false,
      service_type: 'Performance Creative', strategist: 'Test Strategist', pct_complete: 80, contract_start: day(-30), contract_end: day(150),
      last_synced: null, month: thisMonth, scope: '4 UGC videos per month', notes: null },
    { slug: 'demo-pinecrest', name: 'Pinecrest Pets (demo)', status: 'ending / transitioning', active: true, origin: 'coda', does_creators: true, does_production: true,
      service_type: 'Editing OS', strategist: null, pct_complete: 60, contract_start: day(-200), contract_end: day(10),
      last_synced: stamp(-30), month: thisMonth, scope: null, notes: null },
    { slug: 'demo-harbor', name: 'Harbor Home (demo)', status: 'active', active: true, origin: 'manual', does_creators: false, does_production: true,
      service_type: 'Project (one-off)', strategist: 'Test Producer', pct_complete: null, contract_start: day(-10), contract_end: day(50),
      last_synced: null, month: thisMonth, scope: '1 studio shoot', notes: null },
  ];

  const app_users = [
    { id: SEED_IDS.builderAppUser, name: 'Test Builder (staff)', email: 'builder@staging.verdanote.test', role: 'admin', active: true },
    { id: SEED_IDS.employeeAppUser, name: 'Test Employee (staff)', email: 'employee@staging.verdanote.test', role: 'producer', active: true },
  ];

  const client_ad_accounts = [{ account_id: DEMO_ACCOUNT, client_slug: 'demo-glowdrip' }];

  const engagements = [
    { id: id(101), client_slug: 'demo-glowdrip', cycle_number: 1, engagement_type: 'standard_sprint', status: 'closed', start_date: day(-57) },
    { id: id(102), client_slug: 'demo-glowdrip', cycle_number: 2, engagement_type: 'standard_sprint', status: 'active', start_date: day(-12) },
    { id: id(103), client_slug: 'demo-northwind', cycle_number: 1, engagement_type: 'standard_sprint', status: 'active', start_date: day(-25) },
  ];

  const types = ['cycle_brief', 'production', 'delivery', 'report'];
  const deliverables = [];
  let n = 200;
  for (const [slug, statuses] of [
    ['demo-glowdrip', ['complete', 'in_progress', 'pending', 'pending']],
    ['demo-northwind', ['complete', 'complete', 'in_progress', 'pending']],
    ['demo-pinecrest', ['complete', 'complete', 'complete', 'in_progress']],
  ]) {
    types.forEach((type, i) => deliverables.push({ id: id(n++), client_slug: slug, month: thisMonth, type, status: statuses[i], file_path: null }));
  }
  types.forEach((type) => deliverables.push({ id: id(n++), client_slug: 'demo-northwind', month: lastMonth, type, status: 'complete', file_path: null }));

  const names = ['Avery Stone', 'Blake Rivers', 'Casey Moreno', 'Devon Park', 'Emery Hale', 'Finley Brooks', 'Gray Lopez', 'Harper Quinn'];
  const dashboard_creators = names.map((name, i) => ({
    id: id(300 + i), name, email: `${name.split(' ')[0].toLowerCase()}@example.test`, scale: (i % 5) + 1,
    categories: i % 2 ? ['beauty'] : ['food', 'lifestyle'], location: 'Testville', source: 'staging_seed',
    trialed: i % 3 === 0, do_not_use_again: false,
  }));

  const B = SEED_IDS.builderAppUser;
  const E = SEED_IDS.employeeAppUser;
  const a = (k, creator, slug, stage, followUp, owner, extra = {}) => ({
    id: id(400 + k), creator_id: id(300 + creator), client_slug: slug, month: null, stage,
    next_follow_up_at: followUp === null ? null : day(followUp), owner_id: owner,
    notes: null, brief_name: null, air_folder_link: null, tracking_number: null, ...extra,
  });
  const creator_assignments = [
    a(1, 0, 'demo-glowdrip', 'sourced', null, null),
    a(2, 1, 'demo-glowdrip', 'contract_sent', -1, B),
    a(3, 2, 'demo-glowdrip', 'product_shipped', 0, E, { tracking_number: 'TEST-TRACK-001' }),
    a(4, 3, 'demo-glowdrip', 'brief_sent', 3, E, { brief_name: 'Glowdrip demo brief 1' }),
    a(5, 4, 'demo-glowdrip', 'footage_delivered', null, B),
    a(6, 5, 'demo-northwind', 'interested', null, E),
    a(7, 6, 'demo-northwind', 'contract_signed', -3, E),
    a(8, 7, 'demo-northwind', 'declined', null, null),
    a(9, 0, 'demo-pinecrest', 'shortlisted', 6, B),
  ];

  const pipeline_tasks = [
    ['Preparing Content', 'Glowdrip demo asset 1', 'UGC Video', 4],
    ['Production', 'Glowdrip demo asset 2', 'UGC Video', 6],
    ['Editing', 'Glowdrip demo asset 3', 'Static', 2],
    ['Client Review', 'Glowdrip demo asset 4', 'UGC Video', 1],
    ['Ready to Launch', 'Glowdrip demo asset 5', 'Static', null],
  ].map(([stage, task_name, content_type, due], i) => ({
    clickup_task_id: `demo-seed-${i + 1}`, client_slug: 'demo-glowdrip', account_id: DEMO_ACCOUNT,
    stage, task_name, content_type, due_date: due === null ? null : day(due), synced_at: stamp(0),
  }));

  return { clients, app_users, client_ad_accounts, engagements, deliverables, dashboard_creators, creator_assignments, pipeline_tasks };
}
