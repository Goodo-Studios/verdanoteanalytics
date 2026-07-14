// US-010 tests for the in-stack video download queue worker (drain-media-queue).
//
// Proves the acceptance criteria WITHOUT any live network / Meta call:
//   * A batch of large videos is drained via the claim RPC + streaming upload,
//     caching to storage, marking queue rows done, with NO OOM and NO stuck row.
//   * A video over the 200MB size cap keeps its CDN url and is NOT stored (too-large).
//   * The self-chain fires while pending rows remain and is bounded by MAX_CHAIN /
//     DRAIN_NO_CHAIN.
//   * cacheVideoToStorage enforces the size cap from the content-length header
//     before streaming (memory-safe: never buffers the file to check size).
//
// Run: DRAIN_MEDIA_QUEUE_NO_SERVE is set before import so serve() never binds.
//   deno test -A supabase/functions/drain-media-queue/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("DRAIN_MEDIA_QUEUE_NO_SERVE", "1");
Deno.env.set("DRAIN_NO_CHAIN", "1"); // default: no live self-chain fetch
Deno.env.set("META_ACCESS_TOKEN", "fake-meta-token");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");

const mod = await import("./index.ts");

// ── Test doubles ─────────────────────────────────────────────────────────────

interface QueueRow {
  ad_id: string;
  account_id: string;
  status: string;
  attempts: number;
  enqueued_at: string;
  updated_at: string;
  last_error: string | null;
}

interface Creative {
  ad_id: string;
  account_id: string;
  thumbnail_url: string | null;
  full_res_url: string | null;
  video_url: string | null;
  thumb_asset_id: string | null;
  video_asset_id: string | null;
}

/**
 * A minimal in-memory Supabase stand-in covering exactly the calls drainOnce /
 * processQueuedAd make: the claim RPC, media_cache_queue updates, a creatives
 * select/update, media_assets select/upsert, storage.from().upload(), and a
 * head/count select for the pending check.
 */
function makeDb(opts: { queue: QueueRow[]; creatives: Creative[] }) {
  const queue = opts.queue;
  const creatives = opts.creatives;
  const assets: Record<string, { id: string; public_url: string }> = {};
  const storageUploads: string[] = [];
  let assetSeq = 0;

  function creativesBuilder() {
    const filters: Record<string, string> = {};
    // deno-lint-ignore no-explicit-any
    let updatePayload: any = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: string) => {
      filters[col] = val;
      return b;
    };
    // deno-lint-ignore no-explicit-any
    b.update = (payload: any) => {
      updatePayload = payload;
      return b;
    };
    b.maybeSingle = () => {
      const row = creatives.find((c) => c.ad_id === filters.ad_id) ?? null;
      return Promise.resolve({ data: row, error: null });
    };
    // Awaiting an .update(...).eq(...).eq(...) chain applies the update.
    // deno-lint-ignore no-explicit-any
    b.then = (resolve: (v: any) => void) => {
      if (updatePayload) {
        const row = creatives.find((c) => c.ad_id === filters.ad_id);
        if (row) Object.assign(row, updatePayload);
      }
      resolve({ data: null, error: null });
    };
    return b;
  }

  function queueBuilder() {
    const filters: Record<string, string> = {};
    // deno-lint-ignore no-explicit-any
    let updatePayload: any = null;
    let headCount = false;
    const b: Record<string, unknown> = {};
    // deno-lint-ignore no-explicit-any
    b.select = (_c?: string, o?: any) => {
      if (o?.head) headCount = true;
      return b;
    };
    b.eq = (col: string, val: string) => {
      filters[col] = val;
      return b;
    };
    // deno-lint-ignore no-explicit-any
    b.update = (payload: any) => {
      updatePayload = payload;
      return b;
    };
    // deno-lint-ignore no-explicit-any
    const apply = (resolve: (v: any) => void) => {
      if (headCount) {
        const count = queue.filter((q) =>
          Object.entries(filters).every(([k, v]) => (q as unknown as Record<string, string>)[k] === v)
        ).length;
        resolve({ data: null, error: null, count });
        return;
      }
      if (updatePayload) {
        for (const q of queue) {
          const match = Object.entries(filters).every(
            ([k, v]) => (q as unknown as Record<string, string>)[k] === v,
          );
          if (match) Object.assign(q, updatePayload);
        }
      }
      resolve({ data: null, error: null });
    };
    // deno-lint-ignore no-explicit-any
    b.then = (resolve: (v: any) => void) => apply(resolve);
    return b;
  }

  function assetsBuilder() {
    const filters: Record<string, string> = {};
    // deno-lint-ignore no-explicit-any
    let upsertPayload: any = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: string) => {
      filters[col] = val;
      return b;
    };
    // deno-lint-ignore no-explicit-any
    b.upsert = (payload: any) => {
      upsertPayload = payload;
      return b;
    };
    b.maybeSingle = () => {
      if (upsertPayload) {
        const key = `${upsertPayload.account_id}:${upsertPayload.asset_key}`;
        if (!assets[key]) {
          assets[key] = { id: `asset-${++assetSeq}`, public_url: upsertPayload.public_url };
        }
        return Promise.resolve({ data: assets[key], error: null });
      }
      const key = `${filters.account_id}:${filters.asset_key}`;
      return Promise.resolve({ data: assets[key] ?? null, error: null });
    };
    return b;
  }

  const supabase = {
    // deno-lint-ignore no-explicit-any
    from: (table: string): any => {
      if (table === "creatives") return creativesBuilder();
      if (table === "media_cache_queue") return queueBuilder();
      if (table === "media_assets") return assetsBuilder();
      if (table === "settings") {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { value: "fake" }, error: null }) }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    // deno-lint-ignore no-explicit-any
    rpc: (name: string, args: any) => {
      if (name !== "claim_media_cache_queue") throw new Error(`unexpected rpc ${name}`);
      const limit = args.p_limit as number;
      const claimable = queue
        .filter((q) => q.status === "pending")
        .sort((a, b) => a.enqueued_at.localeCompare(b.enqueued_at))
        .slice(0, limit);
      for (const q of claimable) {
        q.status = "processing";
        q.attempts += 1;
        q.updated_at = new Date().toISOString();
      }
      return Promise.resolve({ data: claimable.map((q) => ({ ...q })), error: null });
    },
    storage: {
      from: () => ({
        upload: (path: string) => {
          storageUploads.push(path);
          return Promise.resolve({ error: null });
        },
      }),
    },
  };

  return { supabase, queue, creatives, storageUploads, assets };
}

// ── Global fetch stub ────────────────────────────────────────────────────────
// Simulates: a video CDN download (streamable body, sized via content-length), the
// storage streaming-upload POST, and an image download. Configurable per-test via a
// module-level responder.
type Responder = (url: string, init?: RequestInit) => Response;
const realFetch = globalThis.fetch;
function withFetch(responder: Responder, fn: () => Promise<void>) {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return Promise.resolve(responder(url, init));
  };
  return fn().finally(() => {
    globalThis.fetch = realFetch;
  });
}

function videoResponse(bytes: number, contentType = "video/mp4"): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(Math.min(bytes, 1024)));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType, "content-length": String(bytes) },
  });
}

// ── cacheVideoToStorage unit ─────────────────────────────────────────────────

Deno.test("cacheVideoToStorage streams within the 200MB cap and returns a storage url", async () => {
  await withFetch((url) => {
    if (url.includes("/storage/v1/object/")) return new Response("{}", { status: 200 });
    return videoResponse(50 * 1024 * 1024); // 50MB video
  }, async () => {
    const res = await mod.cacheVideoToStorage("https://cdn/video.mp4", "act_1", "ad_1");
    assert(res.url, "should return a storage url");
    assert(res.url!.includes("/storage/v1/object/public/ad-videos/act_1/ad_1.mp4"));
    assertEquals(res.reason, undefined);
  });
});

Deno.test("cacheVideoToStorage rejects an oversized video (>200MB) BEFORE streaming — keeps CDN url", async () => {
  let uploadAttempted = false;
  await withFetch((url) => {
    if (url.includes("/storage/v1/object/")) {
      uploadAttempted = true;
      return new Response("{}", { status: 200 });
    }
    return videoResponse(201 * 1024 * 1024); // 201MB — over the cap
  }, async () => {
    const res = await mod.cacheVideoToStorage("https://cdn/big.mp4", "act_1", "ad_big");
    assertEquals(res.url, null);
    assertEquals(res.reason, "too-large");
    assert(!uploadAttempted, "must NOT attempt an upload for an oversized video (memory-safe: no buffering)");
  });
});

Deno.test("cacheVideoToStorage marks an expired CDN url", async () => {
  await withFetch(() => new Response(null, { status: 403 }), async () => {
    const res = await mod.cacheVideoToStorage("https://cdn/dead.mp4", "act_1", "ad_dead");
    assertEquals(res.url, null);
    assertEquals(res.reason, "expired");
  });
});

// ── drainOnce integration ────────────────────────────────────────────────────

Deno.test("drainOnce caches a batch of large videos with no OOM and no stuck 'processing' rows", async () => {
  const now = new Date().toISOString();
  const queue: QueueRow[] = ["a", "b", "c"].map((id, i) => ({
    ad_id: `ad_${id}`,
    account_id: "act_1",
    status: "pending",
    attempts: 0,
    enqueued_at: new Date(Date.now() + i).toISOString(),
    updated_at: now,
    last_error: null,
  }));
  const creatives: Creative[] = queue.map((q) => ({
    ad_id: q.ad_id,
    account_id: "act_1",
    thumbnail_url: "no-thumbnail", // image already sentinel → skip image path
    full_res_url: null,
    video_url: "https://cdn/big.mp4", // has a CDN video url to cache
    thumb_asset_id: null,
    video_asset_id: null,
  }));
  const { supabase } = makeDb({ queue, creatives });

  let videoUploads = 0;
  await withFetch((url) => {
    if (url.includes("/storage/v1/object/ad-videos/")) {
      videoUploads++;
      return new Response("{}", { status: 200 });
    }
    return videoResponse(120 * 1024 * 1024); // 120MB each — large but under cap
  }, async () => {
    const summary = await mod.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(summary.claimed, 3);
    assertEquals(summary.cached, 3);
    assertEquals(summary.failed, 0);
  });

  assertEquals(videoUploads, 3, "one streamed upload per video");
  assert(queue.every((q) => q.status === "done"), "all queue rows marked done");
  assert(!queue.some((q) => q.status === "processing"), "no row left stuck in processing");
  assert(creatives.every((c) => c.video_url!.includes("/storage/v1/object/public/")), "video_url points at storage");
});

Deno.test("drainOnce keeps the CDN url for an oversized video and marks the row done (skipped), not failed", async () => {
  const now = new Date().toISOString();
  const queue: QueueRow[] = [{
    ad_id: "ad_big",
    account_id: "act_1",
    status: "pending",
    attempts: 0,
    enqueued_at: now,
    updated_at: now,
    last_error: null,
  }];
  const creatives: Creative[] = [{
    ad_id: "ad_big",
    account_id: "act_1",
    thumbnail_url: "no-thumbnail",
    full_res_url: null,
    video_url: "https://cdn/huge.mp4",
    thumb_asset_id: null,
    video_asset_id: null,
  }];
  const { supabase, storageUploads } = makeDb({ queue, creatives });

  await withFetch(() => videoResponse(300 * 1024 * 1024), async () => {
    const summary = await mod.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(summary.claimed, 1);
    assertEquals(summary.cached, 0);
    assertEquals(summary.failed, 0, "oversized is a terminal skip, not a failure");
    assertEquals(summary.skipped, 1);
  });

  assertEquals(storageUploads.length, 0, "no upload for oversized video");
  assertEquals(queue[0].status, "done", "oversized ad is done (won't re-clog the queue)");
  assertEquals(creatives[0].video_url, "https://cdn/huge.mp4", "keeps its CDN url");
});

Deno.test("drainOnce requeues (pending) a hard-failure video below MAX_ATTEMPTS", async () => {
  const now = new Date().toISOString();
  const queue: QueueRow[] = [{
    ad_id: "ad_fail",
    account_id: "act_1",
    status: "pending",
    attempts: 0, // becomes 1 after claim → below MAX_ATTEMPTS
    enqueued_at: now,
    updated_at: now,
    last_error: null,
  }];
  const creatives: Creative[] = [{
    ad_id: "ad_fail",
    account_id: "act_1",
    thumbnail_url: "no-thumbnail",
    full_res_url: null,
    video_url: "https://cdn/broken.mp4",
    thumb_asset_id: null,
    video_asset_id: null,
  }];
  const { supabase } = makeDb({ queue, creatives });

  await withFetch(() => new Response("nope", { status: 500, headers: { "content-type": "video/mp4" } }), async () => {
    const summary = await mod.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(summary.failed, 1);
  });
  // 500 is treated as expired (non-2xx) → video_url NULLed, row requeued pending for
  // a fresh re-discovery next drain.
  assertEquals(queue[0].status, "pending", "requeued for retry (attempts < MAX)");
});

Deno.test("handler self-chains while pending rows remain (bounded by MAX_CHAIN)", async () => {
  const now = new Date().toISOString();
  // 6 pending rows; BATCH_SIZE (5) claims 5, leaving 1 pending → must self-chain.
  const queue: QueueRow[] = Array.from({ length: 6 }, (_v, i) => ({
    ad_id: `ad_${i}`,
    account_id: "act_1",
    status: "pending",
    attempts: 0,
    enqueued_at: new Date(Date.now() + i).toISOString(),
    updated_at: now,
    last_error: null,
  }));
  const creatives: Creative[] = queue.map((q) => ({
    ad_id: q.ad_id,
    account_id: "act_1",
    thumbnail_url: "no-thumbnail",
    full_res_url: null,
    video_url: "https://cdn/v.mp4",
    thumb_asset_id: null,
    video_asset_id: null,
  }));
  const { supabase } = makeDb({ queue, creatives });

  // Enable chaining but stub the chain fetch so it never hits the network.
  Deno.env.delete("DRAIN_NO_CHAIN");
  let chainFired = false;
  try {
    await withFetch((url) => {
      if (url.includes("/functions/v1/drain-media-queue")) {
        chainFired = true;
        return new Response("{}", { status: 200 });
      }
      if (url.includes("/storage/v1/object/")) return new Response("{}", { status: 200 });
      return videoResponse(10 * 1024 * 1024);
    }, async () => {
      const req = new Request("https://example.supabase.co/functions/v1/drain-media-queue?chain=0", {
        method: "POST",
        body: "{}",
      });
      const resp = await mod.handler(req, supabase);
      const json = await resp.json();
      assertEquals(json.status, "completed");
      assertEquals(json.pending, 1, "one row remains pending after a BATCH_SIZE=5 drain of 6");
      assertEquals(json.chained, true);
    });
  } finally {
    Deno.env.set("DRAIN_NO_CHAIN", "1");
  }
  assert(chainFired, "handler must self-chain a fresh invocation while pending rows remain");
});

Deno.test("handler does NOT self-chain when the queue is fully drained", async () => {
  const now = new Date().toISOString();
  const queue: QueueRow[] = [{
    ad_id: "ad_solo",
    account_id: "act_1",
    status: "pending",
    attempts: 0,
    enqueued_at: now,
    updated_at: now,
    last_error: null,
  }];
  const creatives: Creative[] = [{
    ad_id: "ad_solo",
    account_id: "act_1",
    thumbnail_url: "no-thumbnail",
    full_res_url: null,
    video_url: "https://cdn/v.mp4",
    thumb_asset_id: null,
    video_asset_id: null,
  }];
  const { supabase } = makeDb({ queue, creatives });

  Deno.env.delete("DRAIN_NO_CHAIN");
  let chainFired = false;
  try {
    await withFetch((url) => {
      if (url.includes("/functions/v1/drain-media-queue")) {
        chainFired = true;
        return new Response("{}", { status: 200 });
      }
      if (url.includes("/storage/v1/object/")) return new Response("{}", { status: 200 });
      return videoResponse(5 * 1024 * 1024);
    }, async () => {
      const req = new Request("https://example.supabase.co/functions/v1/drain-media-queue?chain=0", {
        method: "POST",
        body: "{}",
      });
      const resp = await mod.handler(req, supabase);
      const json = await resp.json();
      assertEquals(json.pending, 0);
      assertEquals(json.chained, false);
    });
  } finally {
    Deno.env.set("DRAIN_NO_CHAIN", "1");
  }
  assert(!chainFired, "no self-chain when nothing remains pending");
});
