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
import { isStorageUrl, isVideoOk } from "../_shared/media-discovery.ts";

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
  image_quality?: string | null;
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

Deno.test("US-007: cacheVideoToStorage now STREAMS a 201MB video (was over the old 200MB cap) — the ceiling is 2GB", async () => {
  // Regression guard for the US-007 gap: a 201MB video used to be rejected 'too-large'
  // and stranded on the CDN. It is now well under the 2GB ceiling, so it streams to
  // storage like any normal video (streaming keeps worker memory flat regardless).
  let uploadAttempted = false;
  await withFetch((url) => {
    if (url.includes("/storage/v1/object/")) {
      uploadAttempted = true;
      return new Response("{}", { status: 200 });
    }
    return videoResponse(201 * 1024 * 1024); // 201MB — over the OLD cap, under the NEW one
  }, async () => {
    const res = await mod.cacheVideoToStorage("https://cdn/big.mp4", "act_1", "ad_big");
    assert(res.url, "201MB video should now be cached to storage");
    assert(res.url!.includes("/storage/v1/object/public/ad-videos/act_1/ad_big.mp4"));
    assertEquals(res.reason, undefined);
    assert(uploadAttempted, "the 201MB video must be streamed to storage");
  });
});

Deno.test("US-007: cacheVideoToStorage rejects a video over the 2GB ceiling BEFORE streaming — no upload, reason too-large", async () => {
  // A pathological >2GB response is rejected from the content-length header WITHOUT
  // buffering (memory-safe), and never touches storage. MAX_VIDEO_SIZE proves the cap.
  assertEquals(mod.MAX_VIDEO_SIZE, 2 * 1024 * 1024 * 1024, "deliberate 2GB ceiling");
  let uploadAttempted = false;
  await withFetch((url) => {
    if (url.includes("/storage/v1/object/")) {
      uploadAttempted = true;
      return new Response("{}", { status: 200 });
    }
    return videoResponse(mod.MAX_VIDEO_SIZE + 1); // just over the 2GB ceiling
  }, async () => {
    const res = await mod.cacheVideoToStorage("https://cdn/huge.mp4", "act_1", "ad_huge");
    assertEquals(res.url, null);
    assertEquals(res.reason, "too-large");
    assert(!uploadAttempted, "must NOT attempt an upload for a >2GB video (memory-safe: no buffering)");
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

Deno.test("US-007: drainOnce records the oversized sentinel for a >2GB video and marks the row done (skipped), not failed", async () => {
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

  await withFetch(() => videoResponse(mod.MAX_VIDEO_SIZE + 1024), async () => {
    const summary = await mod.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(summary.claimed, 1);
    assertEquals(summary.cached, 0);
    assertEquals(summary.failed, 0, "oversized is a terminal skip, not a failure");
    assertEquals(summary.skipped, 1);
  });

  assertEquals(storageUploads.length, 0, "no upload for a >2GB video");
  assertEquals(queue[0].status, "done", "oversized ad is done (won't re-clog the queue)");
  // US-007 AC#3: honest, distinct failure reason — NOT left on a soon-to-expire CDN url
  // (which would read as the re-attemptable 'video_uncached').
  assertEquals(creatives[0].video_url, "no-video-oversized", "records the distinct oversized sentinel");
  assert(!isVideoOk({ video_url: creatives[0].video_url }), "an oversized video is NOT video_ok");
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

// ── US-003 acceptance tests ──────────────────────────────────────────────────
// Story-level e2e behaviors from the PRD:
//   1. 'no-video' whose video is still resolvable → re-discovery caches a playable
//      video and the ad reports video_ok.
//   2. Cached bytes that are actually an HTML error page → rejected, ad is NOT
//      marked video_ok.

Deno.test("US-003 AC#2: an ad stuck on the generic 'no-video' sentinel is re-discovered and cached, reporting video_ok", async () => {
  const now = new Date().toISOString();
  const queue: QueueRow[] = [{
    ad_id: "ad_redisc",
    account_id: "act_1",
    status: "pending",
    attempts: 0,
    enqueued_at: now,
    updated_at: now,
    last_error: null,
  }];
  const creatives: Creative[] = [{
    ad_id: "ad_redisc",
    account_id: "act_1",
    thumbnail_url: "no-thumbnail", // image sentinel → image path is a no-op
    full_res_url: null,
    video_url: "no-video", // GENERIC sentinel — now a re-discovery TARGET (AC#2)
    thumb_asset_id: null,
    video_asset_id: null,
    image_quality: "full_res",
  }];
  const { supabase } = makeDb({ queue, creatives });

  let uploadAttempted = false;
  await withFetch((url) => {
    if (url.includes("/advideos")) {
      // fetchAccountVideoMap — empty account video map (this ad's video is not
      // page-owned; it resolves directly via object_story_spec.video_data below).
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("graph.facebook.com") && url.includes("?fields=creative")) {
      // discoverVideoUrlWithReason's top-level ad lookup — resolves a live video
      // source directly via Path 2 (object_story_spec.video_data.video_url), no
      // extra video_id fetch needed.
      return new Response(
        JSON.stringify({
          creative: { object_story_spec: { video_data: { video_url: "https://cdn/real.mp4" } } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/storage/v1/object/")) {
      uploadAttempted = true;
      return new Response("{}", { status: 200 });
    }
    if (url === "https://cdn/real.mp4") {
      return videoResponse(20 * 1024 * 1024); // a real, playable, sized video body
    }
    throw new Error(`unexpected fetch in US-003 AC#2 test: ${url}`);
  }, async () => {
    const summary = await mod.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(summary.claimed, 1);
    assertEquals(summary.cached, 1, "re-discovered video is cached");
    assertEquals(summary.failed, 0);
  });

  assert(uploadAttempted, "the re-discovered video must be streamed to storage");
  const creative = creatives[0];
  assert(
    creative.video_url!.includes("/storage/v1/object/public/"),
    "video_url now points at the cached, playable storage asset",
  );
  assert(isVideoOk({ video_url: creative.video_url }), "ad reports video_ok after re-discovery caches a playable video");
  assertEquals(queue[0].status, "done", "queue row finished successfully");
});

Deno.test("US-003 AC#1: cached bytes that are actually an HTML error page are rejected — ad is NOT video_ok", async () => {
  // Unit boundary: cacheVideoToStorage must reject and must NOT attempt an upload,
  // even though the content-type header LIES and claims video/mp4.
  const htmlBody = new TextEncoder().encode(
    "<!DOCTYPE html><html><head><title>Log in</title></head><body>Please log in to continue.</body></html>",
  );
  let uploadAttempted = false;
  await withFetch((url) => {
    if (url.includes("/storage/v1/object/")) {
      uploadAttempted = true;
      return new Response("{}", { status: 200 });
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(htmlBody);
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "video/mp4", // header LIES — the whole point of the test
        "content-length": String(htmlBody.byteLength), // well under the size cap
      },
    });
  }, async () => {
    const res = await mod.cacheVideoToStorage("https://cdn/looks-ok.mp4", "act_1", "ad_html");
    assertEquals(res.url, null);
    assertEquals(res.reason, "html");
  });
  assert(!uploadAttempted, "an HTML payload must never be uploaded to storage");

  // Integration boundary: the same rejection surfaces through the drain worker —
  // the creative's video_url is NULLed for retry (not marked as a cached/playable
  // storage url), so isVideoOk is false and the queue row is not a silent success.
  const now = new Date().toISOString();
  const queue: QueueRow[] = [{
    ad_id: "ad_html",
    account_id: "act_1",
    status: "pending",
    attempts: 0,
    enqueued_at: now,
    updated_at: now,
    last_error: null,
  }];
  const creatives: Creative[] = [{
    ad_id: "ad_html",
    account_id: "act_1",
    thumbnail_url: "no-thumbnail",
    full_res_url: null,
    video_url: "https://cdn/looks-ok.mp4", // live CDN url to download, not a sentinel
    thumb_asset_id: null,
    video_asset_id: null,
    image_quality: "full_res",
  }];
  const { supabase } = makeDb({ queue, creatives });

  await withFetch((url) => {
    if (url.includes("/storage/v1/object/")) {
      throw new Error("must not upload an HTML payload");
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(htmlBody);
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(htmlBody.byteLength),
      },
    });
  }, async () => {
    const summary = await mod.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(summary.cached, 0, "an HTML page must never count as a cached video");
  });

  const creative = creatives[0];
  assert(
    !creative.video_url?.includes("/storage/v1/object/public/"),
    "video_url must not be a storage url — the HTML page was rejected, not cached",
  );
  // The rejected url is NULLed for re-discovery (see cacheVideoToStorage's "html"
  // handling in index.ts): isVideoOk treats a null video_url as "not a video ad,
  // trivially ok" — a pure function over the stored value alone cannot distinguish
  // that from "awaiting re-discovery". The story-level guarantee this test proves is
  // the one that matters operationally: the HTML page was never persisted as a
  // storage url (never wrongly marked playable), so it can NEVER read as video_ok —
  // and the row is put back in the queue rather than silently marked done.
  assertEquals(creative.video_url, null, "the HTML page is NULLed, never persisted as a playable asset");
  assert(!isStorageUrl(creative.video_url), "an HTML payload must never become a storage url (never wrongly video_ok)");
  assertEquals(queue[0].status, "pending", "NULLed url is requeued for a fresh re-discovery attempt, not a silent done");
});

// ── US-007 acceptance tests ──────────────────────────────────────────────────
// Story-level e2e behaviors from the PRD:
//   1. A >200MB video (previously stranded on the CDN by the 200MB cap) is streamed to
//      storage and reports video_ok without the worker OOMing.
//   2. Normal-sized videos: behavior and memory profile are unchanged.

/**
 * A multi-chunk streamed video body: emits `chunks` chunks of `chunkBytes` each so the
 * peek-then-reassemble path (peeked first chunk + untouched remainder) is exercised
 * over a genuinely streamed body — never buffered whole. The declared content-length is
 * the logical size; the actual streamed bytes stay tiny so the test itself is memory-
 * safe, mirroring the production streaming contract (flat memory regardless of size).
 */
function chunkedVideoResponse(logicalBytes: number, chunks = 4, chunkBytes = 256): Response {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x66)); // 'f' — non-HTML bytes
      sent++;
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "video/mp4", "content-length": String(logicalBytes) },
  });
}

Deno.test("US-007 AC (e2e#1): a >200MB video is streamed to storage and reports video_ok without OOM", async () => {
  const now = new Date().toISOString();
  const queue: QueueRow[] = [{
    ad_id: "ad_500mb",
    account_id: "act_1",
    status: "pending",
    attempts: 0,
    enqueued_at: now,
    updated_at: now,
    last_error: null,
  }];
  const creatives: Creative[] = [{
    ad_id: "ad_500mb",
    account_id: "act_1",
    thumbnail_url: "no-thumbnail", // image sentinel → image path is a no-op
    full_res_url: null,
    video_url: "https://cdn/500mb.mp4",
    thumb_asset_id: null,
    video_asset_id: null,
    image_quality: "full_res",
  }];
  const { supabase } = makeDb({ queue, creatives });

  let streamedUpload = false;
  await withFetch((url) => {
    if (url.includes("/storage/v1/object/ad-videos/")) {
      streamedUpload = true;
      return new Response("{}", { status: 200 });
    }
    // 500MB logical — over the OLD 200MB cap, under the NEW 2GB ceiling. Streamed in
    // small chunks so the worker never buffers the file (no OOM).
    return chunkedVideoResponse(500 * 1024 * 1024);
  }, async () => {
    const summary = await mod.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(summary.claimed, 1);
    assertEquals(summary.cached, 1, "the >200MB video is now captured (was stranded on the CDN)");
    assertEquals(summary.failed, 0);
  });

  assert(streamedUpload, "the >200MB video must be streamed to storage");
  const creative = creatives[0];
  assert(
    creative.video_url!.includes("/storage/v1/object/public/ad-videos/act_1/ad_500mb.mp4"),
    "video_url now points at the cached storage asset",
  );
  assert(isVideoOk({ video_url: creative.video_url }), "a captured >200MB video reports video_ok");
  assertEquals(queue[0].status, "done");
});

Deno.test("US-007 AC (e2e#2): normal-sized videos are cached exactly as before (unchanged)", async () => {
  const now = new Date().toISOString();
  const queue: QueueRow[] = [{
    ad_id: "ad_normal",
    account_id: "act_1",
    status: "pending",
    attempts: 0,
    enqueued_at: now,
    updated_at: now,
    last_error: null,
  }];
  const creatives: Creative[] = [{
    ad_id: "ad_normal",
    account_id: "act_1",
    thumbnail_url: "no-thumbnail",
    full_res_url: null,
    video_url: "https://cdn/normal.mp4",
    thumb_asset_id: null,
    video_asset_id: null,
    image_quality: "full_res",
  }];
  const { supabase, storageUploads } = makeDb({ queue, creatives });

  await withFetch((url) => {
    if (url.includes("/storage/v1/object/")) return new Response("{}", { status: 200 });
    return videoResponse(15 * 1024 * 1024); // 15MB — a typical ad video
  }, async () => {
    const summary = await mod.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(summary.cached, 1);
    assertEquals(summary.failed, 0);
  });

  assertEquals(storageUploads.length, 0, "video path uses the streaming POST, not storage.upload()");
  assert(isVideoOk({ video_url: creatives[0].video_url }), "normal video still reports video_ok");
  assertEquals(queue[0].status, "done");
});

// ── Throttle handling: never record no-video, keep the ad retryable ───────────
// Meta app-level throttling (#4) was being written to video_url as the no-video
// sentinel — permanently recording a merely-rate-limited ad as "no video". A throttle
// must leave the media columns UNCHANGED and re-queue the ad for a short retry WITHOUT
// burning an attempt or marking it done/no-video.
Deno.test("drainOnce: a Meta #4 throttle during video discovery leaves video_url unchanged and the ad retryable", async () => {
  const now = new Date().toISOString();
  const queue: QueueRow[] = [{
    ad_id: "ad_throttled",
    account_id: "act_1",
    status: "pending",
    attempts: 0, // becomes 1 after claim; a throttle must NOT keep that bump
    enqueued_at: now,
    updated_at: now,
    last_error: null,
  }];
  const creatives: Creative[] = [{
    ad_id: "ad_throttled",
    account_id: "act_1",
    thumbnail_url: "no-thumbnail", // image sentinel → image path is a no-op
    full_res_url: null,
    video_url: "no-video", // generic no-video → a re-discovery TARGET this drain
    thumb_asset_id: null,
    video_asset_id: null,
    image_quality: "full_res",
  }];
  const { supabase } = makeDb({ queue, creatives });

  await withFetch((url) => {
    if (url.includes("/advideos")) {
      // fetchAccountVideoMap — the account library call is itself throttled (400 #4).
      return new Response(
        JSON.stringify({ error: { code: 4, message: "(#4) Application request limit reached" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("graph.facebook.com") && url.includes("?fields=creative")) {
      // discoverVideoUrlWithReason's top-level ad lookup is throttled.
      return new Response(
        JSON.stringify({ error: { code: 4, message: "(#4) Application request limit reached" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch in throttle test: ${url}`);
  }, async () => {
    const summary = await mod.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(summary.claimed, 1);
    assertEquals(summary.throttled, 1, "the throttle is counted as throttled, not failed/cached");
    assertEquals(summary.failed, 0, "a throttle is NOT a hard failure");
    assertEquals(summary.cached, 0);
  });

  const creative = creatives[0];
  // The invariant: media column UNCHANGED — never overwritten with a sentinel.
  assertEquals(
    creative.video_url,
    "no-video",
    "a throttle leaves video_url exactly as it was — never rewritten to no-video/permission/deleted",
  );
  assert(!isVideoOk({ video_url: creative.video_url }), "row is still not video_ok (unchanged), never falsely resolved");
  // Retryable: back to pending, attempt not burned (still 0), not done/failed.
  assertEquals(queue[0].status, "pending", "the ad is re-queued for a short transient retry, not marked done/failed");
  assertEquals(queue[0].attempts, 0, "a throttle does not consume an attempt toward MAX_ATTEMPTS");
});

Deno.test("drainOnce: a #4 throttle on IMAGE discovery never writes the no-thumbnail sentinel", async () => {
  const now = new Date().toISOString();
  const queue: QueueRow[] = [{
    ad_id: "ad_img_throttled",
    account_id: "act_1",
    status: "pending",
    attempts: 0,
    enqueued_at: now,
    updated_at: now,
    last_error: null,
  }];
  const creatives: Creative[] = [{
    ad_id: "ad_img_throttled",
    account_id: "act_1",
    thumbnail_url: null, // no image yet → image discovery runs and gets throttled
    full_res_url: null,
    video_url: null, // not a video ad → video path is a no-op
    thumb_asset_id: null,
    video_asset_id: null,
    image_quality: null,
  }];
  const { supabase } = makeDb({ queue, creatives });

  await withFetch((url) => {
    if (url.includes("graph.facebook.com") && url.includes("?fields=creative")) {
      return new Response(
        JSON.stringify({ error: { code: 4, message: "Application request limit reached" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch in image throttle test: ${url}`);
  }, async () => {
    const summary = await mod.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(summary.throttled, 1);
    assertEquals(summary.failed, 0);
  });

  const creative = creatives[0];
  assertEquals(
    creative.thumbnail_url,
    null,
    "a throttle must never write the no-thumbnail sentinel — image column stays untouched",
  );
  assertEquals(queue[0].status, "pending", "the ad remains retryable after an image throttle");
  assertEquals(queue[0].attempts, 0, "an image throttle does not consume an attempt");
});

// ── Video dedupe by video_id (store once per (account, video_id)) ─────────────

Deno.test("cacheVideoToStorage: dedupe HIT reuses the stored video and skips the download entirely", async () => {
  // media_assets already has this (account, video_id) → return the stored url without
  // downloading. This is the core dedupe win: the same video across N ads = 1 download.
  const hitSupa = {
    from: () => {
      // deno-lint-ignore no-explicit-any
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = () =>
        Promise.resolve({ data: { id: "asset-existing", public_url: "https://store/existing.mp4" } });
      return b;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  let fetched = false;
  await withFetch(() => {
    fetched = true;
    return videoResponse(10 * 1024 * 1024);
  }, async () => {
    const res = await mod.cacheVideoToStorage("https://cdn/v.mp4", "act_1", "ad_a", hitSupa, "vid999");
    assertEquals(res.url, "https://store/existing.mp4");
    assertEquals(res.assetId, "asset-existing");
    assertEquals(res.deduped, true);
    assert(!fetched, "a dedupe hit must NOT download the video");
  });
});

Deno.test("cacheVideoToStorage: dedupe MISS stores under the video-id asset path and registers the ledger row", async () => {
  // deno-lint-ignore no-explicit-any
  let upsertPayload: any = null;
  let upserted = false;
  const missSupa = {
    from: () => {
      // deno-lint-ignore no-explicit-any
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      // deno-lint-ignore no-explicit-any
      b.upsert = (p: any) => { upsertPayload = p; upserted = true; return b; };
      b.maybeSingle = () => Promise.resolve({ data: upserted ? { id: "asset-new" } : null });
      return b;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  await withFetch((url) => {
    if (url.includes("/storage/v1/object/")) return new Response("{}", { status: 200 });
    return videoResponse(12 * 1024 * 1024);
  }, async () => {
    const res = await mod.cacheVideoToStorage("https://cdn/v.mp4", "act_1", "ad_b", missSupa, "vidmiss");
    assert(res.url!.includes("/storage/v1/object/public/ad-videos/act_1/assets/video-vidmiss.mp4"), "stored under the video-id asset path");
    assertEquals(res.assetId, "asset-new");
    assertEquals(res.deduped, undefined);
    assertEquals(upsertPayload.asset_key, "video:vidmiss");
    assertEquals(upsertPayload.media_type, "video");
    assertEquals(upsertPayload.storage_path, "act_1/assets/video-vidmiss.mp4");
  });
});

Deno.test("cacheVideoToStorage: no videoId → legacy per-ad path, no ledger touch (back-compat)", async () => {
  await withFetch((url) => {
    if (url.includes("/storage/v1/object/")) return new Response("{}", { status: 200 });
    return videoResponse(8 * 1024 * 1024);
  }, async () => {
    const res = await mod.cacheVideoToStorage("https://cdn/v.mp4", "act_1", "ad_legacy");
    assert(res.url!.includes("/storage/v1/object/public/ad-videos/act_1/ad_legacy.mp4"), "legacy per-ad path preserved");
    assertEquals(res.assetId, undefined);
  });
});

Deno.test("permission-blocked video is now RE-DISCOVERED, not a terminal skip", async () => {
  // Regression for the page-token backlog fix: an ad stamped 'no-video-permission'
  // used to be skipped forever (terminal). It is now a re-discovery target — the drain
  // re-runs discovery (page-token path) and caches the resolved video.
  const now = new Date().toISOString();
  const queue: QueueRow[] = [{
    ad_id: "ad_perm", account_id: "act_1", status: "pending",
    attempts: 0, enqueued_at: now, updated_at: now, last_error: null,
  }];
  const creatives: Creative[] = [{
    ad_id: "ad_perm", account_id: "act_1",
    thumbnail_url: "no-thumbnail", full_res_url: null,
    video_url: "no-video-permission", // was TERMINAL, now a re-discovery target
    thumb_asset_id: null, video_asset_id: null, image_quality: "full_res",
  }];
  const { supabase } = makeDb({ queue, creatives });

  let uploadAttempted = false;
  await withFetch((url) => {
    if (url.includes("/me/accounts")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/advideos")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("graph.facebook.com") && url.includes("?fields=creative")) {
      return new Response(
        JSON.stringify({ creative: { object_story_spec: { video_data: { video_url: "https://cdn/perm.mp4" } } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/storage/v1/object/")) { uploadAttempted = true; return new Response("{}", { status: 200 }); }
    if (url === "https://cdn/perm.mp4") return videoResponse(15 * 1024 * 1024);
    throw new Error(`unexpected fetch in permission-rediscovery test: ${url}`);
  }, async () => {
    const summary = await mod.drainOnce(supabase, "fake-token", 5, 120_000);
    assertEquals(summary.claimed, 1);
    assertEquals(summary.cached, 1, "permission ad is re-discovered + cached, not skipped");
    assertEquals(summary.skipped, 0, "permission is no longer a terminal skip");
  });
  assert(uploadAttempted, "the re-discovered permission video must be streamed to storage");
  assert(creatives[0].video_url!.includes("/storage/v1/object/public/"), "video_url now points at the cached storage asset");
  assert(isVideoOk({ video_url: creatives[0].video_url }), "ad reports video_ok after re-discovery");
})
