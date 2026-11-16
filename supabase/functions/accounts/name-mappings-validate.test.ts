// Name mapping uploads (audit plan item 5.9, part 2: the server).
//
// The upload upserted in chunks of 500 and stopped on the first error, so a large file
// could be half-written. A row with no code was skipped without a word, and a blank cell
// overwrote the stored value with null. Now every row is checked before anything is
// written, the whole file is written in one call, and blank cells keep what is stored.
//
//   deno test -A supabase/functions/accounts/name-mappings-validate.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeSupabase, type FakeConfig } from "../_shared/fake-supabase.ts";
import { handler } from "./index.ts";

async function upload(mappings: unknown[], cfg: FakeConfig = {}) {
  const db = fakeSupabase({
    user: { id: "u1" },
    ...cfg,
    tables: { user_roles: [{ role: "builder" }], ...cfg.tables },
  });
  const res = await handler(
    new Request("http://x/accounts/act_a/name-mappings", {
      method: "POST",
      headers: { authorization: "Bearer test" },
      body: JSON.stringify({ mappings }),
    }),
    { client: db.client },
  );
  return { db, res, json: await res.json() };
}

const row = (code: string, extra: Record<string, string> = {}) => ({
  UniqueCode: code, Type: "Video", Person: "P", Style: "S", Product: "Pr", Hook: "H", Theme: "T", ...extra,
});

Deno.test("a row with no code rejects the whole upload with its line, and nothing is written", async () => {
  const { db, res, json } = await upload([row("A1"), row("")]);
  assertEquals(res.status, 400);
  assertEquals(json.row_errors, [{ line: 3, message: "UniqueCode is empty" }]);
  assertEquals(db.writes(), []);
});

Deno.test("a repeated code rejects the whole upload, and nothing is written", async () => {
  const { db, res, json } = await upload([row("A1"), row("A2"), row("A1")]);
  assertEquals(res.status, 400);
  assertEquals(json.row_errors, [{ line: 4, message: "UniqueCode A1 appears more than once (first on line 2)" }]);
  assertEquals(db.writes(), []);
});

Deno.test("a large upload is written in one call, not chunks", async () => {
  const rows = Array.from({ length: 1200 }, (_, i) => row(`C${i}`));
  const { db, res, json } = await upload(rows);
  assertEquals(res.status, 200);
  const upserts = db.writes().filter((o) => o.verb === "upsert" && o.table === "name_mappings");
  assertEquals(upserts.length, 1);
  assertEquals((upserts[0].payload as unknown[]).length, 1200);
  assertEquals(json.upserted, 1200);
});

Deno.test("blank cells keep the stored value; new codes get null for blanks", async () => {
  const { db, res } = await upload(
    [row("OLD", { Person: "", Style: "Lo-fi", Hook: "  " }), row("NEW", { Theme: "" })],
    {
      tables: {
        name_mappings: [{
          unique_code: "OLD", ad_type: "Video", person: "Ana", style: "UGC", product: "Pr", hook: "Stored hook", theme: "T",
        }],
      },
    },
  );
  assertEquals(res.status, 200);
  const upsert = db.writes().find((o) => o.verb === "upsert" && o.table === "name_mappings")!;
  const byCode = new Map((upsert.payload as Array<Record<string, unknown>>).map((r) => [r.unique_code, r]));
  assertEquals(byCode.get("OLD")!.person, "Ana");
  assertEquals(byCode.get("OLD")!.style, "Lo-fi");
  assertEquals(byCode.get("OLD")!.hook, "Stored hook");
  assertEquals(byCode.get("NEW")!.theme, null);
  assertEquals(byCode.get("NEW")!.person, "P");
});
