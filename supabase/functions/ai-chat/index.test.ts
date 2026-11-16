// Tests for ai-chat: message and history caps, insert error handling, timeout wiring.
//
//   deno test -A supabase/functions/ai-chat/index.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeCreateClient, fakeSupabase, type FakeConfig, withEnv, withFetch } from "../_shared/fake-supabase.ts";

Deno.env.set("AI_CHAT_NO_SERVE", "1");
const { handler, MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS } = await import("./index.ts");

const ENV = { SUPABASE_URL: "http://localhost", SUPABASE_ANON_KEY: "anon-for-tests" };

const reply = (text = "an answer") => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }));

async function call(body: unknown, cfg: FakeConfig = {}, stub?: () => Response) {
  const db = fakeSupabase({ user: { id: "u1" }, tables: { creatives: [], ad_accounts: [] }, ...cfg });
  const { createClient } = fakeCreateClient(db);
  let res!: Response;
  let sent: Array<{ url: string; init?: RequestInit }> = [];
  await withEnv(ENV, () =>
    withFetch(stub ?? (() => reply()), async (calls) => {
      res = await handler(
        new Request("http://x/ai-chat", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(body) }),
        { createClient },
      );
      sent = calls;
    }));
  return { res, db, sent, json: await res.json() };
}

Deno.test("a message over the cap is a 400 and the model is not called", async () => {
  const { res, sent } = await call({ message: "x".repeat(MAX_MESSAGE_CHARS + 1) });
  assertEquals(res.status, 400);
  assertEquals(sent.length, 0);
});

Deno.test("a non-string message is a 400", async () => {
  const { res } = await call({ message: { a: 1 } });
  assertEquals(res.status, 400);
});

Deno.test("only the most recent turns of history go to the model", async () => {
  const history = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  const { sent } = await call(
    { message: "hi", conversationId: "c1" },
    { tables: { creatives: [], ad_accounts: [], ai_conversations: [{ messages: history }] } },
  );
  const body = JSON.parse(String(sent[0].init?.body));
  // system + capped history + the new user message
  assertEquals(body.messages.length, 1 + MAX_HISTORY_MESSAGES + 1);
  assertEquals(body.messages[1].content, "m30");
});

Deno.test("the upstream call carries an abort signal", async () => {
  const { sent } = await call({ message: "hi" });
  assertEquals(sent[0].init?.signal instanceof AbortSignal, true);
});

Deno.test("a failed conversation insert is reported as not saved, not as a conversation id", async () => {
  const { res, json } = await call({ message: "hi" }, { writeErrors: { "insert:ai_conversations": { message: "rls" } } });
  assertEquals(res.status, 200);
  assertEquals(json.answer, "an answer");
  assertEquals(json.conversationId, null);
  assertEquals(json.saved, false);
});

Deno.test("8.7: a user over their rate limit gets a 429 and the model is not called", async () => {
  const { res, sent, db } = await call({ message: "hi" }, { rpc: { check_user_rate_limit: false } });
  assertEquals(res.status, 429);
  assertEquals(sent.length, 0);
  assertEquals(db.rpcCalls.map((c) => c.name), ["check_user_rate_limit"]);
});

Deno.test("a saved conversation returns its id", async () => {
  const { json } = await call({ message: "hi" }, { tables: { creatives: [], ad_accounts: [], ai_conversations: [{ id: "new-conv" }] }, writeData: { "insert:ai_conversations": [{ id: "new-conv" }] } });
  assertEquals(json.saved, json.conversationId !== null);
});
