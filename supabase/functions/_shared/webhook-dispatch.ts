// Webhook dispatch helpers (audit plan item 2.1).
//
// - A key may dispatch only if it carries the "write" scope. Dispatch sends data to outside
//   systems, so a read-only or empty key is refused before any work.
// - Every send checks that the destination resolves only to public addresses and does not
//   follow redirects (a redirect could point at an internal address after the check).
import { assertPublicNetworkTarget } from "./public-url.ts";

export const DISPATCH_SCOPE = "write";

export function dispatchScopeError(permissions: unknown): string | null {
  const scopes = Array.isArray(permissions) ? permissions : [];
  return scopes.includes(DISPATCH_SCOPE)
    ? null
    : `Forbidden: this API key needs the '${DISPATCH_SCOPE}' scope to dispatch webhooks`;
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface DispatchDeps {
  fetchImpl?: typeof fetch;
  assertTarget?: (url: string) => Promise<URL>;
}

/**
 * POST the payload to one webhook and return the HTTP status (0 for a refused destination or a
 * network error). Redirects are not followed; a 3xx status is recorded as is.
 */
export async function postWebhook(
  webhook: { id: string; url: string; secret: string | null },
  body: string,
  deps: DispatchDeps = {},
): Promise<number> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const assertTarget = deps.assertTarget ?? ((u: string) => assertPublicNetworkTarget(u));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Verdanote-Webhooks/1.0",
  };
  if (webhook.secret) headers["X-Verdanote-Signature"] = await hmacSign(webhook.secret, body);

  try {
    const target = await assertTarget(webhook.url);
    const res = await fetchImpl(target.toString(), {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    await res.body?.cancel();
    return res.status;
  } catch (e) {
    console.error(`Webhook ${webhook.id} failed:`, e instanceof Error ? e.message : "error");
    return 0;
  }
}
