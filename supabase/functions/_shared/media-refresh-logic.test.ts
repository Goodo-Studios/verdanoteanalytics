// Deno edge tests are manual (not in CI vitest) per
// verdanote-deno-edge-tests-are-manual-not-in-ci-vitest. Run with:
//   deno test -A supabase/functions/_shared/media-refresh-logic.test.ts
//
// Pins the RE-CACHEABLE vs TERMINAL failure_reason contract — the TS mirror of the
// SQL predicate in enqueue_media_refresh_candidates (they must not drift).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isRecacheable,
  RECACHEABLE_FAILURE_REASONS,
  TERMINAL_FAILURE_REASONS,
} from "./media-refresh-logic.ts";

Deno.test("video_permission is RE-CACHEABLE (page-token backlog self-heals)", () => {
  assertEquals(isRecacheable("video_permission"), true);
  assertEquals(RECACHEABLE_FAILURE_REASONS.has("video_permission"), true);
  assertEquals(TERMINAL_FAILURE_REASONS.has("video_permission"), false);
});

Deno.test("the other re-cacheable reasons still re-enqueue", () => {
  for (const r of ["video_uncached", "image_low_res", "image_missing", "video_unresolved"]) {
    assertEquals(isRecacheable(r), true, `${r} should be re-cacheable`);
  }
});

Deno.test("genuinely-terminal reasons still NEVER re-enqueue", () => {
  // video_deleted (object gone) + frames_incomplete (owned by the sync frame path).
  assertEquals(isRecacheable("video_deleted"), false);
  assertEquals(isRecacheable("frames_incomplete"), false);
  assertEquals(TERMINAL_FAILURE_REASONS.has("video_deleted"), true);
});

Deno.test("null / unknown reasons are not re-cacheable", () => {
  assertEquals(isRecacheable(null), false);
  assertEquals(isRecacheable(undefined), false);
  assertEquals(isRecacheable("video_oversized"), false); // terminal size cap, not listed
});
