// HMAC-SHA256 signing for internal webhook callback URLs.
//
// Third-party async jobs (e.g. Apify actor runs) call back into our edge
// functions with an item_id in the URL. Those endpoints run with the service
// role and mutate rows keyed by that item_id, so an unsigned callback lets any
// caller forge a result for an arbitrary item. To prevent that, the function
// that REGISTERS the callback signs the item_id (signWebhookItem) and the
// receiving webhook verifies the signature (verifyWebhookItem) before doing any
// work. Secret: VAULT_WEBHOOK_SECRET (must be set in every deployed env).

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time string comparison — avoids leaking match length via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Sign an item id for embedding in a callback URL. Throws if the secret is not
// configured, so a misconfigured environment fails loudly at registration time
// rather than silently minting unverifiable callbacks.
export async function signWebhookItem(itemId: string): Promise<string> {
  const secret = Deno.env.get("VAULT_WEBHOOK_SECRET");
  if (!secret) {
    throw new Error("VAULT_WEBHOOK_SECRET is not set — cannot sign webhook callback URL");
  }
  return hmacHex(secret, itemId);
}

// Verify a callback signature. Fails CLOSED: if the secret is unset or the
// signature is missing/wrong, returns false.
export async function verifyWebhookItem(itemId: string, signature: string | null): Promise<boolean> {
  const secret = Deno.env.get("VAULT_WEBHOOK_SECRET");
  if (!secret || !signature) return false;
  const expected = await hmacHex(secret, itemId);
  return timingSafeEqual(expected, signature);
}
