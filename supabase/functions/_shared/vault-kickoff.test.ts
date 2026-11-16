// Audit plan item 4.4: a Vault hand-off (webhook -> vault-transcribe, vault-transcribe ->
// vault-analyze) must not be fire-and-forget. kickOffVaultStep waits a short time for the call to
// be accepted and marks the item as an error when it is refused or fails, so the item never sits
// in a processing state with nothing running.
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { kickOffVaultStep } from "./vault-kickoff.ts";

function fakeDb() {
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    from: (_table: string) => ({
      update: (row: Record<string, unknown>) => ({
        eq: (_col: string, _val: string) => {
          updates.push(row);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
}

const base = { supabaseUrl: "https://x.test", serviceRoleKey: "k", itemId: "item-1", ackTimeoutMs: 50 };

Deno.test("a refused hand-off marks the item as an error", async () => {
  const db = fakeDb();
  await kickOffVaultStep(db, { ...base, step: "vault-transcribe", fetchImpl: () => Promise.resolve(new Response("nope", { status: 500 })) });
  assertEquals(db.updates.length, 1);
  assertEquals(db.updates[0].status, "error");
  assertMatch(String(db.updates[0].error_message), /vault-transcribe/);
});

Deno.test("a network failure marks the item as an error", async () => {
  const db = fakeDb();
  await kickOffVaultStep(db, { ...base, step: "vault-analyze", fetchImpl: () => Promise.reject(new Error("connection reset")) });
  assertEquals(db.updates[0]?.status, "error");
  assertMatch(String(db.updates[0].error_message), /connection reset/);
});

Deno.test("an accepted hand-off leaves the item alone", async () => {
  const db = fakeDb();
  await kickOffVaultStep(db, { ...base, step: "vault-analyze", fetchImpl: () => Promise.resolve(new Response("{}", { status: 200 })) });
  assertEquals(db.updates.length, 0);
});

Deno.test("a slow hand-off returns after the ack window and keeps running in the background", async () => {
  const db = fakeDb();
  const kept: Promise<unknown>[] = [];
  const started = Date.now();
  await kickOffVaultStep(db, {
    ...base,
    step: "vault-analyze",
    fetchImpl: () => new Promise((r) => setTimeout(() => r(new Response("{}", { status: 200 })), 200)),
    keepAlive: (p) => kept.push(p),
  });
  assertEquals(Date.now() - started < 190, true, "returned before the call finished");
  assertEquals(kept.length, 1, "the in-flight call is handed to waitUntil");
  await kept[0];
  assertEquals(db.updates.length, 0);
});

for (const file of ["../vault-extract-webhook/index.ts", "../vault-transcribe/index.ts"]) {
  Deno.test(`${file} hands off through kickOffVaultStep, never fire-and-forget`, async () => {
    const src = await Deno.readTextFile(new URL(file, import.meta.url));
    assertEquals(src.includes("kickOffVaultStep("), true);
    assertEquals(/EdgeRuntime\.waitUntil\(\s*fetch\(/.test(src), false, "no fire-and-forget fetch");
  });
}
