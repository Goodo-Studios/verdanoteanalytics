// Tests for clear-media-cache: needs confirm, stops on errors, clears the asset rows.
//
//   deno test -A supabase/functions/clear-media-cache/index.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeCreateClient, fakeSupabase, type FakeConfig, withEnv } from "../_shared/fake-supabase.ts";

Deno.env.set("CLEAR_MEDIA_CACHE_NO_SERVE", "1");
const { handler } = await import("./index.ts");

const ENV = { SUPABASE_URL: "http://localhost", SUPABASE_SERVICE_ROLE_KEY: "service-key-for-tests" };

/** Answers `rows` once for a table, then nothing, like a table that was drained by the writes. */
function drainOnce(rows: unknown[]) {
  let served = false;
  return () => {
    if (served) return [];
    served = true;
    return rows;
  };
}

function storageFake(rootPages: Array<Array<{ id?: string; name: string }>>, removed: string[]) {
  let page = 0;
  return {
    from: (_bucket: string) => ({
      list: (path: string) => {
        if (path === "") {
          const data = rootPages[page] ?? [];
          page++;
          return Promise.resolve({ data, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
      remove: (paths: string[]) => {
        removed.push(...paths);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
}

async function call(body: unknown, cfg: FakeConfig, storage?: unknown) {
  const db = fakeSupabase({ user: { id: "caller" }, ...cfg });
  const { createClient } = fakeCreateClient(db);
  // deno-lint-ignore no-explicit-any
  const client: any = { ...db.client, storage: storage ?? storageFake([[]], []) };
  let res!: Response;
  await withEnv(ENV, async () => {
    res = await handler(
      new Request("http://x/clear-media-cache", {
        method: "POST",
        headers: { authorization: "Bearer t" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      // deno-lint-ignore no-explicit-any
      { createClient: ((..._a: unknown[]) => { createClient(); return client; }) as any },
    );
  });
  return { db, res, json: await res.json() };
}

const builder = { user_roles: [{ role: "builder" }] };

Deno.test("refuses without the confirm flag and writes nothing", async () => {
  const { db, res } = await call({}, { tables: builder });
  assertEquals(res.status, 400);
  assertEquals(db.writes(), []);
});

Deno.test("refuses confirm values other than true", async () => {
  const { res } = await call({ confirm: "yes" }, { tables: builder });
  assertEquals(res.status, 400);
});

Deno.test("an update error stops the loop with a 500 instead of spinning", async () => {
  // creatives always answers a row, as it would if the reset never took effect.
  const { res, json } = await call(
    { confirm: true },
    { tables: { ...builder, creatives: [{ ad_id: "a1" }] }, writeErrors: { "update:creatives": { message: "boom" } } },
  );
  assertEquals(res.status, 500);
  assertEquals(String(json.error).includes("boom"), true);
});

Deno.test("clears asset back-references and the media_assets rows, and removes storage", async () => {
  const removed: string[] = [];
  const { db, res, json } = await call(
    { confirm: true },
    {
      tables: {
        ...builder,
        creatives: drainOnce([{ ad_id: "a1" }]),
        media_assets: drainOnce([{ id: "m1" }]),
      },
    },
    storageFake([[{ id: "f1", name: "x.jpg" }]], removed),
  );
  assertEquals(res.status, 200);
  const creativeUpdates = db.writes().filter((o) => o.table === "creatives");
  assertEquals(creativeUpdates.some((o) => JSON.stringify(o.payload).includes("thumb_asset_id")), true);
  assertEquals(db.writes().some((o) => o.table === "media_assets" && o.verb === "delete"), true);
  assertEquals(removed.includes("x.jpg"), true);
  assertEquals(json.media_assets_deleted >= 1, true);
});
