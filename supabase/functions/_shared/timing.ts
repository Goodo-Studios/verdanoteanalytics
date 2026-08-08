// Constant-time string comparison. Returns as soon as lengths differ (leaking
// only length, which is standard/acceptable), otherwise compares every char so
// the time taken does not depend on where the first mismatch is — closing the
// timing side channel when comparing secrets / HMAC signatures with ===.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
