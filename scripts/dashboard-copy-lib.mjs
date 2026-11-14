// Shared pieces of the one-time dashboard to Verdanote staging data copy.
// See docs/dashboard-copy.md. Pure functions plus two small API clients so the
// safety rules can be tested without a network.

import { SEED_MARKERS } from './seed-staging-dashboard-lib.mjs';

export const DASHBOARD_REF = 'qlvdvpchriyrsjtewwxx'; // old dashboard (read only)
export const STAGING_REF = 'mnvcksbhbvypuiwozvct'; // verdanote-staging (write)
export const PRODUCTION_REF = 'gwyxaqoaldnaavkjqquv'; // Verdanote production (never touched)

// Source name -> target name. Verdanote already owns public.creators.
export const RENAMED = { creators: 'dashboard_creators' };

// Parents before children. [targetName, primaryKeyColumns]
export const TABLES = [
  ['actors', ['id']],
  ['app_users', ['id']],
  ['clients', ['slug']],
  ['creator_applications', ['id']],
  ['dashboard_creators', ['id']],
  ['crew_members', ['id']],
  ['deliverables', ['id']],
  ['location_boards', ['id']],
  ['locations', ['id']],
  ['props', ['id']],
  ['shoots', ['id']],
  ['actor_applications', ['id']],
  ['actor_assignments', ['id']],
  ['actor_photos', ['id']],
  ['actor_videos', ['id']],
  ['application_videos', ['id']],
  ['approval_boards', ['id']],
  ['call_sheets', ['id']],
  ['creator_assignments', ['id']],
  ['creator_filming_locations', ['id']],
  ['creator_photos', ['id']],
  ['creator_videos', ['id']],
  ['location_board_items', ['id']],
  ['location_photos', ['id']],
  ['shoot_schedule_blocks', ['id']],
  ['studio_shipments', ['id']],
  ['actor_application_videos', ['id']],
  ['actor_approval_votes', ['id']],
  ['approval_votes', ['id']],
  ['call_sheet_crew', ['call_sheet_id', 'crew_member_id']],
  ['shoot_schedule_block_crew', ['block_id', 'crew_member_id']],
  ['shoot_schedule_block_talent', ['block_id', 'actor_assignment_id']],
];

export const sourceName = (target) => Object.keys(RENAMED).find((k) => RENAMED[k] === target) || target;

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`unsafe identifier ${s}`);
  return s;
};

// ------------------------------------------------------------------ guards

export function assertTargets({ sourceRef, targetRef, confirmSource }) {
  if (sourceRef !== DASHBOARD_REF) throw new Error(`source must be the old dashboard (${DASHBOARD_REF})`);
  if (targetRef === PRODUCTION_REF) throw new Error('refusing to write to Verdanote production');
  if (targetRef === DASHBOARD_REF) throw new Error('refusing to write to the old dashboard');
  if (targetRef !== STAGING_REF) throw new Error(`target must be verdanote-staging (${STAGING_REF})`);
  if (confirmSource !== DASHBOARD_REF) {
    throw new Error(`pass --confirm-source ${DASHBOARD_REF} once Matthew has confirmed the read of the production dashboard database`);
  }
}

// ------------------------------------------------------------------ arguments
//
// Dry run by default. With no flags the script prints the plan and touches no
// network. --confirm-source alone reads row counts and checksums from both
// sides and writes nothing. Writing needs --write, --confirm-source AND
// --real-client-data-approved: copying real client data into staging is the
// owner's decision 10 in the consolidation plan (default: made-up test clients
// only), so the flag is only passed once Matthew has said yes.

const VALUE_FLAGS = new Set(['confirm-source', 'report', 'page']);
const BOOL_FLAGS = new Set(['write', 'replace', 'real-client-data-approved']);

export function parseArgs(argv) {
  const out = { write: false, replace: false, realClientDataApproved: false, confirmSource: undefined, report: undefined, page: 400 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const name = a.slice(2);
    if (BOOL_FLAGS.has(name)) {
      if (name === 'write') out.write = true;
      if (name === 'replace') out.replace = true;
      if (name === 'real-client-data-approved') out.realClientDataApproved = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new Error(`unknown option --${name}`);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`--${name} needs a value`);
    if (name === 'confirm-source') out.confirmSource = v;
    if (name === 'report') out.report = v;
    if (name === 'page') {
      out.page = Number(v);
      if (!Number.isInteger(out.page) || out.page < 1 || out.page > 5000) throw new Error('--page must be a whole number from 1 to 5000');
    }
  }
  // A production or old-dashboard ref may only appear as the read confirmation.
  for (const v of [out.report].filter(Boolean)) {
    if (v.includes(PRODUCTION_REF) || v.includes(DASHBOARD_REF)) throw new Error('a project ref is not accepted here');
  }
  if (out.replace && !out.write) throw new Error('--replace only makes sense with --write');
  return out;
}

export function runMode(args) {
  if (args.write) return 'write';
  if (args.confirmSource) return 'counts';
  return 'plan';
}

export function assertWriteAllowed(args) {
  if (!args.write) return;
  if (args.confirmSource !== DASHBOARD_REF) throw new Error(`--write needs --confirm-source ${DASHBOARD_REF}`);
  if (!args.realClientDataApproved) {
    throw new Error('--write copies real client data into staging. Decision 10 (owner): made-up test clients only unless Matthew says otherwise. Pass --real-client-data-approved only after he has.');
  }
}

// Rows the made-up staging seed owns (scripts/seed-staging-dashboard-lib.mjs).
// Checksums on the staging side leave them out so a seeded staging can still
// match the source.
export const seedFilter = (table) => SEED_MARKERS[table]?.sql ?? null;

// --replace never empties `clients`: since the one client model (PR 143) other
// tables (engagements, client_ad_accounts, pipeline_tasks, knowledge, meeting
// recaps) point at clients.slug, and with triggers off a delete would leave
// them orphaned. Client rows are only ever added (on conflict do nothing).
export const REPLACE_SKIP = new Set(['clients']);

export function renderPlan() {
  const lines = ['Dashboard copy plan (dry run, nothing read or written).', ''];
  lines.push(`Source, read only: old dashboard ${DASHBOARD_REF} (Management API read-only endpoint).`);
  lines.push(`Target: verdanote-staging ${STAGING_REF}. Production ${PRODUCTION_REF} is refused.`);
  lines.push('', 'Tables in load order:');
  for (const [t, pk] of TABLES) {
    const src = sourceName(t);
    const notes = [src !== t ? `from ${src}` : null, seedFilter(t) ? `seed rows left out of checksum: ${seedFilter(t)}` : null, REPLACE_SKIP.has(t) ? 'never emptied by --replace' : null].filter(Boolean);
    lines.push(`  ${t} (key ${pk.join(', ')})${notes.length ? '  ' + notes.join('; ') : ''}`);
  }
  lines.push('', 'Next: --confirm-source <ref> reads counts and checksums only. --write also needs --real-client-data-approved (owner decision 10).');
  return lines.join('\n') + '\n';
}

export const isReadOnlySql =(sql) => /^\s*(with\b[\s\S]*?\bselect\b|select\b)/i.test(sql) && !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do)\b/i.test(sql.replace(/'[^']*'/g, "''"));

// ------------------------------------------------------------------ clients

const API = 'https://api.supabase.com/v1/projects';

// Read-only: only ever calls the read-only endpoint, which the database runs as
// supabase_read_only_user. It also refuses anything that is not a select.
export function makeSourceClient({ token, ref = DASHBOARD_REF, fetchImpl = fetch }) {
  if (!token) throw new Error('missing token for the source project');
  return {
    ref,
    async query(sql) {
      if (!isReadOnlySql(sql)) throw new Error('source client only runs select statements');
      const r = await fetchImpl(`${API}/${ref}/database/query/read-only`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      });
      const text = await r.text();
      if (r.status >= 300) throw new Error(`source query failed (${r.status}): ${text.slice(0, 300)}`);
      return JSON.parse(text);
    },
  };
}

export function makeTargetClient({ token, ref = STAGING_REF, fetchImpl = fetch }) {
  if (!token) throw new Error('missing token for the staging project');
  if (ref !== STAGING_REF) throw new Error('target client is staging only');
  return {
    ref,
    async query(sql) {
      const r = await fetchImpl(`${API}/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      });
      const text = await r.text();
      if (r.status >= 300) throw new Error(`staging query failed (${r.status}): ${text.slice(0, 300)}`);
      return JSON.parse(text);
    },
  };
}

// ------------------------------------------------------------------ SQL builders

export const countSql = (schemaTable) => `select count(*)::int as n from public.${ident(schemaTable)}`;

export function checksumSql(table, pk, where = null) {
  const order = pk.map(ident).join(', ');
  const filter = where ? ` where not (${where})` : '';
  return `select count(*)::int as n, coalesce(md5(string_agg(to_jsonb(t)::text, '|' order by ${order})), 'empty') as sum from public.${ident(table)} t${filter}`;
}

export function pageSql(table, pk, limit, offset) {
  const order = pk.map(ident).join(', ');
  return `select to_jsonb(t) as row from public.${ident(table)} t order by ${order} limit ${Number(limit)} offset ${Number(offset)}`;
}

// Dollar quoting with a tag that cannot appear in the data.
export function dollarQuote(text) {
  let tag = 'dc';
  let i = 0;
  while (text.includes(`$${tag}$`)) tag = `dc${++i}`;
  return `$${tag}$${text}$${tag}$`;
}

// Triggers are switched off for the load (session_replication_role = replica)
// so values such as stage_changed_at are copied, not recomputed.
export function insertSql(table, rows) {
  const t = ident(table);
  const json = dollarQuote(JSON.stringify(rows));
  return `begin;
set local session_replication_role = replica;
insert into public.${t} select * from jsonb_populate_recordset(null::public.${t}, ${json}::jsonb) on conflict do nothing;
commit;`;
}

export const clearSql = (tables) =>
  `begin;\nset local session_replication_role = replica;\n${[...tables].reverse().filter((t) => !REPLACE_SKIP.has(t)).map((t) => `delete from public.${ident(t)};`).join('\n')}\ncommit;`;

export const counterSql = (value) =>
  `insert into public.ad_name_counter (id, value) values (1, ${Number(value)})
on conflict (id) do update set value = greatest(public.ad_name_counter.value, excluded.value), updated_at = now();`;

// ------------------------------------------------------------------ report

export function renderReport({ startedAt, rows, counter, roles, storage, notes }) {
  const ok = rows.every((r) => r.match);
  const lines = [];
  lines.push('# Dashboard to Verdanote staging: data copy report', '');
  lines.push(`Run at ${startedAt}. Source: old dashboard (${DASHBOARD_REF}), read only. Target: verdanote-staging (${STAGING_REF}).`, '');
  lines.push(`Result: ${ok ? 'every table matches' : 'MISMATCH, see below'}.`, '');
  lines.push('| Table | Source rows | Staging rows | Match |', '|---|---:|---:|---|');
  for (const r of rows) lines.push(`| ${r.source} -> ${r.target} | ${r.sourceCount} | ${r.targetCount} | ${r.match ? 'yes' : 'NO'} |`);
  lines.push('');
  if (counter) lines.push(`Ad code counter: source ${counter.source}, staging ${counter.target}.`, '');
  if (roles) {
    lines.push('## Team roles', '');
    lines.push('| Dashboard role | People | Verdanote role | Already has a staging login |', '|---|---:|---|---:|');
    for (const r of roles) lines.push(`| ${r.role} | ${r.n} | ${r.mapped || 'none (viewer)'} | ${r.with_login} |`);
    lines.push('');
  }
  if (storage && storage.length) {
    lines.push('## Storage files still to copy', '');
    lines.push('| Bucket | Files | Size (MB) |', '|---|---:|---:|');
    for (const s of storage) lines.push(`| ${s.bucket_id} | ${s.files} | ${(Number(s.bytes || 0) / 1048576).toFixed(1)} |`);
    lines.push('');
  }
  for (const n of notes || []) lines.push(`- ${n}`);
  return lines.join('\n') + '\n';
}
