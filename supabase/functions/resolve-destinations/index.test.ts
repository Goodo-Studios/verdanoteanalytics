// Tests for resolve-destinations stored titles (audit plan item 5.10).
//
// The stored-title lookup read one unpaged select, so past 1,000 destinations the rest
// looked new and were upserted with a null page title. A forced run skipped the lookup
// altogether and wrote null over every stored title it could not refetch. Now the lookup
// is paged and a run never writes null over a stored title.
//
//   deno test -A supabase/functions/resolve-destinations/index.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeSupabase } from "../_shared/fake-supabase.ts";

Deno.env.set("RESOLVE_DESTINATIONS_NO_SERVE", "1");
const { resolveAccountDestinations } = await import("./index.ts");

const KEY = "https://shop.example.com/products/late-sock";

// 1,001 stored rows: 1,000 fill the first page, the row for KEY is on the second page. The shared
// fake applies .range() to this list, as PostgREST does.
function pagedStore() {
  return [
    ...Array.from({ length: 1000 }, (_, i) => ({ destination_key: `k${i}`, page_title: `T${i}` })),
    { destination_key: KEY, page_title: "Late Sock" },
  ];
}

const upsertFor = (db: ReturnType<typeof fakeSupabase>, key: string) =>
  db.writes().find((o) =>
    o.verb === "upsert" && (o.payload as { destination_key: string }).destination_key === key
  )?.payload as { page_title: string | null } | undefined;

Deno.test("a stored destination past the first 1,000 rows is skipped, not rewritten with a null title", async () => {
  const db = fakeSupabase({
    rpc: { distinct_destinations: [{ destination_key: KEY, sample_url: KEY }] },
    tables: { landing_destinations: pagedStore() },
  });
  const out = await resolveAccountDestinations(db.client, { accountId: "act_a" });
  assertEquals(upsertFor(db, KEY), undefined);
  assertEquals(out.skipped, 1);
});

Deno.test("a forced run keeps the stored title when no new title is fetched", async () => {
  const db = fakeSupabase({
    rpc: { distinct_destinations: [{ destination_key: KEY, sample_url: KEY }] },
    tables: { landing_destinations: pagedStore() },
  });
  await resolveAccountDestinations(db.client, { accountId: "act_a", force: true });
  assertEquals(upsertFor(db, KEY)?.page_title, "Late Sock");
});

Deno.test("a forced title refresh that fails keeps the stored title", async () => {
  const db = fakeSupabase({
    rpc: { distinct_destinations: [{ destination_key: KEY, sample_url: KEY }] },
    tables: { landing_destinations: pagedStore() },
  });
  await resolveAccountDestinations(db.client, { accountId: "act_a", force: true, fetchTitles: true }, {
    fetchTitle: () => Promise.resolve(null),
  });
  assertEquals(upsertFor(db, KEY)?.page_title, "Late Sock");
});

Deno.test("a fetched title replaces the stored one on a forced refresh", async () => {
  const db = fakeSupabase({
    rpc: { distinct_destinations: [{ destination_key: KEY, sample_url: KEY }] },
    tables: { landing_destinations: pagedStore() },
  });
  await resolveAccountDestinations(db.client, { accountId: "act_a", force: true, fetchTitles: true }, {
    fetchTitle: () => Promise.resolve("Late Sock v2"),
  });
  assertEquals(upsertFor(db, KEY)?.page_title, "Late Sock v2");
});
