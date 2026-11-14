#!/usr/bin/env node
// Step 9 of the release: raise the Verdanote ad_name_counter to the old
// dashboard's latest value (greatest only, never lower) and check it.
//
//   hq secrets exec --company goodo-studios --only SUPABASE_ACCESS_TOKEN -- \
//     node scripts/ad-code-counter.mjs --confirm-source qlvdvpchriyrsjtewwxx
//     read only: prints both counters, what a run would do, and the checklist
//     for switching off the old Ad Name Generator and the Goodo OS ad naming
//     page at the same moment.
//
//   ... --confirm-source qlvdvpchriyrsjtewwxx --apply --confirm-production gwyxaqoaldnaavkjqquv
//     raises production (the old counter is read again right before the write).
//
//   ... --verify [--confirm-source qlvdvpchriyrsjtewwxx]
//     read only: counter at or above the old one, and peek_ad_code shows counter + 1.
//     Without --confirm-source the old dashboard is not read; only Verdanote is checked.
//
// Options:
//   --target <production|staging>   default production (staging: VERDANOTE_STAGING_SUPABASE_ACCESS_TOKEN)
//   --confirm-source <ref>          the old dashboard ref; needed to read it
//   --confirm-production <ref>      the exact production ref; needed with --apply on production
//   --apply                         raise the counter
//   --verify                        check only
//
// The old dashboard is read through the read-only endpoint (SUPABASE_ACCESS_TOKEN).
// The raise is `greatest(current, old)`, so running it twice or against a higher
// counter changes nothing.

import { parseFlags, makeManagementClient, projectTarget, DASHBOARD_REF } from './prod-cutover-lib.mjs';
import { readCounterSql, decideRaise, assertApplyAllowed, raiseSql, verifyCounter, peekAsBuilderSql, checklist } from './ad-code-counter-lib.mjs';

let flags;
let target;
try {
  flags = parseFlags(process.argv.slice(2), {
    valueFlags: ['target', 'confirm-source', 'confirm-production'],
    boolFlags: ['apply', 'verify'],
    refFlags: ['confirm-source', 'confirm-production'],
  });
  target = projectTarget(flags.target);
  assertApplyAllowed({ target: target.name, confirmProduction: flags['confirm-production'], confirmSource: flags['confirm-source'], applyFlag: flags.apply });
  if (!flags.apply && flags['confirm-production'] !== undefined) throw new Error('--confirm-production only goes with --apply');
  if (flags.apply && flags.verify) throw new Error('--apply and --verify are separate runs');
  if (flags['confirm-source'] !== undefined && flags['confirm-source'] !== DASHBOARD_REF) throw new Error(`--confirm-source must be ${DASHBOARD_REF}`);
  if (!flags.verify && flags['confirm-source'] === undefined) {
    process.stdout.write(`${checklist({ targetName: target.name })}\n\nNothing was read. Add --confirm-source ${DASHBOARD_REF} once Matthew has confirmed the read of the old dashboard database.\n`);
    process.exit(0);
  }
} catch (e) {
  console.error(String(e.message));
  process.exit(2);
}

let dst;
let src = null;
try {
  dst = makeManagementClient({ token: process.env[target.tokenEnv], ref: target.ref });
  if (flags['confirm-source']) src = makeManagementClient({ token: process.env.SUPABASE_ACCESS_TOKEN, ref: DASHBOARD_REF });
} catch (e) {
  console.error(`${e.message}. Expected ${target.tokenEnv}${src ? ' and SUPABASE_ACCESS_TOKEN' : ''} from hq secrets exec.`);
  process.exit(2);
}

const readValue = async (client) => (await client.readOnlyQuery(readCounterSql))[0]?.value ?? null;

let sourceValue = src ? await readValue(src) : null;
let targetValue = await readValue(dst);
console.log(`Old dashboard counter: ${src ? sourceValue : 'not read'}`);
console.log(`Verdanote ${target.name} counter: ${targetValue}`);

if (flags.apply) {
  const plan = decideRaise({ source: sourceValue, target: targetValue });
  console.log(`Plan: ${plan.action === 'raise' ? `raise ${plan.from} to ${plan.to}` : `no change (${plan.reason})`}`);
  // Read the old counter once more immediately before the write: it may have moved since the first read.
  sourceValue = await readValue(src);
  const last = decideRaise({ source: sourceValue, target: targetValue });
  if (last.action === 'raise') await dst.writeQuery(raiseSql(sourceValue));
  targetValue = await readValue(dst);
  console.log(`${last.action === 'raise' ? 'Raised' : 'Not changed'}. Verdanote ${target.name} counter is now ${targetValue} (old dashboard ${sourceValue}).`);
}

// Verification, after --apply and with --verify.
let peek;
try {
  const r = await dst.selectQuery(peekAsBuilderSql);
  peek = r.length ? r[0].next_code : null;
} catch (e) {
  peek = null;
  console.error(`peek_ad_code could not be called from here (${String(e.message).slice(0, 100)}). Check it by hand signed in as staff.`);
}
const v = verifyCounter({ source: sourceValue, target: targetValue, peek });
console.log(`Peek: ${v.peekState}`);
for (const p of v.problems) console.error(`PROBLEM: ${p}`);
if (!v.ok) process.exit(1);
if (!flags.apply && !flags.verify) {
  const plan = decideRaise({ source: sourceValue, target: targetValue });
  console.log(`\nA run with --apply would: ${plan.action === 'raise' ? `raise ${plan.from} to ${plan.to}` : `change nothing (${plan.reason})`}.\n`);
  console.log(checklist({ targetName: target.name }));
} else {
  console.log(flags.apply ? '\nNow switch the old generators off if that has not happened yet, then run --verify.' : '\nVerified.');
}
