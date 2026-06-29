// Tests for vault-transcribe.
//
// Covers isUnsupportedMediaError — the predicate that decides whether a Groq
// Whisper failure is a "save the video, skip transcription, mark ready" case
// vs. a real error that should surface and mark the item errored.
//
// Regression: 400 "no audio track found in file" (silent video — music-only /
// text-overlay ad) was NOT skipped, so silent videos were marked errored
// instead of ready. See index.ts:isUnsupportedMediaError.
//
//   deno test -A supabase/functions/vault-transcribe/index.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("VAULT_TRANSCRIBE_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role");
Deno.env.set("GROQ_API_KEY", "fake-groq");

const { isUnsupportedMediaError } = await import("./index.ts");

const GROQ_NO_AUDIO =
  '{"error":{"message":"no audio track found in file","type":"invalid_request_error"}}';

Deno.test("413 (file too large) is unsupported media", () => {
  assert(isUnsupportedMediaError(413, "Request Entity Too Large"));
});

Deno.test('400 "could not process" is unsupported media', () => {
  assert(isUnsupportedMediaError(400, '{"error":{"message":"could not process file"}}'));
});

Deno.test('REGRESSION: 400 "no audio track" is unsupported media, not an error', () => {
  assert(isUnsupportedMediaError(400, GROQ_NO_AUDIO));
});

Deno.test("a generic 400 is a real error (not skipped)", () => {
  assertEquals(isUnsupportedMediaError(400, '{"error":{"message":"invalid model"}}'), false);
});

Deno.test("auth/server failures are real errors (not skipped)", () => {
  assertEquals(isUnsupportedMediaError(401, "Invalid API Key"), false);
  assertEquals(isUnsupportedMediaError(500, "internal server error"), false);
  // 413 wording only matters for 400; a 500 mentioning audio is still an error.
  assertEquals(isUnsupportedMediaError(500, "no audio track found in file"), false);
});
