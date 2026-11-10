// Made-up test data for the old dashboard pages in Verdanote STAGING (step 5a:
// Overview, Client Detail, Creator pipeline, Follow-ups; step 5b: Creators,
// Actors, Applications, approval boards; step 5c: Production). Decision 10 in the
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
  actors: { sql: "source = 'staging_seed'", match: (r) => r.source === 'staging_seed' },
  actor_assignments: { sql: "client_slug like 'demo-%'", match: (r) => r.client_slug.startsWith('demo-') },
  creator_applications: { sql: "email like '%@example.test'", match: (r) => r.email.endsWith('@example.test') },
  actor_applications: { sql: "email like '%@example.test'", match: (r) => r.email.endsWith('@example.test') },
  approval_boards: { sql: "client_slug like 'demo-%'", match: (r) => r.client_slug.startsWith('demo-') },
  approval_votes: { sql: "board_id::text like 'de5a0000-%'", match: (r) => r.board_id.startsWith('de5a0000-') },
  shoots: { sql: "client_slug like 'demo-%'", match: (r) => r.client_slug.startsWith('demo-') },
  shoot_schedule_blocks: { sql: "id::text like 'de5a0000-%'", match: (r) => r.id.startsWith('de5a0000-') },
  shoot_schedule_block_talent: { sql: "block_id::text like 'de5a0000-%'", match: (r) => r.block_id.startsWith('de5a0000-') },
  shoot_schedule_block_crew: { sql: "block_id::text like 'de5a0000-%'", match: (r) => r.block_id.startsWith('de5a0000-') },
  studio_shipments: { sql: "client_slug like 'demo-%'", match: (r) => r.client_slug.startsWith('demo-') },
  crew_members: { sql: "email like '%@example.test'", match: (r) => r.email.endsWith('@example.test') },
  props: { sql: "id::text like 'de5a0000-%'", match: (r) => r.id.startsWith('de5a0000-') },
  locations: { sql: "id::text like 'de5a0000-%'", match: (r) => r.id.startsWith('de5a0000-') },
  location_boards: { sql: "id::text like 'de5a0000-%'", match: (r) => r.id.startsWith('de5a0000-') },
  location_board_items: { sql: "id::text like 'de5a0000-%'", match: (r) => r.id.startsWith('de5a0000-') },
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
  ['actors', 'id'],
  ['shoots', 'id'],
  ['actor_assignments', 'id'],
  ['creator_applications', 'id'],
  ['actor_applications', 'id'],
  ['approval_boards', 'id'],
  ['approval_votes', 'id'],
  ['studio_shipments', 'id'],
  ['crew_members', 'id'],
  ['props', 'id'],
  ['locations', 'id'],
  ['location_boards', 'id'],
  ['location_board_items', 'id'],
  ['shoot_schedule_blocks', 'id'],
  ['shoot_schedule_block_talent', 'block_id,actor_assignment_id'],
  ['shoot_schedule_block_crew', 'block_id,crew_member_id'],
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

  // Step 5b: production talent. Phone numbers use the 555-01xx range kept for fiction.
  const actorRows = [
    ['Indigo Reyes', 'Female', ['25-34'], ['Comedy', 'Improv'], true],
    ['Jules Carter', 'Male', ['35-44'], ['Voiceover'], false],
    ['Kai Morgan', 'Non-binary', ['18-24'], ['Dance', 'Comedy'], null],
    ['Lane Foster', 'Female', ['45-54'], [], true],
  ];
  const actors = actorRows.map(([name, gender, age_range, skills, dog_owner], i) => ({
    id: id(500 + i), name, email: `${name.split(' ')[0].toLowerCase()}.actor@example.test`, phone: `555-01${String(10 + i)}`,
    gender, age_range, skills, dog_owner, kids_in_videos: null, do_not_use_again: i === 3, source: 'staging_seed',
    notes: null, social_url: null, additional_social_url: null,
  }));
  const actor_assignments = [
    { id: id(600), actor_id: id(500), client_slug: 'demo-harbor', stage: 'booked', scheduled_shoot_date: day(9), shoot_location: 'Test Studio A', shoot_id: id(980) },
    { id: id(601), actor_id: id(501), client_slug: 'demo-harbor', stage: 'shortlisted', scheduled_shoot_date: null, shoot_location: null, shoot_id: null },
    { id: id(602), actor_id: id(502), client_slug: 'demo-pinecrest', stage: 'interested', scheduled_shoot_date: null, shoot_location: null, shoot_id: null },
  ];

  // Step 5b: applications waiting for review, no files. One applicant shares an
  // email with a demo creator so the roster match shows. A re-run sets every
  // demo application back to its seeded status.
  const app = (k, name, email, status, extra = {}) => ({
    id: id(700 + k), status, name, email, gender: null, age_range: ['25-34'], headshot_path: null,
    submitted_at: stamp(-k), reviewed_by: null, reviewed_at: status === 'pending' ? null : stamp(-1),
    review_notes: status === 'rejected' ? 'Demo: outside the current categories' : null, ...extra,
  });
  const creator_applications = [
    app(0, 'Morgan Ellis', 'morgan.applicant@example.test', 'pending', { categories: ['Skincare'], location: 'Testville', socials: { instagram: '@morgan.demo' } }),
    app(1, 'Noa Bennett', 'noa.applicant@example.test', 'pending', { categories: ['Pet', 'Dog'], location: 'Sampletown', website: 'noa.example.test' }),
    app(2, 'Avery Stone', 'avery@example.test', 'pending', { categories: ['Food/Beverage'], location: 'Testville' }),
    app(3, 'Oakley Price', 'oakley.applicant@example.test', 'rejected', { categories: ['Tech'], location: 'Testville' }),
  ];
  const actor_applications = [
    app(50, 'Parker Lane', 'parker.actor-applicant@example.test', 'pending', { phone: '555-0150', gender: 'Male', dog_owner: true }),
    app(51, 'Quinn Avery', 'quinn.actor-applicant@example.test', 'pending', { phone: '555-0151', gender: 'Female', dog_owner: null }),
  ];

  // Step 5b: a live creator approval link for demo-glowdrip with three votes, and
  // an older revoked one. The tokens are made up and exist only in staging, so
  // the old dashboard's public page does not know them.
  const approval_boards = [
    { id: id(800), client_slug: 'demo-glowdrip', board_type: 'creators', month: null, token: 'demoseedLiveBoardGlowdrip00000000000000000000001', expires_at: stamp(10), revoked: false, created_at: stamp(-4) },
    { id: id(801), client_slug: 'demo-glowdrip', board_type: 'creators', month: null, token: 'demoseedOldBoardGlowdrip000000000000000000000002', expires_at: stamp(-20), revoked: true, created_at: stamp(-40) },
  ];
  const approval_votes = [
    { id: id(810), board_id: id(800), assignment_id: id(401), vote: 'up', voted_at: stamp(-2), voted_by: 'Demo reviewer' },
    { id: id(811), board_id: id(800), assignment_id: id(402), vote: 'up', voted_at: stamp(-1), voted_by: null },
    { id: id(812), board_id: id(800), assignment_id: id(403), vote: 'down', voted_at: stamp(-1), voted_by: 'Demo reviewer' },
  ];

  // Step 5c: three made-up spaces (no street addresses; host contacts use
  // @example.test, phones 555-01xx in notes only) and one live link that shares
  // two of them with demo-harbor. The token exists only in staging.
  const locations = [
    { id: id(900), name: 'Demo Loft (made up)', neighborhood: 'Testville', rental_type: 'Peerspace', cost: 150, cost_period: 'hourly',
      listing_url: 'https://listing.example.test/demo-loft', rooms: ['Kitchen', 'Living room'], attributes: ['Natural light'], have_rented: true, dont_rent_again: false,
      contact_name: 'Demo Host One', contact_email: 'host.one@example.test', parking_instructions: 'Street parking (made up)', wifi_name: 'demo-loft-guest',
      wifi_password: null, bedrooms: 1, bathrooms: 1, max_guests: 8, entry_instructions: 'Ring the demo buzzer. Host phone 555-0120.', notes: 'Seed row for staging.' },
    { id: id(901), name: 'Demo Family House (made up)', neighborhood: 'Sampletown', rental_type: 'Airbnb', cost: 900, cost_period: 'daily',
      listing_url: null, rooms: ['Kitchen', 'Backyard', 'Kids room'], attributes: ['Dog friendly'], have_rented: false, dont_rent_again: false,
      contact_name: 'Demo Host Two', contact_email: 'host.two@example.test', parking_instructions: null, wifi_name: null,
      wifi_password: null, bedrooms: 4, bathrooms: 2.5, max_guests: 10, entry_instructions: null, notes: null },
    { id: id(902), name: 'Demo Studio Corner (made up)', neighborhood: 'Testville', rental_type: 'Studio', cost: null, cost_period: null,
      listing_url: null, rooms: ['White cyc'], attributes: [], have_rented: true, dont_rent_again: true,
      contact_name: null, contact_email: null, parking_instructions: null, wifi_name: null,
      wifi_password: null, bedrooms: null, bathrooms: null, max_guests: null, entry_instructions: null, notes: 'Too small for a full crew (made up).' },
  ];
  const location_boards = [
    { id: id(910), client_slug: 'demo-harbor', label: 'Demo spring shoot options', token: 'demoLocationLinkHarbor'.padEnd(48, '0'), revoked: false },
  ];
  const location_board_items = [
    { id: id(911), board_id: id(910), location_id: id(900) },
    { id: id(912), board_id: id(910), location_id: id(901) },
  ];

  // Step 5c: made-up props for the demo production clients. props.client is free
  // text on the old dashboard, so it holds the demo client's name.
  const prop = (k, name, extra) => ({ id: id(950 + k), name, store: null, price: null, return_status: null, client: null, at_studio: true,
    client_supplied: false, bin_number: null, notes: null, ...extra });
  const props = [
    prop(0, 'Demo brass lamp', { store: 'Test Store', price: 39.99, client: 'Harbor Home (demo)', bin_number: 'D1' }),
    prop(1, 'Demo round rug', { store: 'Test Store', price: 120, client: 'Harbor Home (demo)', return_status: 'Returned', at_studio: false }),
    prop(2, 'Demo branded mug', { client: 'Pinecrest Pets (demo)', client_supplied: true, bin_number: 'D2' }),
    prop(3, 'Demo dog bed', { store: 'Sample Pet Shop', price: 64.5, client: 'Pinecrest Pets (demo)', return_status: 'Kept', notes: 'Made-up seed row' }),
  ];

  // Step 5c: made-up crew. Emails at example.test, phones in the 555-01xx range.
  const crewRows = [
    ['Demo Rob Lens', 'Videographer', '$600 / day (made up)', true],
    ['Demo Pat Grip', 'PA', '$250 / day (made up)', true],
    ['Demo Sky Styles', 'Stylist', null, true],
    ['Demo Alex Former', 'Director', null, false],
  ];
  const crew_members = crewRows.map(([name, role, rate_notes, active], i) => ({
    id: id(960 + i), name, role, rate_notes, phone: `555-01${30 + i}`, email: `${name.split(' ')[1].toLowerCase()}.crew@example.test`, notes: null, active,
  }));

  // Step 5c: made-up studio shipments for the demo production clients. One is late
  // against its expected date, one is tied to the booked demo casting, one arrived.
  // Tracking numbers are invented; nothing calls a carrier.
  const studio_shipments = [
    { id: id(970), client_slug: 'demo-harbor', actor_assignment_id: id(600), description: 'Demo: six candles and two throws', carrier: 'UPS', tracking_number: 'DEMO-UPS-0001',
      shipped_at: day(-4), expected_delivery_at: day(-1), delivered_at: null, delivery_notes: null },
    { id: id(971), client_slug: 'demo-harbor', actor_assignment_id: null, description: 'Demo: replacement lamp shade', carrier: 'USPS', tracking_number: 'DEMO-USPS-0002',
      shipped_at: day(-1), expected_delivery_at: day(3), delivered_at: null, delivery_notes: null },
    { id: id(972), client_slug: 'demo-pinecrest', actor_assignment_id: null, description: 'Demo: dog treats and toys', carrier: null, tracking_number: null,
      shipped_at: day(-10), expected_delivery_at: day(-6), delivered_at: day(-6), delivery_notes: 'Arrived fine (made up)' },
  ];

  // Step 5c: one demo shoot for demo-harbor on the booked casting's date, with two
  // schedule blocks. The typed location matches the casting, as the shoot functions keep it.
  const shoots = [
    { id: id(980), client_slug: 'demo-harbor', shoot_date: day(9), location: 'Test Studio A', location_id: null, notes: 'Demo shoot (made up)' },
  ];
  const shoot_schedule_blocks = [
    { id: id(981), shoot_id: id(980), label: 'Setup and lighting', start_time: '08:00', end_time: '09:30', location: null, notes: null },
    { id: id(982), shoot_id: id(980), label: 'Kitchen scenes', start_time: '09:30', end_time: '12:00', location: 'Kitchen', notes: 'Demo props from bin D1' },
  ];
  const shoot_schedule_block_talent = [{ block_id: id(982), actor_assignment_id: id(600) }];
  const shoot_schedule_block_crew = [
    { block_id: id(981), crew_member_id: id(960) },
    { block_id: id(982), crew_member_id: id(960) },
    { block_id: id(982), crew_member_id: id(961) },
  ];

  return { clients, app_users, client_ad_accounts, engagements, deliverables, dashboard_creators, creator_assignments, pipeline_tasks, actors, actor_assignments, creator_applications, actor_applications, approval_boards, approval_votes, shoots, shoot_schedule_blocks, shoot_schedule_block_talent, shoot_schedule_block_crew, studio_shipments, crew_members, props, locations, location_boards, location_board_items };
}
