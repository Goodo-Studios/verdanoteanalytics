// Audit 8.7: cache-creative-image and preview-capture loaded the whole video into memory
// before checking its size, so an oversized video could exhaust the edge worker's memory
// before the limit applied. readMediaBody must check the declared size first and stop
// reading as soon as the limit is passed.
//   deno test -A supabase/functions/_shared/media-download.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readMediaBody } from "./media-download.ts";

const CHUNK = 1024;

/** A response whose body yields `chunks` chunks of CHUNK bytes; counts how many were read. */
function streamedResponse(chunks: number, headers: Record<string, string> = {}) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) {
        controller.close();
        return;
      }
      pulled++;
      controller.enqueue(new Uint8Array(CHUNK));
    },
  });
  return { res: new Response(body, { headers }), pulled: () => pulled };
}

Deno.test("8.7: a video whose declared size is over the limit is refused without reading it", async () => {
  const { res, pulled } = streamedResponse(100, { "content-length": String(100 * CHUNK) });
  const out = await readMediaBody(res, "video", 10 * CHUNK);
  assertEquals(out, null);
  assert(pulled() <= 1, `body not read (pulled ${pulled()} chunks)`);
});

Deno.test("8.7: a video with no declared size stops reading once it passes the limit", async () => {
  const { res, pulled } = streamedResponse(100);
  const out = await readMediaBody(res, "video", 10 * CHUNK);
  assertEquals(out, null);
  assert(pulled() <= 12, `stopped near the limit (pulled ${pulled()} of 100 chunks)`);
});

Deno.test("8.7: a video under the limit is returned whole", async () => {
  const { res } = streamedResponse(5);
  const out = await readMediaBody(res, "video", 10 * CHUNK);
  assertEquals(out?.byteLength, 5 * CHUNK);
});

Deno.test("8.7: an image is read whole regardless of the video limit", async () => {
  const { res } = streamedResponse(20);
  const out = await readMediaBody(res, "image", 10 * CHUNK);
  assertEquals(out?.byteLength, 20 * CHUNK);
});
