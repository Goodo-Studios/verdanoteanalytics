#!/usr/bin/env node
// Step 6 of the release: which of the documented secrets are set on a project,
// names only, and for each missing one what stays off. Read only.
//
//   hq secrets exec --company goodo-studios --only SUPABASE_ACCESS_TOKEN -- \
//     node scripts/prod-secrets-status.mjs
//
// Options:
//   --target <production|staging>   default production (staging uses VERDANOTE_STAGING_SUPABASE_ACCESS_TOKEN)
//   --strict                        exit 1 when a function secret or vault secret is missing
//
// Calls only: GET /v1/projects/{ref}/secrets (the API also returns a digest of
// each value, which is dropped before anything is printed) and a select of the
// vault names through the read-only database endpoint. Nothing is changed.

import { parseFlags, makeManagementClient, projectTarget } from './prod-cutover-lib.mjs';
import { evaluateSecrets, renderStatus } from './prod-secrets-lib.mjs';

let flags;
let target;
try {
  flags = parseFlags(process.argv.slice(2), { valueFlags: ['target'], boolFlags: ['strict'] });
  target = projectTarget(flags.target);
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

let deployedNames;
try {
  deployedNames = await client.listSecretNames();
} catch (e) {
  console.error(String(e.message));
  process.exit(2);
}

// Database vault names. decrypted_secrets first (the name the docs use), then the
// ciphertext table; only the name column is ever selected.
let vaultNames = null;
let vaultError = '';
for (const sql of ['select name from vault.decrypted_secrets order by name', 'select name from vault.secrets order by name']) {
  try {
    vaultNames = (await client.readOnlyQuery(sql)).map((r) => r.name).filter(Boolean);
    vaultError = '';
    break;
  } catch (e) {
    vaultError = String(e.message).slice(0, 100);
  }
}

const result = evaluateSecrets({ deployedNames, vaultNames });
process.stdout.write(renderStatus({ ...result, projectName: target.name, ref: target.ref, vaultError }));

const gap = result.rows.some((r) => r.status === 'missing' || r.status === 'could not check');
process.exit(flags.strict && gap ? 1 : 0);
