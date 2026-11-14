#!/usr/bin/env node
// Step 14 of the release: remove what Coda left behind on production.
//
//   hq secrets exec --company goodo-studios --only SUPABASE_ACCESS_TOKEN -- \
//     node scripts/coda-cleanup.mjs
//     read only: lists deployed functions that no longer exist in supabase/functions
//     (create-coda-brief, sync-coda-names, sync-coda-tasks and any others), and
//     secrets that no function code mentions (CODA_API_KEY), with the
//     `supabase secrets unset` commands printed and never run.
//
//   ... node scripts/coda-cleanup.mjs --delete <the exact list it printed> --confirm-production gwyxaqoaldnaavkjqquv
//     deletes those functions. Refused unless the list matches the current list
//     exactly. Secrets are never unset by this script.
//
// Options:
//   --target <production|staging>   default production; staging is list only
//   --delete <name,name,...>        delete exactly these functions (production only)
//   --confirm-production <ref>      the exact production project ref, needed with --delete
//
// Never touches Coda itself.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlags, makeManagementClient, projectTarget, localFunctionNames, namesMentionedInCode, PRODUCTION_REF } from './prod-cutover-lib.mjs';
import { planCleanup, assertDeleteAllowed, renderCleanup } from './coda-cleanup-lib.mjs';

const functionsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../supabase/functions');

let flags;
let target;
try {
  flags = parseFlags(process.argv.slice(2), { valueFlags: ['target', 'delete', 'confirm-production'], refFlags: ['confirm-production'] });
  target = projectTarget(flags.target);
  if (flags.delete !== undefined) {
    // Refused before any network call when the target or the production ref is wrong.
    if (target.name !== 'production') throw new Error('--delete only runs on production. Staging functions are removed with supabase functions delete by hand.');
    if (flags['confirm-production'] !== PRODUCTION_REF) throw new Error(`refusing to delete on Verdanote production without --confirm-production ${PRODUCTION_REF}`);
  } else if (flags['confirm-production'] !== undefined) {
    throw new Error('--confirm-production only goes with --delete');
  }
} catch (e) {
  console.error(String(e.message));
  process.exit(2);
}

let client;
try {
  client = makeManagementClient({ token: process.env[target.tokenEnv], ref: target.ref });
} catch (e) {
  console.error(`${e.message}. Expected ${target.tokenEnv} from hq secrets exec.`);
  process.exit(2);
}

const deployed = await client.listFunctions();
const secretNames = await client.listSecretNames();
const plan = planCleanup({
  deployed,
  local: localFunctionNames(functionsDir),
  secretNames,
  mentioned: namesMentionedInCode(functionsDir),
});

// Read-only database checks, each on its own so one failure does not hide the rest.
const checks = [];
for (const [label, sql, fmt] of [
  ['Cron jobs with coda in the name', "select jobname from cron.job where jobname ilike '%coda%'", (r) => (r.length ? r.map((x) => x.jobname).join(', ') : 'none')],
  ['Table coda_tasks', "select to_regclass('public.coda_tasks') is not null as present", (r) => (r[0]?.present ? 'still exists (migration 20261110000001 not applied)' : 'gone')],
]) {
  try { checks.push({ label, result: fmt(await client.readOnlyQuery(sql)) }); } catch (e) { checks.push({ label, result: `could not check (${String(e.message).slice(0, 80)})` }); }
}

process.stdout.write(renderCleanup({ plan, projectName: target.name, ref: target.ref, checks }));

if (flags.delete === undefined) process.exit(0);

let confirmed;
try {
  confirmed = assertDeleteAllowed({ target: target.name, deleteList: flags.delete, confirmProduction: flags['confirm-production'], orphans: plan.orphans });
} catch (e) {
  console.error(String(e.message));
  process.exit(2);
}

let failed = 0;
for (const slug of confirmed) {
  try {
    await client.deleteFunction(slug);
    console.log(`deleted ${slug}`);
  } catch (e) {
    failed++;
    console.error(`FAILED ${slug}: ${e.message}`);
  }
}
const after = planCleanup({ deployed: await client.listFunctions(), local: localFunctionNames(functionsDir), secretNames, mentioned: new Set() });
console.log(after.orphans.length ? `Still deployed without a folder: ${after.orphans.join(', ')}` : 'Every deployed function now has a folder in the repo.');
process.exit(failed || after.orphans.length ? 1 : 0);
