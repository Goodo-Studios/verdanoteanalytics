// Audit 8.7: scrape-ad, vault-save, vault-frame-analyze and ai-chat call paid services for any
// signed-in user with no per-user limit. userRateLimitResponse asks check_user_rate_limit and
// answers 429 when the user is over the limit for that function.
//   deno test -A supabase/functions/_shared/user-rate-limit.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { USER_RATE_LIMITS, userRateLimitResponse } from "./user-rate-limit.ts";

function client(answer: { data: unknown; error: unknown }) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve(answer);
    },
  };
}

Deno.test("8.7: a user over the limit gets a 429 with Retry-After", async () => {
  const c = client({ data: false, error: null });
  const res = await userRateLimitResponse(c, "u1", "ai-chat");
  assertEquals(res?.status, 429);
  assertEquals(res?.headers.get("Retry-After"), String(USER_RATE_LIMITS["ai-chat"].windowSeconds));
});

Deno.test("8.7: a user under the limit is let through", async () => {
  const c = client({ data: true, error: null });
  assertEquals(await userRateLimitResponse(c, "u1", "scrape-ad"), null);
});

Deno.test("8.7: the check is per user and per function, with that function's limit", async () => {
  const c = client({ data: true, error: null });
  await userRateLimitResponse(c, "u7", "vault-frame-analyze");
  assertEquals(c.calls, [{
    name: "check_user_rate_limit",
    args: {
      p_user_id: "u7",
      p_bucket: "vault-frame-analyze",
      p_limit: USER_RATE_LIMITS["vault-frame-analyze"].limit,
      p_window_seconds: USER_RATE_LIMITS["vault-frame-analyze"].windowSeconds,
    },
  }]);
});

Deno.test("8.7: a counter failure lets the call through", async () => {
  const c = client({ data: null, error: { message: "boom" } });
  assertEquals(await userRateLimitResponse(c, "u1", "vault-save"), null);
});
