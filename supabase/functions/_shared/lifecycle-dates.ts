// F2 (Creative age / lifecycle dates) — pure helpers shared by the
// backfill-launch-dates edge function. Kept side-effect free so it is unit
// testable under `deno test` without network or DB.

/**
 * Normalize a Meta `created_time` value (ISO 8601, possibly with a +HHMM
 * offset like "2026-01-02T10:30:00+0000") to a UTC calendar date string
 * (YYYY-MM-DD). Returns null when the input is missing or unparseable.
 *
 * launch_date is a calendar date, so we anchor on the UTC day — matching the
 * `(created_time AT TIME ZONE 'UTC')::date` derivation in the SQL RPC
 * (derive_creative_lifecycle_dates) so the edge fn and DB never disagree.
 */
export function createdTimeToLaunchDate(createdTime: string | null | undefined): string | null {
  if (!createdTime) return null;
  const parsed = new Date(createdTime);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Build the Meta Graph batch-lookup URL for a set of ad ids, requesting only
 * `created_time`. Mirrors the `?ids=...&fields=...` field-expansion shape used
 * by backfill-post-urls.
 */
export function buildCreatedTimeUrl(
  apiVersion: string,
  adIds: string[],
  accessToken: string,
): string {
  return (
    `https://graph.facebook.com/${apiVersion}/` +
    `?ids=${adIds.join(",")}` +
    `&fields=created_time` +
    `&access_token=${encodeURIComponent(accessToken)}`
  );
}

/**
 * Given the Meta batch response (an object keyed by ad id) and the ad ids we
 * asked for, extract the { ad_id, launch_date } updates. Skips ads with an
 * error node or missing/unparseable created_time.
 */
export function extractLaunchDates(
  // deno-lint-ignore no-explicit-any
  batchResponse: Record<string, any>,
  adIds: string[],
): { ad_id: string; created_time: string; launch_date: string }[] {
  const out: { ad_id: string; created_time: string; launch_date: string }[] = [];
  for (const adId of adIds) {
    const node = batchResponse?.[adId];
    if (!node || node.error) continue;
    const createdTime: string | undefined = node.created_time;
    const launchDate = createdTimeToLaunchDate(createdTime);
    if (createdTime && launchDate) {
      out.push({ ad_id: adId, created_time: createdTime, launch_date: launchDate });
    }
  }
  return out;
}
