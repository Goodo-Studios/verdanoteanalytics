// Pure pieces of scripts/coda-cleanup.mjs (step 14 of the release): which deployed
// functions no longer exist in the repo, which secrets no function reads, and the
// confirmation a delete needs. No network here.

import { PRODUCTION_REF, orphanFunctions, unreadSecrets } from './prod-cutover-lib.mjs';

export const looksLikeCoda = (name) => /coda/i.test(name);

export function planCleanup({ deployed, local, secretNames, mentioned }) {
  const orphans = orphanFunctions(deployed, local);
  return {
    orphans,
    codaOrphans: orphans.filter(looksLikeCoda),
    otherOrphans: orphans.filter((n) => !looksLikeCoda(n)),
    unread: unreadSecrets(secretNames, mentioned),
  };
}

export const deleteCommand = (slug, ref = PRODUCTION_REF) => `supabase functions delete ${slug} --project-ref ${ref}`;
export const unsetCommand = (name, ref = PRODUCTION_REF) => `supabase secrets unset ${name} --project-ref ${ref}`;

// A delete needs: production as the target, the production ref typed out, and the
// exact list of names the script printed. A shorter, longer or different list is
// refused, so a stale list cannot delete something that was not reviewed.
export function assertDeleteAllowed({ target, deleteList, confirmProduction, orphans }) {
  if (target !== 'production') throw new Error('--delete only runs on production. Staging functions are removed with supabase functions delete by hand.');
  if (confirmProduction !== PRODUCTION_REF) throw new Error(`refusing to delete on Verdanote production without --confirm-production ${PRODUCTION_REF}`);
  const asked = String(deleteList).split(',').map((s) => s.trim()).filter(Boolean).sort();
  if (!orphans.length) throw new Error('nothing to delete: every deployed function has a folder in the repo');
  const want = [...orphans].sort();
  if (asked.length !== want.length || asked.some((n, i) => n !== want[i])) {
    throw new Error(`the list does not match the functions that would be deleted. Review the list and pass exactly: --delete ${want.join(',')}`);
  }
  return want;
}

export function renderCleanup({ plan, projectName, ref, checks }) {
  const lines = [];
  lines.push(`Cleanup check on ${projectName} (${ref}). Nothing is changed unless --delete is given.`, '');
  lines.push(`Deployed functions with no folder in supabase/functions (${plan.orphans.length}):`);
  if (!plan.orphans.length) lines.push('  none');
  for (const n of plan.codaOrphans) lines.push(`  ${n}  (Coda function, retired 2026-10-09)`);
  for (const n of plan.otherOrphans) lines.push(`  ${n}  (not a Coda name: read the list before deleting)`);
  lines.push('');
  if (plan.orphans.length) {
    lines.push('To delete exactly these, after reading the list above:');
    lines.push(`  node scripts/coda-cleanup.mjs --delete ${plan.orphans.join(',')} --confirm-production ${ref}`);
    lines.push('Each one is removed with the same call as:');
    for (const n of plan.orphans) lines.push(`  ${deleteCommand(n, ref)}`);
    lines.push('');
  }
  lines.push(`Secrets set on the project that no function code mentions (${plan.unread.length}):`);
  if (!plan.unread.length) lines.push('  none');
  for (const n of plan.unread) lines.push(`  ${n}`);
  if (plan.unread.length) {
    lines.push('', 'Printed, never run by this script. Run one only with Matthew\'s word, and check the name is not used outside Supabase first:');
    for (const n of plan.unread) lines.push(`  ${unsetCommand(n, ref)}`);
  }
  lines.push('');
  for (const c of checks || []) lines.push(`${c.label}: ${c.result}`);
  return lines.join('\n') + '\n';
}
