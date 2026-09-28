// Classifies Meta Graph API errors that no retry can fix, and identifies which
// ad accounts are real Meta ad accounts. Deno-free so vitest can import it.
//
// Background (2026-09-28): a bulk "sync all" included the synthetic demo account
// act_demo_glowdrip. Meta answered every call with code 100 / subcode 33
// ("object does not exist"). The Phase 1 campaign-list fetch treated that as
// transient and re-invoked itself about once a second for 10+ hours (26k+ Meta
// calls), holding the single-runner sync lock so every real account behind it
// stayed queued.

export interface MetaGraphError {
  code?: number;
  error_subcode?: number;
}

/** Real Meta ad account ids are `act_` followed by digits. Demo/seed rows are not. */
export function isMetaAdAccountId(accountId: string | null | undefined): boolean {
  return typeof accountId === "string" && /^act_\d+$/.test(accountId);
}

/** True when a Meta error cannot succeed on retry for the object in the URL:
 *  - 100 / subcode 33: object does not exist or the token cannot see it
 *  - 190: access token invalid or expired
 *  - 10, 200-299: permission not granted */
export function isTerminalMetaError(err: MetaGraphError | null | undefined): boolean {
  if (!err) return false;
  const code = err.code;
  if (code === 100 && err.error_subcode === 33) return true;
  if (code === 190) return true;
  if (code === 10) return true;
  if (typeof code === "number" && code >= 200 && code <= 299) return true;
  return false;
}

/** True when the Graph URL's first path object is the ad account itself
 *  (e.g. /v21.0/act_123/campaigns), so a terminal error means the whole
 *  account is unreachable, not just one ad or video. */
export function urlTargetsAccount(url: string, accountId: string): boolean {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    // segments[0] is the API version (v21.0); segments[1] is the object id.
    return segments[1] === accountId;
  } catch {
    return false;
  }
}

/** Retry budget for the Phase 1 campaign-list fetch after non-terminal errors. */
export const MAX_CAMPAIGN_LIST_ERROR_RETRIES = 5;

/** True while the campaign-list fetch should pause and retry on the next
 *  /continue; false once the budget is spent and the sync must fail. */
export function shouldRetryCampaignList(priorRetries: number, cap = MAX_CAMPAIGN_LIST_ERROR_RETRIES): boolean {
  return priorRetries + 1 <= cap;
}
