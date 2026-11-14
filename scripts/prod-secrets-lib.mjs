// Pure pieces of scripts/prod-secrets-status.mjs: the list of secrets the
// functions and the database rely on, and the comparison with what a project
// actually has. Names only, never values. See docs/staging.md step 6.

import { PRODUCTION_REF, PLATFORM_SECRETS } from './prod-cutover-lib.mjs';

// kind: 'secret' = an edge function secret, 'flag' = a function secret that is off
// by design until the owner decides, 'vault' = a database vault secret.
export const SECRET_CATALOG = [
  { name: 'SITE_URL', kind: 'secret', readBy: 'every function (browser CORS)', ifMissing: 'Browser calls are answered with "*" instead of only https://www.verdanote.com. Works, but is wider than intended.' },
  { name: 'ANTHROPIC_API_KEY', kind: 'secret', readBy: 'client-insights, meeting-recaps, reports, vault-analyze, agent-evaluations', ifMissing: 'Client insights come back empty (reason ai_key_missing); the other AI steps fail.' },
  { name: 'META_ACCESS_TOKEN', kind: 'secret', readBy: 'the ad sync and backfill functions', ifMissing: 'The ad sync cannot read Meta; spend and creatives stop updating.' },
  { name: 'CLICKUP_API_TOKEN', kind: 'secret', readBy: 'sync-clickup-tasks, push-brief-to-clickup, clickup-folders, clickup-os-sync, clickup-webhook', ifMissing: 'The ClickUp sync answers 503 clickup.no_token and client boards go stale; the folder picker and the Push to ClickUp buttons fail; the task copy into os_tasks does not run.' },
  { name: 'CLICKUP_WEBHOOK_SECRET', kind: 'secret', readBy: 'clickup-webhook', ifMissing: 'The webhook answers 401 to every ClickUp event, so task changes arrive only with the nightly sync.' },
  { name: 'FIREFLIES_API_KEY', kind: 'secret', readBy: 'fireflies-transcript, meeting-recaps, integration-health', ifMissing: 'Meeting recaps cannot pull transcripts (503).' },
  { name: 'RESEND_API_KEY', kind: 'secret', readBy: 'send-digest', ifMissing: 'The weekly digest is built and marked sent but never emailed.' },
  { name: 'SLACK_BOT_TOKEN', kind: 'secret', readBy: 'run-slack-jobs, integration-health', ifMissing: 'run-slack-jobs answers 503 and the queue grows; no Slack message goes out.' },
  { name: 'SLACK_WEBHOOK_URL', kind: 'secret', readBy: 'system-health-check, reports, scheduled-reports, sync, refresh-media-queue', ifMissing: 'A failing health check and report alerts post nothing.' },
  { name: 'CLICKUP_WRITEBACK_ENABLED', kind: 'flag', readBy: 'clickup-writeback', ifMissing: 'Write-back to ClickUp stays off: app edits are held and nothing is sent. This is the intended state until the owner picks a test list.' },
  { name: 'CLICKUP_WRITEBACK_LIST_IDS', kind: 'flag', readBy: 'clickup-writeback', ifMissing: 'No ClickUp list is allowed for write-back (every row is held). Set together with CLICKUP_WRITEBACK_ENABLED, only after the owner picks a test list.' },
  { name: 'CLIENT_INVITES_SEND_ENABLED', kind: 'flag', readBy: 'client-invite', ifMissing: 'Client invites stay a dry run that lists what would be sent and sends nothing. Intended until the owner approves sending.' },
  { name: 'storage_signing_project_url', kind: 'vault', readBy: 'approve_application, approve_actor_application, delete location', ifMissing: 'Approving an application that has files fails and changes nothing; deleting a location leaves its photos in storage.' },
  { name: 'storage_signing_service_role_key', kind: 'vault', readBy: 'approve_application, approve_actor_application, delete location', ifMissing: 'Same as above.' },
];

// vaultNames === null means the check could not run (reported as "could not check").
export function evaluateSecrets({ deployedNames, vaultNames }) {
  const have = new Set(deployedNames);
  const vault = vaultNames === null ? null : new Set(vaultNames);
  const rows = SECRET_CATALOG.map((s) => {
    let status;
    if (s.kind === 'vault') status = vault === null ? 'could not check' : vault.has(s.name) ? 'set' : 'missing';
    else status = have.has(s.name) ? 'set' : (s.kind === 'flag' ? 'off' : 'missing');
    return { ...s, status };
  });
  const known = new Set(SECRET_CATALOG.map((s) => s.name));
  const other = deployedNames.filter((n) => !known.has(n) && !PLATFORM_SECRETS.has(n)).sort();
  return { rows, other };
}

export function setCommand(name, ref = PRODUCTION_REF) {
  return `hq secrets exec --company goodo-studios --only SUPABASE_ACCESS_TOKEN,${name} -- sh -c 'supabase secrets set ${name}="$${name}" --project-ref ${ref}'`;
}

export function renderStatus({ rows, other, projectName, ref, vaultError }) {
  const lines = [];
  lines.push(`Secrets on ${projectName} (${ref}). Names only; no value was read or printed.`, '');
  lines.push('| Secret | Where | Status | Read by |', '|---|---|---|---|');
  for (const r of rows) lines.push(`| ${r.name} | ${r.kind === 'vault' ? 'database vault' : 'function secret'} | ${r.status} | ${r.readBy} |`);
  lines.push('');
  const missing = rows.filter((r) => r.status === 'missing');
  const off = rows.filter((r) => r.status === 'off');
  const unchecked = rows.filter((r) => r.status === 'could not check');
  if (missing.length) {
    lines.push('Missing, and what stays off or broken until each is set:', '');
    for (const r of missing) lines.push(`- ${r.name}: ${r.ifMissing}`);
    lines.push('');
    const fn = missing.filter((r) => r.kind === 'secret');
    if (fn.length) {
      lines.push('Set one from the vault (the vault entry name may differ; check `hq secrets list --company goodo-studios`), then redeploy the functions that read it:', '');
      for (const r of fn) lines.push(`  ${setCommand(r.name, ref)}`);
      lines.push('');
    }
    const vaultMissing = missing.filter((r) => r.kind === 'vault');
    if (vaultMissing.length) {
      lines.push('Vault secrets are set in the SQL editor of the project with `select vault.create_secret(<value>, <name>);`, from the vault, never pasted into chat or a file.', '');
    }
  }
  if (off.length) {
    lines.push('Off by design (not a gap; each needs an owner decision before it is set):', '');
    for (const r of off) lines.push(`- ${r.name}: ${r.ifMissing}`);
    lines.push('');
  }
  if (unchecked.length) {
    lines.push(`The database vault could not be checked${vaultError ? ` (${vaultError})` : ''}. Check storage_signing_secrets_present() in Integration health, or run the vault names query in the SQL editor.`, '');
  }
  if (other.length) lines.push(`Other secret names set on this project and not in the table above: ${other.join(', ')}.`, '');
  if (!missing.length && !unchecked.length) lines.push('Nothing missing.', '');
  return lines.join('\n');
}
