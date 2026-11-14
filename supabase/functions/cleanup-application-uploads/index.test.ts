// Tests for the cleanup-application-uploads edge function. The database and storage are an
// in-memory stand-in; nothing reaches the network. Covered:
//   * the gate runs first and only the service role gets through
//   * a dry run (the default, and anything but an explicit false) deletes and writes nothing
//   * a real run needs the switch; with it off nothing is deleted or marked
//   * a real run deletes the draft's files, marks the draft cleaned, and never touches a path
//     outside applications/<draft id>/
//   * the batch limit is honoured and clamped
//   * a failed delete leaves the draft unmarked, so the next run tries again
//   * folders no draft remembers: removed when unprotected and old, kept when protected, young or empty
//   * the answer carries counts only
//
//   deno test -A supabase/functions/cleanup-application-uploads/index.test.ts

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("CLEANUP_APPLICATION_UPLOADS_NO_SERVE", "1");
const { handler, SWITCH_NAME, MAX_LIMIT } = await import("./index.ts");
type Store = Parameters<typeof handler>[1] extends infer D ? (D extends { store?: infer S } ? NonNullable<S> : never) : never;

const allow = () => Promise.resolve(null);
const deny = () => Promise.resolve(new Response("{}", { status: 401 }));
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const OLD = "33333333-3333-4333-8333-333333333333";
const KEPT = "44444444-4444-4444-8444-444444444444";
const YOUNG = "55555555-5555-4555-8555-555555555555";
const NOW = Date.parse("2026-12-10T12:00:00Z");
const longAgo = "2026-11-01T00:00:00Z";
const justNow = "2026-12-10T11:00:00Z";

function makeStore(opts: {
  enabled?: boolean;
  candidates?: { draft_id: string; kind: string }[];
  files?: Record<string, { name: string; created_at: string | null }[]>; // "bucket|folder"
  folders?: Record<string, string[]>; // bucket
  protectedIds?: string[];
  failRemove?: boolean;
} = {}) {
  const calls: string[] = [];
  const removed: string[] = [];
  const marked: string[] = [];
  const store: Store = {
    switchEnabled: (name) => { calls.push(`switch:${name}`); return Promise.resolve(opts.enabled ?? false); },
    candidates: (limit) => { calls.push(`candidates:${limit}`); return Promise.resolve((opts.candidates ?? []).slice(0, limit)); },
    markCleaned: (ids) => { marked.push(...ids); return Promise.resolve(ids.length); },
    unprotected: (ids) => Promise.resolve(ids.filter((i) => !(opts.protectedIds ?? []).includes(i))),
    listFiles: (bucket, folder) => Promise.resolve(opts.files?.[`${bucket}|${folder}`] ?? []),
    listFolders: (bucket, offset) => Promise.resolve(offset === 0 ? (opts.folders?.[bucket] ?? []) : []),
    remove: (bucket, paths) => {
      if (opts.failRemove) return Promise.reject(new Error("boom"));
      removed.push(...paths.map((p) => `${bucket}:${p}`));
      return Promise.resolve();
    },
  };
  return { store, calls, removed, marked };
}

const post = (body?: unknown) =>
  new Request("https://x.test/functions/v1/cleanup-application-uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const run = (store: Store, body?: unknown, authorize: () => Promise<Response | null> = allow) =>
  handler(post(body), { authorize, store, now: () => NOW });

Deno.test("the gate runs first: nothing else is called without the service role", async () => {
  const s = makeStore({ enabled: true, candidates: [{ draft_id: D1, kind: "creator" }] });
  const res = await run(s.store, { dry_run: false }, deny);
  assertEquals(res.status, 401);
  assertEquals(s.calls, []);
});

Deno.test("only POST is accepted", async () => {
  const s = makeStore();
  const res = await handler(new Request("https://x.test/", { method: "GET" }), { authorize: allow, store: s.store });
  assertEquals(res.status, 405);
});

Deno.test("a dry run is the default and deletes and marks nothing", async () => {
  const files = { [`creator-application-videos|applications/${D1}/video`]: [{ name: "a.mp4", created_at: longAgo }, { name: "b.mp4", created_at: longAgo }] };
  for (const body of [undefined, {}, { dry_run: true }, { dry_run: "false" }, { dry_run: 0 }]) {
    const s = makeStore({ enabled: true, candidates: [{ draft_id: D1, kind: "creator" }], files });
    const res = await run(s.store, body);
    const out = await res.json();
    assertEquals(res.status, 200);
    assertEquals(out.dry_run, true);
    assertEquals(out.objects_found, 2);
    assertEquals(out.objects_deleted, 0);
    assertEquals(s.removed, []);
    assertEquals(s.marked, []);
    assertFalse(s.calls.some((c) => c.startsWith("switch:")), "a dry run does not need the switch");
  }
});

Deno.test("a real run with the switch off does nothing", async () => {
  const s = makeStore({ enabled: false, candidates: [{ draft_id: D1, kind: "creator" }] });
  const res = await run(s.store, { dry_run: false });
  const out = await res.json();
  assertEquals(out.status, "switch_off");
  assertEquals(s.calls, [`switch:${SWITCH_NAME}`]);
  assertEquals(s.removed, []);
  assertEquals(s.marked, []);
});

Deno.test("a real run deletes only files inside the draft's own folder and marks the draft", async () => {
  const files = {
    [`creator-application-videos|applications/${D1}/video`]: [{ name: "a.mp4", created_at: longAgo }],
    [`creator-application-headshots|applications/${D1}/headshot`]: [{ name: "h.jpg", created_at: longAgo }, { name: "../../applications/other/video/x.mp4", created_at: longAgo }],
    [`actor-application-videos|applications/${D2}/video`]: [{ name: "z.mov", created_at: longAgo }],
  };
  const s = makeStore({ enabled: true, candidates: [{ draft_id: D1, kind: "creator" }, { draft_id: D2, kind: "actor" }], files });
  const res = await run(s.store, { dry_run: false });
  const out = await res.json();
  assertEquals(out.drafts_cleaned, 2);
  assertEquals(s.marked.sort(), [D1, D2].sort());
  for (const r of s.removed) {
    const path = r.split(":")[1];
    assert(path.startsWith(`applications/${D1}/`) || path.startsWith(`applications/${D2}/`), `unexpected path ${path}`);
    assertFalse(path.includes(".."), "a file name cannot climb out of the folder");
  }
  assert(s.removed.includes(`creator-application-videos:applications/${D1}/video/a.mp4`));
  assert(s.removed.includes(`actor-application-videos:applications/${D2}/video/z.mov`));
});

Deno.test("a draft with an invalid id or unknown kind is skipped", async () => {
  const s = makeStore({ enabled: true, candidates: [{ draft_id: "../../x", kind: "creator" }, { draft_id: D1, kind: "nonsense" }] });
  const out = await (await run(s.store, { dry_run: false })).json();
  assertEquals(out.drafts_examined, 0);
  assertEquals(s.removed, []);
  assertEquals(s.marked, []);
});

Deno.test("the limit is clamped and passed to the database", async () => {
  const a = makeStore({ enabled: true });
  await run(a.store, { limit: 100000 });
  assert(a.calls.includes(`candidates:${MAX_LIMIT}`));
  const b = makeStore({ enabled: true });
  await run(b.store, { limit: -5 });
  assert(b.calls.includes("candidates:1"));
  const c = makeStore({ enabled: true });
  await run(c.store, {});
  assert(c.calls.includes("candidates:25"));
});

Deno.test("a failed delete leaves the draft unmarked for the next run", async () => {
  const files = { [`creator-application-videos|applications/${D1}/video`]: [{ name: "a.mp4", created_at: longAgo }] };
  const s = makeStore({ enabled: true, candidates: [{ draft_id: D1, kind: "creator" }], files, failRemove: true });
  const out = await (await run(s.store, { dry_run: false })).json();
  assertEquals(out.errors, 1);
  assertEquals(s.marked, []);
});

Deno.test("folders no draft remembers: old unprotected ones go; protected, young and empty ones stay", async () => {
  const bucket = "creator-application-videos";
  const files = {
    [`${bucket}|applications/${OLD}/video`]: [{ name: "o.mp4", created_at: longAgo }],
    [`${bucket}|applications/${KEPT}/video`]: [{ name: "k.mp4", created_at: longAgo }],
    [`${bucket}|applications/${YOUNG}/video`]: [{ name: "y.mp4", created_at: justNow }],
  };
  const s = makeStore({ enabled: true, files, folders: { [bucket]: [OLD, KEPT, YOUNG, "not-a-uuid"] }, protectedIds: [KEPT] });
  const out = await (await run(s.store, { dry_run: false })).json();
  assertEquals(out.orphan_folders_deleted, 1);
  assertEquals(s.removed, [`${bucket}:applications/${OLD}/video/o.mp4`]);
  const dry = makeStore({ enabled: true, files, folders: { [bucket]: [OLD, KEPT, YOUNG] }, protectedIds: [KEPT] });
  const dryOut = await (await run(dry.store, {})).json();
  assertEquals(dryOut.orphan_folders_found, 1);
  assertEquals(dry.removed, []);
});

Deno.test("the answer carries counts only, never file names", async () => {
  const files = { [`creator-application-videos|applications/${D1}/video`]: [{ name: "secret-name.mp4", created_at: longAgo }] };
  const s = makeStore({ enabled: true, candidates: [{ draft_id: D1, kind: "creator" }], files });
  const text = await (await run(s.store, { dry_run: false })).text();
  assertFalse(text.includes("secret-name"));
  assertFalse(text.includes(D1));
});
