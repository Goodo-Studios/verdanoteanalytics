import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { matchWebhooks } from "./webhook-match.ts";

const hooks = [
  { id: "global", account_ids: [] as string[] },
  { id: "global-null", account_ids: null },
  { id: "a-only", account_ids: ["act_a"] },
  { id: "b-only", account_ids: ["act_b"] },
  { id: "a-and-b", account_ids: ["act_a", "act_b"] },
];

Deno.test("a non-staff caller reaches only webhooks that list their account", () => {
  const ids = matchWebhooks(hooks, { accountId: "act_a", isStaff: false }).map((w) => w.id);
  assertEquals(ids, ["a-only", "a-and-b"]);
});

Deno.test("staff also reach global webhooks", () => {
  const ids = matchWebhooks(hooks, { accountId: "act_a", isStaff: true }).map((w) => w.id);
  assertEquals(ids, ["global", "global-null", "a-only", "a-and-b"]);
});

Deno.test("no account id: only staff reach global webhooks, nobody reaches scoped ones", () => {
  assertEquals(matchWebhooks(hooks, { accountId: null, isStaff: true }).map((w) => w.id), ["global", "global-null"]);
  assertEquals(matchWebhooks(hooks, { accountId: null, isStaff: false }), []);
});

Deno.test("a test dispatch targets the one webhook it was given", () => {
  assertEquals(matchWebhooks([hooks[2]], { testWebhookId: "a-only", isStaff: false }).length, 1);
});
