// Tests for the ingest-reviews service-role persister (US-002).
//
// Covers:
//   * validatePayload — required account_id + batch_key, array shapes, empty-batch guard.
//   * toReviewRow / toClusterRow — column mapping + batch markers (raw.batch_key on
//     reviews, source=csv:<batch_key> on clusters), the markers that make the
//     delete-then-insert idempotency work.
//   * isAuthorized — open when INGEST_SECRET unset, else header/Bearer must match.
//   * handler() against a recording mock client — asserts the per-batch delete
//     SWEEP (so a re-POST replaces, not duplicates) runs on BOTH tables with the
//     correct (account_id, batch marker) scope, then inserts both row sets.
//
// INGEST_NO_SERVE is set before import so the module-level Deno.serve never binds.
//   deno test -A supabase/functions/ingest-reviews/index.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("INGEST_NO_SERVE", "1");
// Read with `!` at client-build time; irrelevant because tests inject a mock client.
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
// No INGEST_SECRET by default -> auth guard is open (gateway bearer assumed).
Deno.env.delete("INGEST_SECRET");

const mod = await import("./index.ts");

// ---- Pure functions --------------------------------------------------------

Deno.test("validatePayload rejects missing/empty account_id", () => {
  assert(!mod.validatePayload({ batch_key: "b1", reviews: [{}] }).ok);
  assert(!mod.validatePayload({ account_id: "  ", batch_key: "b1", reviews: [{}] }).ok);
});

Deno.test("validatePayload requires batch_key for idempotency", () => {
  assert(!mod.validatePayload({ account_id: "act_1", reviews: [{}] }).ok);
  assert(!mod.validatePayload({ account_id: "act_1", batch_key: "", reviews: [{}] }).ok);
});

Deno.test("validatePayload rejects non-array reviews/angle_clusters", () => {
  assert(!mod.validatePayload({ account_id: "act_1", batch_key: "b1", reviews: "nope" } as unknown as Record<string, unknown>).ok);
  assert(!mod.validatePayload({ account_id: "act_1", batch_key: "b1", angle_clusters: {} } as unknown as Record<string, unknown>).ok);
});

Deno.test("validatePayload rejects an empty batch (nothing to ingest)", () => {
  const r = mod.validatePayload({ account_id: "act_1", batch_key: "b1", reviews: [], angle_clusters: [] });
  assert(!r.ok);
});

Deno.test("validatePayload accepts a reviews-only or clusters-only batch", () => {
  assert(mod.validatePayload({ account_id: "act_1", batch_key: "b1", reviews: [{}] }).ok);
  assert(mod.validatePayload({ account_id: "act_1", batch_key: "b1", angle_clusters: [{}] }).ok);
});

Deno.test("toReviewRow maps columns and stamps batch_key into raw", () => {
  const row = mod.toReviewRow("act_1", "b1", {
    source: "amazon",
    review_text: "great",
    rating: 5,
    raw: { foo: "bar" },
  });
  assertEquals(row.account_id, "act_1");
  assertEquals(row.source, "amazon");
  assertEquals(row.review_text, "great");
  assertEquals(row.rating, 5);
  assertEquals((row.raw as Record<string, unknown>).batch_key, "b1");
  assertEquals((row.raw as Record<string, unknown>).foo, "bar");
});

Deno.test("toReviewRow defaults source to csv and tolerates a missing raw", () => {
  const row = mod.toReviewRow("act_1", "b1", { review_text: "x" });
  assertEquals(row.source, "csv");
  assertEquals((row.raw as Record<string, unknown>).batch_key, "b1");
});

Deno.test("toClusterRow encodes the batch into source (idempotency marker)", () => {
  const row = mod.toClusterRow("act_1", "b1", {
    label: "value",
    pains: ["too pricey", 42] as unknown as string[],
    source: "ignored-by-design",
  });
  assertEquals(row.account_id, "act_1");
  assertEquals(row.label, "value");
  // Non-string array members are dropped.
  assertEquals(row.pains, ["too pricey"]);
  // Caller-supplied source is overridden with the batch marker, matching the sweep.
  assertEquals(row.source, mod.batchSource("b1"));
  assertEquals(row.source, "csv:b1");
});

// ---- supporting_review_ids reconciliation (regression: UUID[] 22P02) -------

Deno.test("isUuid / reviewIndexToken recognize their inputs", () => {
  assert(mod.isUuid("11111111-2222-4333-8444-555555555555"));
  assert(!mod.isUuid("review_1"));
  assert(!mod.isUuid("review_index:3"));
  assertEquals(mod.reviewIndexToken("review_index:42"), 42);
  assertEquals(mod.reviewIndexToken("review_1"), null);
  assertEquals(mod.reviewIndexToken("not-a-token"), null);
});

Deno.test("keepUuids drops non-UUID tokens (default cluster resolver)", () => {
  const u = "11111111-2222-4333-8444-555555555555";
  assertEquals(mod.keepUuids([u, "review_index:0", "review_1"]), [u]);
});

Deno.test("makeSupportingResolver maps review_index tokens to real UUIDs and drops unknowns", () => {
  const idA = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  const idB = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
  const resolve = mod.makeSupportingResolver(new Map([[0, idA], [2, idB]]));
  // review_index:0 -> idA, review_index:1 -> unknown (dropped), review_index:2 -> idB,
  // a raw UUID passes through, junk is dropped.
  const passUuid = "cccccccc-3333-4333-8333-cccccccccccc";
  assertEquals(
    resolve(["review_index:0", "review_index:1", "review_index:2", passUuid, "review_99", "garbage"]),
    [idA, idB, passUuid],
  );
});

Deno.test("toClusterRow never emits non-UUID supporting_review_ids (default resolver)", () => {
  // This is exactly the producer's output shape (review-mining buildIngestPayload
  // emits `review_index:<n>` tokens). With the default resolver and no map, they
  // are dropped rather than written — the bug was passing them straight into a
  // UUID[] column, which 500'd with Postgres 22P02.
  const row = mod.toClusterRow("act_1", "b1", {
    label: "value",
    supporting_review_ids: ["review_index:0", "review_index:3", "review_7"],
  });
  assertEquals(row.supporting_review_ids, []);
});

Deno.test("toReviewRow stamps review_index into raw when supplied", () => {
  const row = mod.toReviewRow("act_1", "b1", { review_text: "x" }, 5);
  assertEquals((row.raw as Record<string, unknown>).review_index, 5);
  assertEquals((row.raw as Record<string, unknown>).batch_key, "b1");
});

Deno.test("handler resolves cluster review_index tokens to inserted review UUIDs", async () => {
  // Mock client where the customer_reviews insert .select('id, raw') returns rows
  // carrying raw.review_index (mirroring the real RETURNING), and we capture the
  // exact rows passed to angle_clusters.insert to assert the tokens were resolved.
  const reviewId0 = "11111111-1111-4111-8111-111111111111";
  const reviewId1 = "22222222-2222-4222-8222-222222222222";
  let insertedClusterRows: Array<{ supporting_review_ids?: unknown }> = [];
  let currentTable = "";
  const builder: Record<string, unknown> = {};
  for (const m of ["eq", "delete", "in", "is", "neq"]) {
    builder[m] = () => builder;
  }
  builder.insert = (rows: Array<Record<string, unknown>>) => {
    if (currentTable === "angle_clusters") {
      insertedClusterRows = rows as Array<{ supporting_review_ids?: unknown }>;
    }
    return builder;
  };
  builder.select = (cols: string) => {
    if (currentTable === "customer_reviews" && typeof cols === "string" && cols.includes("raw")) {
      return Promise.resolve({
        data: [
          { id: reviewId0, raw: { batch_key: "b1", review_index: 0 } },
          { id: reviewId1, raw: { batch_key: "b1", review_index: 1 } },
        ],
        error: null,
      });
    }
    return Promise.resolve({ data: [{ id: "cluster-1" }], error: null });
  };
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  const supabase = {
    from: (table: string) => {
      currentTable = table;
      return builder;
    },
  };

  const res = await mod.handler(
    makePost({
      account_id: "act_1",
      batch_key: "b1",
      reviews: [{ review_text: "a" }, { review_text: "b" }],
      angle_clusters: [
        { label: "value", supporting_review_ids: ["review_index:0", "review_index:1", "review_index:9", "junk"] },
      ],
    }),
    supabase,
  );
  assertEquals(res.status, 200);
  assertEquals(insertedClusterRows.length, 1);
  // review_index:0/1 -> real UUIDs; review_index:9 (out of range) + junk dropped.
  assertEquals(insertedClusterRows[0].supporting_review_ids, [reviewId0, reviewId1]);
});

Deno.test("isAuthorized is open when no secret configured", () => {
  const req = new Request("https://fn.local/ingest-reviews", { method: "POST" });
  assert(mod.isAuthorized(req, undefined));
});

Deno.test("isAuthorized checks x-ingest-secret header and Bearer", () => {
  const ok = new Request("https://fn.local/ingest-reviews", {
    method: "POST",
    headers: { "x-ingest-secret": "s3cret" },
  });
  const okBearer = new Request("https://fn.local/ingest-reviews", {
    method: "POST",
    headers: { "Authorization": "Bearer s3cret" },
  });
  const bad = new Request("https://fn.local/ingest-reviews", {
    method: "POST",
    headers: { "x-ingest-secret": "wrong" },
  });
  assert(mod.isAuthorized(ok, "s3cret"));
  assert(mod.isAuthorized(okBearer, "s3cret"));
  assert(!mod.isAuthorized(bad, "s3cret"));
});

// ---- Recording mock client + handler ---------------------------------------

interface Call {
  method: string;
  args: unknown[];
}

/**
 * Chainable Supabase query-builder stand-in. Every filter/modifier records its
 * call (tagged with the table from the preceding .from()) and returns `this`.
 * `.select()` and awaiting the builder resolve to a small data set so insert
 * counts are realized. `.delete()` resolves to empty.
 */
function makeRecorder() {
  const calls: Call[] = [];
  let currentTable = "";
  const builder: Record<string, unknown> = {};
  const chainMethods = ["select", "eq", "delete", "insert", "in", "is", "neq"];
  for (const m of chainMethods) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args: [currentTable, ...args] });
      return builder;
    };
  }
  // select resolves to one row so insert-count uses data.length.
  builder.select = (...args: unknown[]) => {
    calls.push({ method: "select", args: [currentTable, ...args] });
    return Promise.resolve({ data: [{ id: "row-1" }], error: null });
  };
  // Awaiting a delete()/builder with no terminal select yields empty.
  builder.then = (resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null });

  const supabase = {
    from: (table: string, ...rest: unknown[]) => {
      currentTable = table;
      calls.push({ method: "from", args: [table, ...rest] });
      return builder;
    },
  };
  return { supabase, calls };
}

function callsForTable(calls: Call[], table: string): Call[] {
  return calls.filter((c) => c.args[0] === table);
}

function hasCall(calls: Call[], method: string, table: string, arg1: unknown, arg2: unknown): boolean {
  return calls.some(
    (c) => c.method === method && c.args[0] === table && c.args[1] === arg1 && c.args[2] === arg2,
  );
}

function makePost(body: unknown): Request {
  return new Request("https://fn.local/ingest-reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("handler rejects non-POST with 405", async () => {
  const { supabase } = makeRecorder();
  const res = await mod.handler(
    new Request("https://fn.local/ingest-reviews", { method: "GET" }),
    supabase,
  );
  assertEquals(res.status, 405);
});

Deno.test("handler OPTIONS preflight returns CORS ok", async () => {
  const res = await mod.handler(
    new Request("https://fn.local/ingest-reviews", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
  assert(res.headers.get("Access-Control-Allow-Origin") !== null);
});

Deno.test("handler 400s an invalid payload", async () => {
  const { supabase, calls } = makeRecorder();
  const res = await mod.handler(makePost({ account_id: "act_1" }), supabase);
  assertEquals(res.status, 400);
  // No DB work on a bad payload.
  assertEquals(calls.length, 0);
});

Deno.test("handler 401s when secret is set and request lacks it", async () => {
  Deno.env.set("INGEST_SECRET", "s3cret");
  try {
    const { supabase } = makeRecorder();
    const res = await mod.handler(makePost({ account_id: "act_1", batch_key: "b1", reviews: [{}] }), supabase);
    assertEquals(res.status, 401);
  } finally {
    Deno.env.delete("INGEST_SECRET");
  }
});

Deno.test("handler sweeps then inserts both tables scoped to (account_id, batch marker)", async () => {
  const { supabase, calls } = makeRecorder();
  const res = await mod.handler(
    makePost({
      account_id: "act_1",
      batch_key: "b1",
      reviews: [{ review_text: "a" }, { review_text: "b" }],
      angle_clusters: [{ label: "value" }],
    }),
    supabase,
  );
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.success, true);
  assertEquals(json.account_id, "act_1");
  assertEquals(json.batch_key, "b1");

  // Idempotency sweep: delete on customer_reviews scoped by account_id + raw->>batch_key.
  const reviewCalls = callsForTable(calls, "customer_reviews");
  assert(reviewCalls.some((c) => c.method === "delete"), "reviews must be swept by delete");
  assert(hasCall(calls, "eq", "customer_reviews", "account_id", "act_1"), "reviews sweep scoped to account_id");
  assert(hasCall(calls, "eq", "customer_reviews", "raw->>batch_key", "b1"), "reviews sweep scoped to batch_key");
  assert(reviewCalls.some((c) => c.method === "insert"), "reviews must be inserted");

  // Idempotency sweep: delete on angle_clusters scoped by account_id + source=csv:<batch_key>.
  const clusterCalls = callsForTable(calls, "angle_clusters");
  assert(clusterCalls.some((c) => c.method === "delete"), "clusters must be swept by delete");
  assert(hasCall(calls, "eq", "angle_clusters", "account_id", "act_1"), "clusters sweep scoped to account_id");
  assert(
    hasCall(calls, "eq", "angle_clusters", "source", mod.batchSource("b1")),
    "clusters sweep scoped to the batch marker (source=csv:<batch_key>)",
  );
  assert(clusterCalls.some((c) => c.method === "insert"), "clusters must be inserted");
});

Deno.test("handler skips a table's insert when that array is empty", async () => {
  const { supabase, calls } = makeRecorder();
  const res = await mod.handler(
    makePost({ account_id: "act_1", batch_key: "b1", reviews: [{ review_text: "a" }] }),
    supabase,
  );
  assertEquals(res.status, 200);
  // Reviews inserted; clusters never inserted (none supplied) but still swept.
  assert(callsForTable(calls, "customer_reviews").some((c) => c.method === "insert"));
  assert(callsForTable(calls, "angle_clusters").some((c) => c.method === "delete"));
  assert(!callsForTable(calls, "angle_clusters").some((c) => c.method === "insert"));
});
