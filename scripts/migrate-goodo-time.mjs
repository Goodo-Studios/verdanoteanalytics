#!/usr/bin/env node
// Copy Goodo Time into the app's time_ tables (story OS-011), then check the copy.
//
// Reads Goodo Time's Postgres read-only and writes to the target Supabase project as the
// service role. Refuses any target other than the staging project unless --allow-production
// is passed. Safe to re-run: every row is upserted on source_id (Goodo Time's id).
//
// What is copied: people (email, name, role, active, monthly fee), clients, projects,
// invoices, invoice lines and every time entry, including running timers. People are matched
// to app logins by email (time_link_people); someone with no login keeps their entries.
// What is not copied: passwords and sign-in state, addresses (invoice_from, from_details) and
// payment details.
//
// After copying it prints tracked hours per person per month from Goodo Time and from the
// target, plus row counts, and exits non-zero if anything differs.
//
//   --dry-run           read Goodo Time, map every row, print the source totals; write nothing
//   --allow-production  allow a target that is not the staging project
//
// Needs the `pg` package (not an app dependency):  npm install --no-save pg
//
//   hq secrets exec --company goodo-studios \
//     --only GOODO_TIME_DATABASE_URL,TARGET_SUPABASE_URL,TARGET_SUPABASE_SERVICE_ROLE_KEY \
//     -- node scripts/migrate-goodo-time.mjs --dry-run
import { createClient } from '@supabase/supabase-js';
import {
  DEFAULT_ZONE,
  assertTarget,
  compareCounts,
  compareTotals,
  formatTotals,
  mapClient,
  mapEntry,
  mapInvoice,
  mapInvoiceLine,
  mapPerson,
  mapProject,
  parseArgs,
  totalsByPersonMonth,
} from './migrate-goodo-time-lib.mjs';

const BATCH = 500;
const PAGE = 1000;

function fail(message) {
  console.error(`FAILED ${message}`);
  process.exit(1);
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  fail(err.message);
}
if (opts.help) {
  console.log('Usage: node scripts/migrate-goodo-time.mjs [--dry-run] [--allow-production]');
  process.exit(0);
}

const zone = process.env.GOODO_TIME_TIMEZONE || DEFAULT_ZONE;
const sourceUrl = process.env.GOODO_TIME_DATABASE_URL;
const targetUrl = process.env.TARGET_SUPABASE_URL;
const targetKey = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;
if (!sourceUrl) fail('Set GOODO_TIME_DATABASE_URL.');
let targetHost;
if (!opts.dryRun) {
  try {
    targetHost = assertTarget(targetUrl, { allowProduction: opts.allowProduction });
  } catch (err) {
    fail(err.message);
  }
  if (!targetKey) fail('Set TARGET_SUPABASE_SERVICE_ROLE_KEY.');
}

// ---------------------------------------------------------------- read Goodo Time (read only)

let pg;
try {
  pg = (await import('pg')).default;
} catch {
  fail('The pg package is missing. Run: npm install --no-save pg');
}
// Keep DATE columns as "YYYY-MM-DD" text instead of local-midnight Date objects.
pg.types.setTypeParser(1082, (value) => value);

const source = new pg.Client({
  connectionString: sourceUrl,
  options: '-c default_transaction_read_only=on',
});
await source.connect();
let src;
try {
  await source.query('BEGIN READ ONLY');
  const read = async (sql) => (await source.query(sql)).rows;
  src = {
    users: await read('SELECT id, email, name, role, active, monthly_fee_cents FROM users ORDER BY id'),
    clients: await read('SELECT id, name, archived, created_at FROM clients ORDER BY id'),
    projects: await read('SELECT id, client_id, name, archived, created_at FROM projects ORDER BY id'),
    invoices: await read(`SELECT id, user_id, number, status, period_from, period_to, issued_on, due_on, bill_to, notes,
                                 submitted_at, paid_at, created_at, updated_at FROM invoices ORDER BY id`),
    lines: await read('SELECT id, invoice_id, kind, description, seconds, amount_cents, position FROM invoice_lines ORDER BY id'),
    entries: await read(`SELECT id, user_id, project_id, description, start_at, end_at, invoice_id, created_at, updated_at
                           FROM time_entries ORDER BY id`),
  };
  await source.query('COMMIT');
} finally {
  await source.end();
}

const emailBySourceUser = new Map(src.users.map((u) => [Number(u.id), mapPerson(u).email]));
const sourceTotals = totalsByPersonMonth(
  src.entries.map((e) => ({ email: emailBySourceUser.get(Number(e.user_id)), start_at: e.start_at, end_at: e.end_at })),
  zone,
);
const sourceCounts = {
  time_people: src.users.length,
  time_clients: src.clients.length,
  time_projects: src.projects.length,
  time_invoices: src.invoices.length,
  time_invoice_lines: src.lines.length,
  time_entries: src.entries.length,
};

// ---------------------------------------------------------------- dry run

if (opts.dryRun) {
  // Map everything with placeholder ids so a bad row fails here, before any write.
  const fake = (rows) => new Map(rows.map((r) => [Number(r.id), `source-${r.id}`]));
  const personIds = fake(src.users);
  const clientIds = fake(src.clients);
  const projectIds = fake(src.projects);
  const invoiceIds = fake(src.invoices);
  try {
    src.users.forEach(mapPerson);
    src.clients.forEach(mapClient);
    src.projects.forEach((p) => mapProject(p, clientIds));
    src.invoices.forEach((i) => mapInvoice(i, personIds));
    src.lines.forEach((l) => mapInvoiceLine(l, invoiceIds));
    src.entries.forEach((e) => mapEntry(e, { personIds, projectIds, invoiceIds }));
  } catch (err) {
    fail(err.message);
  }
  console.log('Dry run: nothing was written.');
  console.log('Rows in Goodo Time:', JSON.stringify(sourceCounts));
  console.log(`Running timers: ${src.entries.filter((e) => e.end_at == null).length}`);
  console.log(`Hours per person per month (${zone}, completed entries):`);
  console.log(formatTotals(sourceTotals));
  process.exit(0);
}

// ---------------------------------------------------------------- write the target

const db = createClient(targetUrl, targetKey, { auth: { persistSession: false } });

async function upsert(table, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + BATCH), { onConflict: 'source_id' });
    if (error) fail(`${table}: ${error.message}`);
  }
  console.log(`ok  ${table} ${rows.length} rows`);
}

async function readAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).order('id').range(from, from + PAGE - 1);
    if (error) fail(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function idMap(table) {
  const rows = await readAll(table, 'id, source_id');
  return new Map(rows.filter((r) => r.source_id != null).map((r) => [Number(r.source_id), r.id]));
}

console.log(`Copying Goodo Time into ${targetHost}`);
await upsert('time_people', src.users.map(mapPerson));
const personIds = await idMap('time_people');
await upsert('time_clients', src.clients.map(mapClient));
const clientIds = await idMap('time_clients');
await upsert('time_projects', src.projects.map((p) => mapProject(p, clientIds)));
const projectIds = await idMap('time_projects');
await upsert('time_invoices', src.invoices.map((i) => mapInvoice(i, personIds)));
const invoiceIds = await idMap('time_invoices');
await upsert('time_invoice_lines', src.lines.map((l) => mapInvoiceLine(l, invoiceIds)));
await upsert('time_entries', src.entries.map((e) => mapEntry(e, { personIds, projectIds, invoiceIds })));

const { data: linked, error: linkError } = await db.rpc('time_link_people');
if (linkError) fail(`time_link_people: ${linkError.message}`);
console.log(`ok  linked ${linked} people to app logins by email`);

// ---------------------------------------------------------------- check the copy

const targetPeople = await readAll('time_people', 'id, email, user_id, source_id');
const emailByPerson = new Map(targetPeople.map((p) => [p.id, p.email]));
const targetEntries = await readAll('time_entries', 'id, person_id, start_at, end_at, source_id');
const copied = targetEntries.filter((e) => e.source_id != null);
const targetTotals = totalsByPersonMonth(
  copied.map((e) => ({ email: emailByPerson.get(e.person_id), start_at: e.start_at, end_at: e.end_at })),
  zone,
);
const targetCounts = {
  time_people: targetPeople.filter((p) => p.source_id != null).length,
  time_clients: clientIds.size,
  time_projects: projectIds.size,
  time_invoices: invoiceIds.size,
  time_invoice_lines: (await idMap('time_invoice_lines')).size,
  time_entries: copied.length,
};

console.log(`Hours per person per month (${zone}, completed entries):`);
console.log(formatTotals(sourceTotals, targetTotals));
console.log('Rows copied:', JSON.stringify(targetCounts));
const unlinked = targetPeople.filter((p) => p.source_id != null && p.user_id == null).map((p) => p.email);
if (unlinked.length) console.log(`No app login yet (entries kept): ${unlinked.join(', ')}`);

const totalDiffs = compareTotals(sourceTotals, targetTotals);
const countDiffs = compareCounts(sourceCounts, targetCounts);
if (totalDiffs.length || countDiffs.length) {
  for (const d of countDiffs) console.error(`DIFFERENT ${d.table}: source ${d.source}, target ${d.target}`);
  for (const d of totalDiffs) console.error(`DIFFERENT ${d.key}: source ${d.source.ms} ms, target ${d.target.ms} ms`);
  fail('the copy does not match Goodo Time.');
}
console.log('ok  every entry is present and the totals per person per month match Goodo Time');
