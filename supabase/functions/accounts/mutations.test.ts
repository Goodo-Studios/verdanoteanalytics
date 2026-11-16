// Tests for the accounts function writes: delete (builder only, stops on error) and the
// name-mappings upload (bulk upsert, per-code update, correct unmatchedCodes).
//
//   deno test -A supabase/functions/accounts/mutations.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeSupabase, type FakeConfig } from "../_shared/fake-supabase.ts";
import { handler } from "./index.ts";

async function call(method: string, path: string, roles: string[], cfg: FakeConfig = {}, body?: unknown) {
  const db = fakeSupabase({
    user: { id: "u1" },
    ...cfg,
    tables: { user_roles: roles.map((role) => ({ role })), ...cfg.tables },
  });
  const res = await handler(
    new Request(`http://x/accounts${path}`, {
      method,
      headers: { authorization: "Bearer t" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { client: db.client },
  );
  return { db, res, json: await res.json() };
}

Deno.test("an employee cannot delete an account and nothing is deleted", async () => {
  const { db, res } = await call("DELETE", "/act_a", ["employee"]);
  assertEquals(res.status, 403);
  assertEquals(db.writes(), []);
});

Deno.test("a builder delete runs every step in order and ends with the account", async () => {
  const { db, res } = await call("DELETE", "/act_a", ["builder"]);
  assertEquals(res.status, 200);
  const tables = db.writes().map((o) => o.table);
  assertEquals(tables.length, 8);
  assertEquals(tables[0], "creative_daily_metrics");
  assertEquals(tables[7], "ad_accounts");
});

Deno.test("a failed delete step stops the sequence and reports where", async () => {
  const { db, res, json } = await call("DELETE", "/act_a", ["builder"], {
    writeErrors: { "delete:name_mappings": { message: "fk" } },
  });
  assertEquals(res.status, 500);
  assertEquals(json.failed_at, "name_mappings");
  const tables = db.writes().map((o) => o.table);
  assertEquals(tables, ["creative_daily_metrics", "creatives", "name_mappings"]);
});

Deno.test("name-mappings: one bulk upsert, one update per code, unmatchedCodes counts codes with no mapping", async () => {
  const { db, res, json } = await call(
    "POST",
    "/act_a/name-mappings",
    ["builder"],
    {
      tables: {
        creatives: (op) =>
          op.payload === "ad_id, unique_code"
            ? [
              { ad_id: "1", unique_code: "AAA" },
              { ad_id: "2", unique_code: "AAA" },
              { ad_id: "3", unique_code: "ZZZ" },
              { ad_id: "4", unique_code: "ZZZ" },
              { ad_id: "5", unique_code: null },
            ]
            : [],
        name_mappings: [{ unique_code: "AAA", ad_type: "UGC" }],
      },
    },
    // A row with no code now rejects the upload (audit 5.9); see name-mappings-validate.test.ts.
    { mappings: [{ unique_code: "AAA", ad_type: "UGC" }, { UniqueCode: "BBB", Type: "Static" }] },
  );
  assertEquals(res.status, 200);
  const upserts = db.writes().filter((o) => o.verb === "upsert");
  assertEquals(upserts.length, 1);
  assertEquals((upserts[0].payload as unknown[]).length, 2);
  const creativeUpdates = db.writes().filter((o) => o.table === "creatives" && o.verb === "update");
  assertEquals(creativeUpdates.length, 1);
  assertEquals(json.upserted, 2);
  assertEquals(json.matched, 2);
  assertEquals(json.unmatchedCodes, 1);
});

Deno.test("name-mappings: an upsert error is a 500, not a silent partial", async () => {
  const { res } = await call(
    "POST",
    "/act_a/name-mappings",
    ["builder"],
    { writeErrors: { "upsert:name_mappings": { message: "bad" } } },
    { mappings: [{ unique_code: "AAA" }] },
  );
  assertEquals(res.status, 500);
});
