// Pure pieces of scripts/ad-code-counter.mjs (step 9 of the release): raise the
// Verdanote ad code counter to the old dashboard's value, never lower it, and
// check it afterwards. No network here.

import { DASHBOARD_REF, PRODUCTION_REF } from './prod-cutover-lib.mjs';
import { counterSql } from './dashboard-copy-lib.mjs';

export const readCounterSql = 'select value from public.ad_name_counter where id = 1';

// peek_ad_code() refuses anyone who is not staff, inside its body, and the
// management API runs as a database owner with no login. So the check borrows
// the first builder's id for this one statement only (set_config is local to the
// statement). Nothing is written: peek_ad_code is read only.
export const peekAsBuilderSql = `with b as (
  select u.id::text as uid from auth.users u where public.has_role(u.id, 'builder'::public.app_role) order by u.created_at limit 1
), c as materialized (
  select set_config('request.jwt.claim.sub', b.uid, true) as s,
         set_config('request.jwt.claims', json_build_object('sub', b.uid, 'role', 'authenticated')::text, true) as t
  from b
)
select public.peek_ad_code() as next_code from c`;

const asNumber = (v) => (v === null || v === undefined ? null : Number(v));

// What a run would do. The target is only ever raised.
export function decideRaise({ source, target }) {
  const s = asNumber(source);
  const t = asNumber(target);
  if (!Number.isFinite(s)) throw new Error('the old dashboard counter could not be read');
  if (!Number.isFinite(t)) throw new Error('the Verdanote counter row (ad_name_counter id 1) could not be read');
  if (t >= s) return { action: 'none', from: t, to: t, reason: t === s ? 'already equal' : 'Verdanote is already ahead; the counter is never lowered' };
  return { action: 'raise', from: t, to: s, reason: `raise by ${s - t}` };
}

export function assertApplyAllowed({ target, confirmProduction, confirmSource, applyFlag }) {
  if (!applyFlag) return;
  if (confirmSource !== DASHBOARD_REF) throw new Error(`--apply needs --confirm-source ${DASHBOARD_REF}`);
  if (target === 'production' && confirmProduction !== PRODUCTION_REF) {
    throw new Error(`refusing to change Verdanote production without --confirm-production ${PRODUCTION_REF}`);
  }
  if (target !== 'production' && confirmProduction !== undefined) throw new Error('--confirm-production only goes with --target production');
}

export const raiseSql = (value) => counterSql(value);

// After the raise: the counter must be at least the old value, and peek must show the next number.
export function verifyCounter({ source, target, peek }) {
  const s = asNumber(source);
  const t = asNumber(target);
  const problems = [];
  if (Number.isFinite(s) && t < s) problems.push(`Verdanote counter ${t} is below the old dashboard counter ${s}: codes could be issued twice`);
  let peekState = 'not checked';
  if (peek === undefined) peekState = 'not checked';
  else if (peek === null) peekState = 'no builder login to borrow, check peek_ad_code by hand signed in as staff';
  else if (Number(peek) === t + 1) peekState = `peek_ad_code shows ${Number(peek)} (counter ${t} + 1)`;
  else problems.push(`peek_ad_code shows ${peek} but the counter is ${t}, so it should show ${t + 1}`);
  return { ok: problems.length === 0, problems, peekState };
}

export function checklist({ targetName }) {
  const where = targetName === 'production' ? 'Verdanote production' : `Verdanote ${targetName}`;
  return [
    'Switch-over checklist. Do these in one sitting, in this order; nobody generates ad names while it runs.',
    '',
    '1. Tell the team in advance that ad naming is paused for a few minutes. Codes issued on the old side after step 4 would be issued twice.',
    '2. Switch off the old Ad Name Generator (goodo-ad-name-generator): take the deployment offline or point its domain at a "moved to Verdanote" page. Confirm its page no longer loads.',
    '3. Switch off the ad naming page in the Goodo OS site (Railway): remove the page or redirect it to the Verdanote Ad Name Generator (/ad-name-generator). Confirm it no longer issues a code.',
    `4. Run this script with --apply to raise ${where} to the old counter. The old counter is read again immediately before the write, so a code issued in the last minutes is included.`,
    '5. Run it again with --verify. It must show the Verdanote counter at or above the old one, and peek_ad_code showing the counter plus one.',
    '6. Sign in to Verdanote as staff, open /ad-name-generator, copy one name, and check its code is one higher than the old dashboard\'s last code.',
    '7. Only then tell the team ad naming is back, and use only /ad-name-generator from now on.',
    '',
    'If the old generator keeps issuing codes after step 4, run --verify again: it reports when the old counter has moved above Verdanote\'s. Raise again and switch the old generator off for good.',
    'Rollback: switch the old generator back on only after setting its counter above Verdanote\'s current value; never let two generators issue codes at once.',
  ].join('\n');
}
