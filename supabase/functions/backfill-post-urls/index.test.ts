// Audit 8.7 tests for backfill-post-urls.
//   deno test -A supabase/functions/backfill-post-urls/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { makeBackfillTestDb, withMetaFetch } from "../_shared/backfill-test-db.ts";

Deno.env.set("BACKFILL_POST_URLS_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const { handler } = await import("./index.ts");

const RESOLVABLE = { ad_1: { creative: { effective_object_story_id: "111_222" } } };

async function run(db: unknown) {
  const res = await handler(
    new Request("http://test.local/backfill-post-urls", {
      method: "POST",
      body: JSON.stringify({ account_id: "act_1" }),
    }),
    db,
  );
  return { status: res.status, body: await res.json() };
}

// ── The saved Meta token is used (backfill-post-urls read only an unset env var) ──

Deno.test("8.7: backfill-post-urls uses the token saved in settings when the env var is unset", async () => {
  Deno.env.delete("META_ACCESS_TOKEN");
  const db = makeBackfillTestDb({ candidates: ["ad_1"], settingsToken: "db-token" });
  await withMetaFetch(RESOLVABLE, async (urls) => {
    const { status } = await run(db);
    assertEquals(status, 200);
    assertEquals(urls.length, 1);
    assert(urls[0].includes("access_token=db-token"), `uses the settings token: ${urls[0]}`);
  });
  const written = db.updates.find((u) => u.ad_id === "ad_1");
  assertEquals(written?.payload.ad_post_url, "https://www.facebook.com/111/posts/222/");
});

Deno.test("8.7: backfill-post-urls stops before calling Meta when no token is configured", async () => {
  Deno.env.delete("META_ACCESS_TOKEN");
  await withMetaFetch(RESOLVABLE, async (urls) => {
    const { status } = await run(makeBackfillTestDb({ candidates: ["ad_1"], settingsToken: null }));
    assertEquals(status, 400);
    assertEquals(urls.length, 0, "no Meta call with access_token=undefined");
  });
});

Deno.test("8.7: the env token still wins when it is set", async () => {
  Deno.env.set("META_ACCESS_TOKEN", "env-token");
  try {
    await withMetaFetch(RESOLVABLE, async (urls) => {
      await run(makeBackfillTestDb({ candidates: ["ad_1"], settingsToken: "db-token" }));
      assert(urls[0].includes("access_token=env-token"));
    });
  } finally {
    Deno.env.delete("META_ACCESS_TOKEN");
  }
});

// ── Unresolvable rows are not re-picked every run ─────────────────────────────

Deno.test("8.7: an ad Meta cannot resolve is marked checked", async () => {
  Deno.env.delete("META_ACCESS_TOKEN");
  const db = makeBackfillTestDb({ candidates: ["ad_1", "ad_2"], settingsToken: "db-token" });
  // ad_2 comes back with no story id, so no post URL can be built.
  await withMetaFetch({ ...RESOLVABLE, ad_2: { creative: {} } }, () => run(db));
  const stamp = db.updates.find((u) => u.ad_id === "ad_2");
  assert(stamp, "the unresolvable ad is written");
  assert(typeof stamp.payload.post_url_checked_at === "string", "and marked with post_url_checked_at");
  assertEquals(db.updates.find((u) => u.ad_id === "ad_1")?.payload.post_url_checked_at, undefined);
});

Deno.test("8.7: a recently checked ad is not picked again", async () => {
  Deno.env.delete("META_ACCESS_TOKEN");
  const db = makeBackfillTestDb({ candidates: ["ad_1"], settingsToken: "db-token" });
  await withMetaFetch(RESOLVABLE, () => run(db));
  assert(
    db.selectOrs.some((e) => e.startsWith("post_url_checked_at.is.null,post_url_checked_at.lt.")),
    `candidate select skips recently checked rows: ${JSON.stringify(db.selectOrs)}`,
  );
});

Deno.test("8.7: a failed Meta batch marks nothing", async () => {
  Deno.env.delete("META_ACCESS_TOKEN");
  const db = makeBackfillTestDb({ candidates: ["ad_2"], settingsToken: "db-token" });
  await withMetaFetch({ error: { code: 4, message: "(#4) Application request limit reached" } }, () => run(db));
  assertEquals(db.updates.length, 0, "a throttled batch is retried next run, not marked");
});
