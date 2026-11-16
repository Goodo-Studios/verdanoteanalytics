// Per-user rate limits for paid browser-called functions (audit 8.7).
//
// scrape-ad, vault-save, vault-frame-analyze and ai-chat call paid services for any signed-in
// user. check_api_rate_limit is keyed to API keys, so these use check_user_rate_limit, a fixed
// window per user and per function. Call this with a service-role client after the user is
// known; service-role callers (cron, other functions) are not counted.

import { corsHeaders } from "./cors.ts";

export type RateLimitBucket = "ai-chat" | "scrape-ad" | "vault-save" | "vault-frame-analyze";

/** Calls allowed per user in each window. */
export const USER_RATE_LIMITS: Record<RateLimitBucket, { limit: number; windowSeconds: number }> = {
  "ai-chat": { limit: 120, windowSeconds: 3600 },
  "scrape-ad": { limit: 60, windowSeconds: 3600 },
  "vault-save": { limit: 300, windowSeconds: 3600 },
  "vault-frame-analyze": { limit: 120, windowSeconds: 3600 },
};

interface RpcClient {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * A 429 response when the user is over the limit for this function, or null to go on.
 * A counter failure lets the call through, so a counter outage cannot take the feature down.
 */
export async function userRateLimitResponse(
  client: RpcClient,
  userId: string,
  bucket: RateLimitBucket,
): Promise<Response | null> {
  const { limit, windowSeconds } = USER_RATE_LIMITS[bucket];
  const { data, error } = await client.rpc("check_user_rate_limit", {
    p_user_id: userId,
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.warn(`[user-rate-limit] ${bucket}: counter check failed, letting the call through`);
    return null;
  }
  if (data !== false) return null;
  return new Response(
    JSON.stringify({ error: "Too many requests. Please wait a bit and try again." }),
    {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(windowSeconds) },
    },
  );
}
