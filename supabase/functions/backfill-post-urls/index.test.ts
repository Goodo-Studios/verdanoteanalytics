// Audit 8.7: backfill-post-urls read only the META_ACCESS_TOKEN environment variable,
// which is not set in production (the token lives in settings.meta_access_token), so
// every Meta call went out with access_token=undefined and failed.
//   deno test -A supabase/functions/backfill-post-urls/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BACKFILL_POST_URLS_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const { handler } = await import("./index.ts");

// deno-lint-ignore no-explicit-any
function makeDb(settingsToken: string | null): any {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const b: any = {};
      let updatePayload: Record<string, unknown> | null = null;
      b.select = () => b;
      b.eq = () => b;
      b.is = () => b;
      b.gt = () => b;
      b.limit = () => Promise.resolve({ data: [{ ad_id: "ad_1" }], error: null });
      b.single = () =>
        Promise.resolve(
          table === "settings" && settingsToken
            ? { data: { value: settingsToken }, error: null }
            : { data: null, error: { message: "no rows" } },
        );
      b.maybeSingle = b.single;
      b.update = (p: Record<string, unknown>) => {
        updatePayload = p;
        return b;
      };
      // deno-lint-ignore no-explicit-any
      b.then = (resolve: (v: any) => void) => {
        if (updatePayload) updates.push(updatePayload);
        resolve({ data: null, error: null });
      };
      return b;
    },
  };
}

async function run(db: unknown) {
  const metaUrls: string[] = [];
  const realFetch = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    metaUrls.push(url);
    return Promise.resolve(new Response(JSON.stringify({
      ad_1: { creative: { effective_object_story_id: "111_222" } },
    })));
  };
  try {
    const res = await handler(
      new Request("http://test.local/backfill-post-urls", {
        method: "POST",
        body: JSON.stringify({ account_id: "act_1" }),
      }),
      db,
    );
    return { status: res.status, body: await res.json(), metaUrls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

Deno.test("8.7: backfill-post-urls uses the token saved in settings when the env var is unset", async () => {
  Deno.env.delete("META_ACCESS_TOKEN");
  const db = makeDb("db-token");
  const { status, metaUrls } = await run(db);
  assertEquals(status, 200);
  assertEquals(metaUrls.length, 1);
  assert(metaUrls[0].includes("access_token=db-token"), `uses the settings token: ${metaUrls[0]}`);
  assertEquals(db.updates[0], { ad_post_url: "https://www.facebook.com/111/posts/222/" });
});

Deno.test("8.7: backfill-post-urls stops before calling Meta when no token is configured", async () => {
  Deno.env.delete("META_ACCESS_TOKEN");
  const { status, metaUrls } = await run(makeDb(null));
  assertEquals(status, 400);
  assertEquals(metaUrls.length, 0, "no Meta call with access_token=undefined");
});

Deno.test("8.7: the env token still wins when it is set", async () => {
  Deno.env.set("META_ACCESS_TOKEN", "env-token");
  try {
    const { metaUrls } = await run(makeDb("db-token"));
    assert(metaUrls[0].includes("access_token=env-token"));
  } finally {
    Deno.env.delete("META_ACCESS_TOKEN");
  }
});
