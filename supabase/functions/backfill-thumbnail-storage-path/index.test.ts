// Regression tests for backfill-thumbnail-storage-path.
//
//   deno test -A supabase/functions/backfill-thumbnail-storage-path/index.test.ts
//
// BACKFILL_THUMB_PATH_NO_SERVE is set before import so the module-level
// Deno.serve() never binds a port (same convention as refresh-thumbnails).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BACKFILL_THUMB_PATH_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const mod = await import("./index.ts");

interface Row {
  ad_id: string;
  account_id: string;
  thumbnail_storage_path: string | null;
  thumbnail_url: string | null;
}

/**
 * A minimal recorder: one page of `rows`, records every chain-method call (so
 * scoping filters can be asserted directly, same pattern as
 * refresh-thumbnails/index.test.ts's makeRecorder), and captures every
 * .update() payload.
 */
function makeRecorder(rows: Row[]) {
  const updates: { adId: string; payload: Record<string, unknown> }[] = [];
  const calls: { method: string; args: unknown[] }[] = [];
  let served = false; // the query builder only returns `rows` once, then empty (one page)
  const builder: Record<string, unknown> = {};
  const chain = ["select", "not", "order", "eq"];
  for (const m of chain) {
    builder[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return builder; };
  }
  builder.range = (...args: unknown[]) => {
    calls.push({ method: "range", args });
    if (served) return Promise.resolve({ data: [], error: null });
    served = true;
    return Promise.resolve({ data: rows, error: null });
  };
  const updateBuilder = (payload: Record<string, unknown>) => ({
    eq: (_col: string, adId: string) => {
      updates.push({ adId, payload });
      return Promise.resolve({ error: null });
    },
  });
  builder.update = updateBuilder;
  const supabase = { from: (_table: string) => ({ ...builder, update: updateBuilder }) };
  return { supabase, updates, calls };
}

function req(body: Record<string, unknown> = {}): Request {
  return new Request("https://fn.local/backfill-thumbnail-storage-path", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify(body),
  });
}

const GOOD_URL = (acc: string, ad: string, ext = "jpg") =>
  `https://example.supabase.co/storage/v1/object/public/ad-thumbnails/${acc}/${ad}.${ext}`;

Deno.test("fixes a row whose thumbnail_storage_path is missing its extension", async () => {
  const { supabase, updates } = makeRecorder([
    { ad_id: "a1", account_id: "act_x", thumbnail_storage_path: "act_x/a1", thumbnail_url: GOOD_URL("act_x", "a1") },
  ]);
  const res = await mod.handler(req(), supabase);
  const body = await res.json();
  assertEquals(body.counters.fixed, 1);
  assertEquals(body.counters.already_ok, 0);
  assertEquals(updates.length, 1);
  assertEquals(updates[0].adId, "a1");
  assertEquals(updates[0].payload.thumbnail_storage_path, "act_x/a1.jpg");
});

Deno.test("already-correct rows are left alone (idempotent)", async () => {
  const { supabase, updates } = makeRecorder([
    { ad_id: "a1", account_id: "act_x", thumbnail_storage_path: "act_x/a1.jpg", thumbnail_url: GOOD_URL("act_x", "a1") },
  ]);
  const res = await mod.handler(req(), supabase);
  const body = await res.json();
  assertEquals(body.counters.already_ok, 1);
  assertEquals(body.counters.fixed, 0);
  assertEquals(updates.length, 0, "must not write a row that is already correct");
});

Deno.test("dry_run never writes, but reports what WOULD be fixed", async () => {
  const { supabase, updates } = makeRecorder([
    { ad_id: "a1", account_id: "act_x", thumbnail_storage_path: "act_x/a1", thumbnail_url: GOOD_URL("act_x", "a1", "png") },
  ]);
  const res = await mod.handler(req({ dry_run: true }), supabase);
  const body = await res.json();
  assertEquals(body.dry_run, true);
  assertEquals(body.counters.fixed, 1);
  assertEquals(updates.length, 0, "dry_run must never call update");
  assertEquals(body.remaining_bad_estimate, 1);
});

Deno.test("a live but never-cached CDN url (not a storage URL) is left untouched, not guessed", async () => {
  const { supabase, updates } = makeRecorder([
    { ad_id: "a1", account_id: "act_x", thumbnail_storage_path: "act_x/a1", thumbnail_url: "https://scontent.fbcdn.net/v/whatever.jpg" },
  ]);
  const res = await mod.handler(req(), supabase);
  const body = await res.json();
  assertEquals(body.counters.skipped_no_storage_url, 1);
  assertEquals(body.counters.fixed, 0);
  assertEquals(updates.length, 0);
});

Deno.test("a row with no thumbnail_url at all is left untouched", async () => {
  const { supabase, updates } = makeRecorder([
    { ad_id: "a1", account_id: "act_x", thumbnail_storage_path: "act_x/a1", thumbnail_url: null },
  ]);
  const res = await mod.handler(req(), supabase);
  const body = await res.json();
  assertEquals(body.counters.skipped_no_storage_url, 1);
  assertEquals(updates.length, 0);
});

Deno.test("thumbnail_url resolving to a DIFFERENT account/ad is flagged as a mismatch, never trusted", async () => {
  // Guards the case where a row's URL somehow points at another ad's object —
  // must never blindly copy an unrelated path into thumbnail_storage_path.
  const { supabase, updates } = makeRecorder([
    { ad_id: "a1", account_id: "act_x", thumbnail_storage_path: "act_x/a1", thumbnail_url: GOOD_URL("act_x", "OTHER_AD") },
  ]);
  const res = await mod.handler(req(), supabase);
  const body = await res.json();
  assertEquals(body.counters.skipped_mismatch, 1);
  assertEquals(body.counters.fixed, 0);
  assertEquals(updates.length, 0);
  assert(body.mismatches?.[0]?.includes("a1"), "mismatch should be logged with the offending ad_id");
});

Deno.test("a URL in a different bucket is flagged as a mismatch, never trusted", async () => {
  const { supabase, updates } = makeRecorder([
    {
      ad_id: "a1", account_id: "act_x", thumbnail_storage_path: "act_x/a1",
      thumbnail_url: "https://example.supabase.co/storage/v1/object/public/ad-videos/act_x/a1.mp4",
    },
  ]);
  const res = await mod.handler(req(), supabase);
  const body = await res.json();
  assertEquals(body.counters.skipped_mismatch, 1);
  assertEquals(updates.length, 0);
});

Deno.test("a poster-frame URL (posters/<ad_id>.jpg, account-agnostic) IS fixed, not flagged", async () => {
  // scripts/regenerate-video-posters.mjs stores upgraded video poster frames at
  // ad-thumbnails/posters/<ad_id>.jpg — a shared folder, no account_id segment —
  // and (before PR #97's fix) never wrote thumbnail_storage_path at all. This is
  // a second LEGITIMATE path shape, not a mismatch, and should be fixed like any
  // other row once the ad_id matches.
  const { supabase, updates } = makeRecorder([
    {
      ad_id: "120230152349440248", account_id: "act_x", thumbnail_storage_path: "act_x/120230152349440248",
      thumbnail_url: "https://example.supabase.co/storage/v1/object/public/ad-thumbnails/posters/120230152349440248.jpg",
    },
  ]);
  const res = await mod.handler(req(), supabase);
  const body = await res.json();
  assertEquals(body.counters.fixed, 1);
  assertEquals(body.counters.fixed_poster_frame, 1);
  assertEquals(body.counters.skipped_mismatch, 0);
  assertEquals(updates.length, 1);
  assertEquals(updates[0].payload.thumbnail_storage_path, "posters/120230152349440248.jpg");
});

Deno.test("a poster-frame URL for a DIFFERENT ad_id is still flagged as a mismatch — the ad_id is always checked", async () => {
  // The poster-frame shape is accepted, but never as a blanket "anything under
  // posters/ is fine" — it must still resolve to THIS row's own ad_id.
  const { supabase, updates } = makeRecorder([
    {
      ad_id: "a1", account_id: "act_x", thumbnail_storage_path: "act_x/a1",
      thumbnail_url: "https://example.supabase.co/storage/v1/object/public/ad-thumbnails/posters/SOME_OTHER_AD.jpg",
    },
  ]);
  const res = await mod.handler(req(), supabase);
  const body = await res.json();
  assertEquals(body.counters.skipped_mismatch, 1);
  assertEquals(body.counters.fixed, 0);
  assertEquals(updates.length, 0);
});

Deno.test("mixed batch: fixed, already_ok, and skipped counted independently and correctly", async () => {
  const { supabase, updates } = makeRecorder([
    { ad_id: "a1", account_id: "act_x", thumbnail_storage_path: "act_x/a1", thumbnail_url: GOOD_URL("act_x", "a1") },
    { ad_id: "a2", account_id: "act_x", thumbnail_storage_path: "act_x/a2.png", thumbnail_url: GOOD_URL("act_x", "a2", "png") },
    { ad_id: "a3", account_id: "act_x", thumbnail_storage_path: "act_x/a3", thumbnail_url: null },
  ]);
  const res = await mod.handler(req(), supabase);
  const body = await res.json();
  assertEquals(body.counters.scanned, 3);
  assertEquals(body.counters.fixed, 1);
  assertEquals(body.counters.already_ok, 1);
  assertEquals(body.counters.skipped_no_storage_url, 1);
  assertEquals(updates.length, 1);
  assertEquals(updates[0].adId, "a1");
});

Deno.test("account_id scoping: an explicit account filter is applied to the query", async () => {
  const { supabase, calls } = makeRecorder([]);
  await mod.handler(req({ account_id: "act_scoped" }), supabase);
  const sawAccountFilter = calls.some(
    (c) => c.method === "eq" && c.args[0] === "account_id" && c.args[1] === "act_scoped",
  );
  assert(sawAccountFilter, "query must scope by account_id when provided");
});

Deno.test("account_id filter is applied BEFORE the terminal .range() call, not after", async () => {
  // Regression: an earlier draft built .range() first and tried to .eq() the
  // returned (already-terminal) value afterward, which either throws or
  // silently drops the filter depending on the client. Order matters.
  const { supabase, calls } = makeRecorder([]);
  await mod.handler(req({ account_id: "act_scoped" }), supabase);
  const eqIdx = calls.findIndex((c) => c.method === "eq");
  const rangeIdx = calls.findIndex((c) => c.method === "range");
  assert(eqIdx >= 0 && rangeIdx >= 0, "both eq and range must be called");
  assert(eqIdx < rangeIdx, "account_id filter must be applied before .range()");
});

Deno.test("OPTIONS request short-circuits with CORS headers, no auth/db work", async () => {
  const res = await mod.handler(new Request("https://fn.local/x", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});

Deno.test("missing service-role auth is rejected before any query runs", async () => {
  const { supabase, updates } = makeRecorder([
    { ad_id: "a1", account_id: "act_x", thumbnail_storage_path: "act_x/a1", thumbnail_url: GOOD_URL("act_x", "a1") },
  ]);
  const unauthed = new Request("https://fn.local/backfill-thumbnail-storage-path", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const res = await mod.handler(unauthed, supabase);
  assert(res.status === 401 || res.status === 403, `expected an auth rejection, got ${res.status}`);
  assertEquals(updates.length, 0, "no writes must happen without valid auth");
});
