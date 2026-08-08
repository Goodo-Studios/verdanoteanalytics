// Tests for the internal webhook HMAC signing helper.
//   deno test -A supabase/functions/_shared/webhook-signature.test.ts

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("VAULT_WEBHOOK_SECRET", "test-webhook-secret");
const { signWebhookItem, verifyWebhookItem } = await import("./webhook-signature.ts");

Deno.test("sign then verify round-trips for the same item id", async () => {
  const sig = await signWebhookItem("item-123");
  assert(await verifyWebhookItem("item-123", sig));
});

Deno.test("a signature for one item does not verify another item", async () => {
  const sig = await signWebhookItem("item-123");
  assertEquals(await verifyWebhookItem("item-999", sig), false);
});

Deno.test("a wrong/garbage signature fails", async () => {
  assertEquals(await verifyWebhookItem("item-123", "deadbeef"), false);
  assertEquals(await verifyWebhookItem("item-123", null), false);
});

Deno.test("verify fails closed when the secret is unset", async () => {
  const sig = await signWebhookItem("item-123");
  Deno.env.delete("VAULT_WEBHOOK_SECRET");
  try {
    assertEquals(await verifyWebhookItem("item-123", sig), false);
    // signing also fails loudly with no secret configured.
    await assertRejects(() => signWebhookItem("item-123"), Error);
  } finally {
    Deno.env.set("VAULT_WEBHOOK_SECRET", "test-webhook-secret");
  }
});
